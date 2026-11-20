"""A real WebRTC call between two peers on this machine, with the AI providers faked: the greeting plays only after
the start signal, the caller's turn goes through speech-to-text, the AI and the voice, the end marker ends the call,
and the recording is written."""
import asyncio
import fractions
import os
import tempfile

import numpy as np
import pytest
from aiortc import MediaStreamTrack, RTCPeerConnection, RTCSessionDescription
from av import AudioFrame

from voice_gateway import config, providers, session as sess

config.STUN_URLS = []


class Tone(MediaStreamTrack):
    kind = "audio"

    def __init__(self):
        super().__init__()
        self.pts = 0

    async def recv(self):
        await asyncio.sleep(0.02)
        t = (np.arange(960) + self.pts) / 48000
        x = (0 * np.sin(2 * np.pi * 220 * t)).astype(np.int16)  # a quiet line: no barge-in
        f = AudioFrame.from_ndarray(x.reshape(1, -1), format="s16", layout="mono")
        f.sample_rate, f.pts, f.time_base = 48000, self.pts, fractions.Fraction(1, 48000)
        self.pts += 960
        return f


@pytest.fixture
def fake_providers(monkeypatch):
    calls = {"speak": [], "stt": 0}

    async def speak(text, cfg, controls, style=""):
        calls["speak"].append(text)
        return (np.full(24000 // 2, 2000, dtype=np.int16)).tobytes(), 24000  # 0.5 s of sound

    async def transcribe(wav, cfg, hint=""):
        calls["stt"] += 1
        return "Hamari society mein 240 flats hain, demo chahiye", "hi"

    async def stream_reply(system, messages, cfg, usage):
        for piece in ["Bahut badhiya! ", "Main Sunday ka demo book kar deti hoon. ", "Dhanyavaad! [[END]]"]:
            yield piece

    async def complete(system, prompt, cfg, usage):
        return '{"summary": "Chairman of a 240-flat society wants a demo.", "outcome": "demo_booked", "next_step": "Demo Sunday"}'

    monkeypatch.setattr(providers, "speak", speak)
    monkeypatch.setattr(providers, "transcribe", transcribe)
    monkeypatch.setattr(providers, "stream_reply", stream_reply)
    monkeypatch.setattr(providers, "complete", complete)
    return calls


async def test_a_full_call(fake_providers, monkeypatch):
    rec_dir = tempfile.mkdtemp()
    monkeypatch.setattr(config, "RECORDINGS_DIR", rec_dir)
    s = sess.CallSession("lab-test", {"name": "Sneha", "greeting": "Namaste! Main Sneha.", "recording_on": True}, {}, {}, None, lab=True)

    caller = RTCPeerConnection()
    caller.addTrack(Tone())
    heard = []

    @caller.on("track")
    def on_track(track):
        async def read():
            try:
                while True:
                    f = await track.recv()
                    heard.append(int(np.abs(f.to_ndarray()).max()))
            except Exception:  # noqa: BLE001
                pass
        asyncio.ensure_future(read())

    await caller.setLocalDescription(await caller.createOffer())
    answer = await s.answer(caller.localDescription.sdp)
    await caller.setRemoteDescription(RTCSessionDescription(sdp=answer, type="answer"))

    for _ in range(300):
        if s.started_at is not None and fake_providers["speak"]:
            break
        await asyncio.sleep(0.1)
    assert fake_providers["speak"][0] == "Namaste! Main Sneha."
    await asyncio.sleep(1.0)
    assert max(heard or [0]) > 1000  # the caller heard the greeting

    # the caller says something (a turn straight from audio bytes)
    s._on_utterance(np.full(16000, 500, dtype=np.int16).tobytes())
    for _ in range(300):
        if s.ended:
            break
        await asyncio.sleep(0.1)
    assert s.ended
    turns = [(e["speaker"], e["text"]) for e in s.events if e["type"] == "turn"]
    assert turns == [("assistant", "Namaste! Main Sneha."), ("caller", "Hamari society mein 240 flats hain, demo chahiye"),
                     ("assistant", "Bahut badhiya! Main Sunday ka demo book kar deti hoon. Dhanyavaad!")]
    ended = [e for e in s.events if e["type"] == "ended"][0]
    assert ended["outcome"] == "demo_booked" and ended["hangup"] is True and ended["reason"] == "goodbye"
    assert os.path.getsize(os.path.join(rec_dir, "lab-test.wav")) > 44
    await caller.close()


async def test_whatsapp_mode_sends_no_audio_before_accept(fake_providers, monkeypatch):
    posted = []

    async def fake_post(path, payload):
        posted.append(payload)
        return payload.get("type") != "media_ready"  # Nexus could not accept the call

    s = sess.CallSession("wacid.t", {"greeting": "Namaste"}, {}, {}, "https://nexus.test/api/webhooks/voice-gateway")
    monkeypatch.setattr(s, "_post", fake_post)
    caller = RTCPeerConnection()
    caller.addTrack(Tone())
    await caller.setLocalDescription(await caller.createOffer())
    answer = await s.answer(caller.localDescription.sdp)
    await caller.setRemoteDescription(RTCSessionDescription(sdp=answer, type="answer"))
    for _ in range(300):
        if s.ended:
            break
        await asyncio.sleep(0.1)
    assert [p["type"] for p in posted][:2] == ["media_ready", "ended"]
    assert not s.out.started.is_set()  # never started sending
    assert fake_providers["speak"] == []
    await caller.close()
