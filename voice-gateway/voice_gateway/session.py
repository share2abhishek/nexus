"""One call: the WebRTC audio with WhatsApp (or the browser in the lab), the turn loop and the recording.

Turn loop: caller audio -> 16 kHz mono -> voice activity detection (webrtcvad, not a model download) -> end of turn after
`endOfTurnMs` of silence -> speech-to-text -> streamed AI reply -> sentence by sentence to the voice -> 48 kHz back to the
caller. When the caller starts talking while the assistant speaks (barge-in), playback stops and the reply is dropped.
"""
from __future__ import annotations

import asyncio
import collections
import fractions
import io
import json
import logging
import time
import wave

import httpx
import numpy as np
import webrtcvad
from aiortc import MediaStreamTrack, RTCConfiguration, RTCIceServer, RTCPeerConnection, RTCSessionDescription
from aiortc.mediastreams import MediaStreamError
from av import AudioFrame, AudioResampler

from . import brain, config, providers
from .sign import sign

log = logging.getLogger("voice")

OUT_RATE = 48000
OUT_CHUNK = 960  # 20 ms at 48 kHz
IN_RATE = 16000
VAD_FRAME_BYTES = 480 * 2  # 30 ms at 16 kHz, 16-bit
SILENCE = np.zeros(OUT_CHUNK, dtype=np.int16)

FALLBACK_LINE = "Maaf kijiye, abhi ek chhoti si technical dikkat aa gayi. Hamari team aapko jaldi call karegi. Dhanyavaad!"
HOLD_LINE = "Haan ji, ek second."
STILL_THERE = "Hello, kya aap line par hain?"
GOODBYE_SILENT = "Lagta hai line par koi nahi hai. Main baad mein call karwa deti hoon. Dhanyavaad!"
GOODBYE_LONG = "Hamari baat kaafi lambi ho gayi, main team ko sab details de deti hoon, wo aapse jaldi baat karenge. Dhanyavaad!"


def resample(pcm: np.ndarray, src: int, dst: int) -> np.ndarray:
    if src == dst or pcm.size == 0:
        return pcm.astype(np.int16)
    n = int(round(pcm.size * dst / src))
    x = np.linspace(0, pcm.size - 1, n)
    return np.interp(x, np.arange(pcm.size), pcm.astype(np.float32)).astype(np.int16)


def wav_bytes(pcm: np.ndarray, rate: int = IN_RATE, channels: int = 1) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm.astype(np.int16).tobytes())
    return buf.getvalue()


class Recorder:
    """Both sides at 16 kHz, aligned: left = caller, right = assistant."""

    def __init__(self):
        self.caller_parts: list[np.ndarray] = []
        self.assistant_parts: list[np.ndarray] = []
        self.caller_len = 0
        self.assistant_len = 0

    def caller(self, pcm16k: np.ndarray):
        self.caller_parts.append(pcm16k)
        self.caller_len += pcm16k.size

    def assistant(self, pcm48k: np.ndarray):
        if self.assistant_len < self.caller_len - 1600:  # catch up with time that passed before the assistant spoke
            pad = np.zeros(self.caller_len - self.assistant_len, dtype=np.int16)
            self.assistant_parts.append(pad)
            self.assistant_len += pad.size
        part = pcm48k[::3]
        self.assistant_parts.append(part)
        self.assistant_len += part.size

    def stereo_wav(self) -> bytes:
        a = np.concatenate(self.caller_parts) if self.caller_parts else np.zeros(0, np.int16)
        b = np.concatenate(self.assistant_parts) if self.assistant_parts else np.zeros(0, np.int16)
        n = max(a.size, b.size)
        a = np.pad(a, (0, n - a.size))
        b = np.pad(b, (0, n - b.size))
        return wav_bytes(np.stack([a, b], axis=1).reshape(-1), IN_RATE, 2)


