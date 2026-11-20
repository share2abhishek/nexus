"""Speech-to-text, AI replies and voice through the providers' APIs (owner decision: API keys, no model installed).

Each function takes the part of the assistant's `models` setting it needs, e.g. {"provider": "openai", "model": "..."}.
  transcribe(audio_wav_16k, cfg, hint) -> (text, lang)
  stream_reply(system, messages, cfg)  -> async iterator of text pieces; usage collected in the returned Usage
  complete(system, prompt, cfg)        -> text (non-streamed, for the end-of-call summary)
  speak(text, cfg, controls)           -> (pcm int16 mono bytes, sample_rate)
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field

import httpx

from . import config

TIMEOUT = httpx.Timeout(20.0, connect=5.0)


class ProviderError(RuntimeError):
    pass


@dataclass
class Usage:
    tokens_in: int = 0
    tokens_out: int = 0
    stt_seconds: float = 0.0
    tts_chars: int = 0
    extra: dict = field(default_factory=dict)


def _key(provider: str) -> str:
    k = config.KEYS.get(provider)
    if not k:
        raise ProviderError(f"no API key for {provider} (set it in the gateway environment)")
    return k


# ── Speech-to-text ─────────────────────────────────────────────────────────────
async def transcribe(wav: bytes, cfg: dict, hint: str = "") -> tuple[str, str | None]:
    provider = cfg.get("provider", "openai")
    if provider == "openai":
        data = {"model": cfg.get("model", "gpt-4o-transcribe"), "response_format": "json"}
        if hint:
            data["prompt"] = hint[:800]
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            r = await c.post("https://api.openai.com/v1/audio/transcriptions", headers={"Authorization": f"Bearer {_key('openai')}"},
                             data=data, files={"file": ("turn.wav", wav, "audio/wav")})
        if r.status_code != 200:
            raise ProviderError(f"openai transcribe {r.status_code}: {r.text[:200]}")
        j = r.json()
        return (j.get("text") or "").strip(), j.get("language")
    if provider == "gemini":
        import base64
        model = cfg.get("model", "gemini-2.5-flash")
        body = {"contents": [{"role": "user", "parts": [
            {"text": "Transcribe this phone audio exactly as spoken (Hinglish or Indian languages in Latin script). Reply with the words only." + (f" Words that may appear: {hint}" if hint else "")},
            {"inline_data": {"mime_type": "audio/wav", "data": base64.b64encode(wav).decode()}},
        ]}]}
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            r = await c.post(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent", params={"key": _key("gemini")}, json=body)
        if r.status_code != 200:
            raise ProviderError(f"gemini transcribe {r.status_code}: {r.text[:200]}")
        parts = (r.json().get("candidates") or [{}])[0].get("content", {}).get("parts", [])
        return "".join(p.get("text", "") for p in parts).strip(), None
    raise ProviderError(f"speech-to-text provider {provider} not supported")


# ── AI replies (streamed) ───────────────────────────────────────────────────────
async def stream_reply(system: str, messages: list[dict], cfg: dict, usage: Usage):
    provider = cfg.get("provider", "anthropic")
    temperature = float(cfg.get("temperature", 0.4))
    async with httpx.AsyncClient(timeout=TIMEOUT) as c:
        if provider == "anthropic":
            body = {"model": cfg.get("model", "claude-sonnet-5-5"), "max_tokens": 300, "system": system, "messages": messages, "stream": True, "temperature": temperature}
            headers = {"x-api-key": _key("anthropic"), "anthropic-version": "2023-06-01", "content-type": "application/json"}
            async with c.stream("POST", "https://api.anthropic.com/v1/messages", headers=headers, json=body) as r:
                if r.status_code != 200:
                    raise ProviderError(f"anthropic {r.status_code}: {(await r.aread())[:200]!r}")
                async for line in r.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    ev = json.loads(line[5:])
                    t = ev.get("type")
                    if t == "content_block_delta" and ev["delta"].get("type") == "text_delta":
                        yield ev["delta"]["text"]
                    elif t == "message_start":
                        usage.tokens_in += ev["message"].get("usage", {}).get("input_tokens", 0)
                    elif t == "message_delta":
                        usage.tokens_out += ev.get("usage", {}).get("output_tokens", 0)
            return
        if provider == "openai":
            body = {"model": cfg.get("model", "gpt-4.1-mini"), "stream": True, "temperature": temperature, "max_tokens": 300,
                    "stream_options": {"include_usage": True}, "messages": [{"role": "system", "content": system}, *messages]}
            async with c.stream("POST", "https://api.openai.com/v1/chat/completions", headers={"Authorization": f"Bearer {_key('openai')}"}, json=body) as r:
                if r.status_code != 200:
                    raise ProviderError(f"openai {r.status_code}: {(await r.aread())[:200]!r}")
                async for line in r.aiter_lines():
                    if not line.startswith("data:") or line.strip() == "data: [DONE]":
                        continue
                    ev = json.loads(line[5:])
                    if ev.get("usage"):
                        usage.tokens_in += ev["usage"].get("prompt_tokens", 0)
                        usage.tokens_out += ev["usage"].get("completion_tokens", 0)
                    for ch in ev.get("choices", []):
                        piece = (ch.get("delta") or {}).get("content")
                        if piece:
                            yield piece
            return
        if provider == "gemini":
            model = cfg.get("model", "gemini-2.5-flash")
            body = {"systemInstruction": {"parts": [{"text": system}]}, "generationConfig": {"temperature": temperature, "maxOutputTokens": 300},
                    "contents": [{"role": "model" if m["role"] == "assistant" else "user", "parts": [{"text": m["content"]}]} for m in messages]}
            async with c.stream("POST", f"https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent",
                                params={"alt": "sse", "key": _key("gemini")}, json=body) as r:
                if r.status_code != 200:
                    raise ProviderError(f"gemini {r.status_code}: {(await r.aread())[:200]!r}")
                async for line in r.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    ev = json.loads(line[5:])
                    um = ev.get("usageMetadata") or {}
                    if um:
                        usage.extra["gemini_in"] = um.get("promptTokenCount", 0)
                        usage.extra["gemini_out"] = um.get("candidatesTokenCount", 0)
                    for cand in ev.get("candidates", []):
                        for p in cand.get("content", {}).get("parts", []):
                            if p.get("text"):
                                yield p["text"]
            usage.tokens_in += usage.extra.pop("gemini_in", 0)
            usage.tokens_out += usage.extra.pop("gemini_out", 0)
            return
    raise ProviderError(f"AI provider {provider} not supported")


async def complete(system: str, prompt: str, cfg: dict, usage: Usage) -> str:
    out = []
    async for piece in stream_reply(system, [{"role": "user", "content": prompt}], cfg, usage):
        out.append(piece)
    return "".join(out)


# ── Voice (text-to-speech) ──────────────────────────────────────────────────────
async def speak(text: str, cfg: dict, controls: dict, style: str = "") -> tuple[bytes, int]:
    provider = cfg.get("provider", "openai")
    if provider == "openai":
        body = {"model": cfg.get("model", "gpt-4o-mini-tts"), "voice": cfg.get("voice", "coral"), "input": text, "response_format": "pcm",
                "speed": float(controls.get("speed", 1.0))}
        if style:
            body["instructions"] = style[:1500]
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            r = await c.post("https://api.openai.com/v1/audio/speech", headers={"Authorization": f"Bearer {_key('openai')}"}, json=body)
        if r.status_code != 200:
            raise ProviderError(f"openai speech {r.status_code}: {r.text[:200]}")
        return r.content, 24000  # 16-bit little-endian mono at 24 kHz
    if provider == "gemini":
        import base64
        model = cfg.get("model", "gemini-2.5-flash-preview-tts")
        prompt = f"{style}\n\n{text}" if style else text
        body = {"contents": [{"parts": [{"text": prompt}]}], "generationConfig": {"responseModalities": ["AUDIO"],
                "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": cfg.get("voice", "Kore")}}}}}
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            r = await c.post(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent", params={"key": _key("gemini")}, json=body)
        if r.status_code != 200:
            raise ProviderError(f"gemini speech {r.status_code}: {r.text[:200]}")
        part = (r.json().get("candidates") or [{}])[0].get("content", {}).get("parts", [{}])[0]
        data = (part.get("inlineData") or part.get("inline_data") or {}).get("data")
        if not data:
            raise ProviderError("gemini speech: no audio")
        return base64.b64decode(data), 24000  # 16-bit PCM mono at 24 kHz
    raise ProviderError(f"voice provider {provider} not supported")