class OutTrack(MediaStreamTrack):
    """The assistant's voice. Sends nothing until `started` is set (Meta: media only after accept)."""

    kind = "audio"

    def __init__(self, recorder: Recorder):
        super().__init__()
        self.q: collections.deque[np.ndarray] = collections.deque()
        self.started = asyncio.Event()
        self.recorder = recorder
        self._t0 = None
        self._pts = 0

    async def recv(self):
        await self.started.wait()
        if self._t0 is None:
            self._t0 = time.monotonic()
        wait = self._t0 + self._pts / OUT_RATE - time.monotonic()
        if wait > 0:
            await asyncio.sleep(wait)
        samples = self.q.popleft() if self.q else SILENCE
        frame = AudioFrame.from_ndarray(samples.reshape(1, -1), format="s16", layout="mono")
        frame.sample_rate = OUT_RATE
        frame.pts = self._pts
        frame.time_base = fractions.Fraction(1, OUT_RATE)
        self._pts += OUT_CHUNK
        self.recorder.assistant(samples)
        return frame

    def push(self, pcm: bytes, rate: int):
        x = resample(np.frombuffer(pcm, dtype=np.int16), rate, OUT_RATE)
        for i in range(0, x.size, OUT_CHUNK):
            c = x[i:i + OUT_CHUNK]
            self.q.append(c if c.size == OUT_CHUNK else np.pad(c, (0, OUT_CHUNK - c.size)))

    @property
    def playing(self) -> bool:
        return bool(self.q)

    def clear(self):
        self.q.clear()

    async def drained(self, timeout: float = 30):
        end = time.monotonic() + timeout
        while self.q and time.monotonic() < end:
            await asyncio.sleep(0.05)


class CallSession:
    def __init__(self, call_id: str, assistant: dict, knowledge: dict, caller: dict, callback_url: str | None, lab: bool = False):
        self.call_id = call_id
        self.assistant = assistant
        self.knowledge = knowledge or {}
        self.caller = caller or {}
        self.callback_url = (callback_url or "").rstrip("/") or None
        self.lab = lab
        self.models = assistant.get("models") or {}
        self.vc = {"endOfTurnMs": 700, "bargeIn": True, "maxCallSec": 600, "silenceSec": 12, "speed": 1.0, **(assistant.get("voice_controls") or {})}
        self.recorder = Recorder()
        self.out = OutTrack(self.recorder)
        self.pc = RTCPeerConnection(RTCConfiguration(iceServers=[RTCIceServer(urls=u) for u in config.STUN_URLS]))
        self.pc.addTrack(self.out)
        self.usage = providers.Usage()
        self.history: list[dict] = []
        self.turns: list[dict] = []
        self.events: list[dict] = []  # lab: what Nexus would have received
        self.seq = 0
        self.ended = False
        self.reply_task: asyncio.Task | None = None
        self.tasks: list[asyncio.Task] = []
        self.last_caller_speech = time.monotonic()
        self.started_at = None
        # voice activity detection state
        self.vad = webrtcvad.Vad(2)
        self.vbuf = b""
        self.preroll: collections.deque[bytes] = collections.deque(maxlen=10)
        self.utt = bytearray()
        self.in_speech = False
        self.speech_ms = 0
        self.silence_ms = 0

        @self.pc.on("track")
        def on_track(track):
            if track.kind == "audio":
                self.tasks.append(asyncio.ensure_future(self._read(track)))

        @self.pc.on("connectionstatechange")
        async def on_state():
            st = self.pc.connectionState
            log.info("call %s connection %s", self.call_id, st)
            if st == "connected" and self.started_at is None:
                await self._on_connected()
            elif st in ("failed", "closed") and not self.ended:
                await self.end("connection_" + st)

    # ── signalling ────────────────────────────────────────────────────────────
    async def answer(self, offer_sdp: str) -> str:
        await self.pc.setRemoteDescription(RTCSessionDescription(sdp=offer_sdp, type="offer"))
        await self.pc.setLocalDescription(await self.pc.createAnswer())  # waits for ICE gathering
        return self.pc.localDescription.sdp

    async def _on_connected(self):
        self.started_at = time.monotonic()
        if not self.lab:
            ok = await self._post("/events", {"type": "media_ready", "call_id": self.call_id})
            if not ok:
                await self.end("accept_failed")
                return
        self.out.started.set()
        self.tasks.append(asyncio.ensure_future(self._watch()))
        await self._say_line(self.assistant.get("greeting") or "Namaste!", record=True)

    # ── events to Nexus ────────────────────────────────────────────────────────
    async def _post(self, path: str, payload: dict) -> bool:
        if self.lab or not self.callback_url:
            self.events.append(payload)
            return True
        body = json.dumps(payload).encode()
        try:
            async with httpx.AsyncClient(timeout=10) as c:
                r = await c.post(self.callback_url + path, content=body, headers={"Content-Type": "application/json", "X-Voice-Signature": sign(body, config.SECRET)})
            if r.status_code != 200:
                log.warning("call %s: Nexus %s answered %s", self.call_id, payload.get("type"), r.status_code)
            return r.status_code == 200
        except httpx.HTTPError as e:
            log.warning("call %s: Nexus %s failed: %s", self.call_id, payload.get("type"), e)
            return False

    async def _turn_event(self, speaker: str, text: str, **timings):
        t = {"seq": self.seq, "speaker": speaker, "text": text}
        self.seq += 1
        self.turns.append(t)
        await self._post("/events", {"type": "turn", "call_id": self.call_id, **t, **{k: int(v) for k, v in timings.items() if v is not None}})

    # ── caller audio ─────────────────────────────────────────────────────────
    async def _read(self, track):
        resampler = AudioResampler(format="s16", layout="mono", rate=IN_RATE)
        try:
            while not self.ended:
                frame = await track.recv()
                for f in resampler.resample(frame):
                    pcm = f.to_ndarray().astype(np.int16).reshape(-1)
                    self.recorder.caller(pcm)
                    self._vad_feed(pcm.tobytes())
        except MediaStreamError:
            pass

    def _vad_feed(self, data: bytes):
        self.vbuf += data
        while len(self.vbuf) >= VAD_FRAME_BYTES:
            frame, self.vbuf = self.vbuf[:VAD_FRAME_BYTES], self.vbuf[VAD_FRAME_BYTES:]
            speech = self.vad.is_speech(frame, IN_RATE)
            if speech:
                self.speech_ms += 30
                self.silence_ms = 0
                if not self.in_speech and self.speech_ms >= 90:
                    self.in_speech = True
                    self.utt = bytearray(b"".join(self.preroll))
                if self.in_speech:
                    self.utt.extend(frame)
                    self.last_caller_speech = time.monotonic()
                    if self.vc.get("bargeIn", True) and self.speech_ms >= 240 and (self.out.playing or self._replying()):
                        self._interrupt()
            else:
                if self.in_speech:
                    self.utt.extend(frame)
                    self.silence_ms += 30
                    if self.silence_ms >= int(self.vc.get("endOfTurnMs", 700)):
                        audio = bytes(self.utt)
                        long_enough = self.speech_ms >= 300
                        self.in_speech, self.speech_ms, self.silence_ms, self.utt = False, 0, 0, bytearray()
                        if long_enough:
                            self._on_utterance(audio)
                else:
                    self.speech_ms = max(0, self.speech_ms - 30)
                    self.preroll.append(frame)

    def _replying(self) -> bool:
        return self.reply_task is not None and not self.reply_task.done()

    def _interrupt(self):
        self.out.clear()
        if self._replying():
            self.reply_task.cancel()

    def _on_utterance(self, pcm: bytes):
        if self.ended:
            return
        if self._replying():
            self.reply_task.cancel()
        self.reply_task = asyncio.ensure_future(self._turn(pcm))

    # ── one turn ─────────────────────────────────────────────────────────────
    async def _turn(self, pcm: bytes):
        t0 = time.monotonic()
        try:
            hint = "Hinglish, " + (self.assistant.get("name") or "") + ", society, maintenance, flats, wing, demo, committee"
            text, lang = await providers.transcribe(wav_bytes(np.frombuffer(pcm, dtype=np.int16)), self.models.get("stt", {}), hint)
            self.usage.stt_seconds += len(pcm) / (IN_RATE * 2)
            stt_ms = (time.monotonic() - t0) * 1000
            if not text or len(text) < 2:
                return
            await self._turn_event("caller", text, stt_ms=stt_ms)
            self.history.append({"role": "user", "content": text})

            system = brain.system_prompt(self.assistant, self.knowledge, self.caller)
            chunker = brain.SentenceChunker()
            say_q: asyncio.Queue[str | None] = asyncio.Queue()
            timing = {"llm_ms": None, "tts_ms": None}
            t1 = time.monotonic()
            hold = asyncio.ensure_future(self._hold_line(timing))
            speaker = asyncio.ensure_future(self._speak_queue(say_q, timing, t1))
            try:
                async for piece in providers.stream_reply(system, self._history_window(), self.models.get("llm", {}), self.usage):
                    for s in chunker.feed(piece):
                        if timing["llm_ms"] is None:
                            timing["llm_ms"] = (time.monotonic() - t1) * 1000
                        await say_q.put(s)
                for s in chunker.flush():
                    await say_q.put(s)
                await say_q.put(None)
                await speaker
            except BaseException:
                speaker.cancel()  # barge-in or an error: stop speaking the old reply
                raise
            finally:
                hold.cancel()
            full = chunker.full
            spoken = brain.speakable(full)
            m = brain.markers(full)
            if spoken:
                self.history.append({"role": "assistant", "content": spoken})
                await self._turn_event("assistant", spoken, llm_ms=timing["llm_ms"], tts_ms=timing["tts_ms"])
            if m["handover"]:
                await self._post("/events", {"type": "handover", "call_id": self.call_id, "note": m["handover"]})
            if m["end"]:
                await self.out.drained()
                await self.end("goodbye", hangup=True)
        except asyncio.CancelledError:
            raise
        except providers.ProviderError as e:
            log.warning("call %s: provider error: %s", self.call_id, e)
            await self._say_line(FALLBACK_LINE, record=True)
            await self.out.drained()
            await self.end("provider_error", hangup=True, outcome="callback")

    def _history_window(self) -> list[dict]:
        msgs = self.history[-20:]
        # providers want the conversation to start with the caller
        while msgs and msgs[0]["role"] != "user":
            msgs = msgs[1:]
        return msgs

    async def _speak_queue(self, q: asyncio.Queue, timing: dict, t1: float):
        while True:
            s = await q.get()
            if s is None:
                return
            pcm, rate = await providers.speak(s, self.models.get("tts", {}), self.vc, brain.tts_style(self.assistant))
            self.usage.tts_chars += len(s)
            if timing["tts_ms"] is None:
                timing["tts_ms"] = (time.monotonic() - t1) * 1000
            self.out.push(pcm, rate)

    async def _hold_line(self, timing: dict):
        await asyncio.sleep(3)
        if timing["tts_ms"] is None and not self.out.playing:
            await self._say_line(HOLD_LINE)

    async def _say_line(self, text: str, record: bool = False):
        try:
            pcm, rate = await providers.speak(text, self.models.get("tts", {}), self.vc, brain.tts_style(self.assistant))
            self.usage.tts_chars += len(text)
            self.out.push(pcm, rate)
        except providers.ProviderError as e:
            log.warning("call %s: could not speak: %s", self.call_id, e)
            return
        if record:
            self.history.append({"role": "assistant", "content": text})
            await self._turn_event("assistant", text)

    # ── silence and length limits ────────────────────────────────────────────
    async def _watch(self):
        asked = False
        while not self.ended:
            await asyncio.sleep(1)
            if time.monotonic() - self.started_at > int(self.vc.get("maxCallSec", 600)):
                await self._say_line(GOODBYE_LONG, record=True)
                await self.out.drained()
                await self.end("max_length", hangup=True, outcome="callback")
                return
            quiet = time.monotonic() - self.last_caller_speech
            if self.out.playing or self._replying() or self.in_speech:
                continue
            if quiet > int(self.vc.get("silenceSec", 12)) and not asked:
                asked = True
                self.last_caller_speech = time.monotonic()
                await self._say_line(STILL_THERE, record=True)
            elif asked and quiet > int(self.vc.get("silenceSec", 12)):
                await self._say_line(GOODBYE_SILENT, record=True)
                await self.out.drained()
                await self.end("silence", hangup=True, outcome="no_answer")
                return
            elif quiet < 2:
                asked = False

    # ── end ──────────────────────────────────────────────────────────────────
    async def end(self, reason: str, hangup: bool = False, outcome: str | None = None):
        if self.ended:
            return
        self.ended = True
        for t in self.tasks:
            t.cancel()
        if self._replying():
            self.reply_task.cancel()
        summary = {"summary": None, "outcome": outcome, "next_step": None}
        if len(self.turns) > 1:
            try:
                text = await providers.complete(brain.SUMMARY_SYSTEM, brain.summary_prompt(self.turns), self.models.get("llm", {}), self.usage)
                s = brain.parse_summary(text)
                summary = {**s, "outcome": outcome or s["outcome"]}
            except providers.ProviderError as e:
                log.warning("call %s: summary failed: %s", self.call_id, e)
        u = self.usage
        await self._post("/events", {"type": "ended", "call_id": self.call_id, "reason": reason, "hangup": hangup, **summary,
                                     "usage": {"tokens_in": u.tokens_in, "tokens_out": u.tokens_out, "stt_seconds": round(u.stt_seconds), "tts_chars": u.tts_chars}})
        if self.assistant.get("recording_on", True) and self.recorder.caller_len:
            wav = self.recorder.stereo_wav()
            if self.lab or not self.callback_url:
                import os
                os.makedirs(config.RECORDINGS_DIR, exist_ok=True)
                with open(os.path.join(config.RECORDINGS_DIR, f"{self.call_id}.wav"), "wb") as f:
                    f.write(wav)
            else:
                try:
                    async with httpx.AsyncClient(timeout=60) as c:
                        await c.post(f"{self.callback_url}/recording/{self.call_id}", content=wav,
                                     headers={"Content-Type": "audio/wav", "X-Voice-Signature": sign(wav, config.SECRET)})
                except httpx.HTTPError as e:
                    log.warning("call %s: recording upload failed: %s", self.call_id, e)
        await self.pc.close()
        log.info("call %s ended: %s (%d turns)", self.call_id, reason, len(self.turns))
