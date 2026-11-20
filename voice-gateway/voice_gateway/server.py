"""HTTP side of the voice gateway.

  POST /sessions               (signed by Nexus) { callId, sdpOffer, assistant, knowledge, caller, callbackUrl } -> { sdpAnswer }
  POST /sessions/{id}/end      (signed by Nexus)
  GET  /health
  Lab only (VOICE_LAB=1, bind to 127.0.0.1): GET /lab, POST /lab/offer, GET /lab/{id}/events, POST /lab/{id}/end

Run: python -m voice_gateway.server
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid

from aiohttp import web

from . import config
from .session import CallSession
from .sign import verify

log = logging.getLogger("voice")
sessions: dict[str, CallSession] = {}
HERE = os.path.dirname(__file__)


def signed(handler):
    async def wrapped(request: web.Request):
        body = await request.read()
        if not verify(body, request.headers.get("X-Voice-Signature"), config.SECRET):
            return web.json_response({"error": "bad signature"}, status=401)
        request["json"] = json.loads(body or b"{}")
        return await handler(request)
    return wrapped


async def _forget_later(call_id: str, s: CallSession):
    while not s.ended:
        await asyncio.sleep(5)
    await asyncio.sleep(60)
    sessions.pop(call_id, None)


@signed
async def create_session(request: web.Request):
    b = request["json"]
    call_id, offer = str(b.get("callId") or ""), b.get("sdpOffer")
    if not call_id or not offer:
        return web.json_response({"error": "callId and sdpOffer are required"}, status=400)
    if call_id in sessions:
        return web.json_response({"error": "session exists"}, status=409)
    s = CallSession(call_id, b.get("assistant") or {}, b.get("knowledge") or {}, b.get("caller") or {}, b.get("callbackUrl"))
    sessions[call_id] = s
    try:
        answer = await asyncio.wait_for(s.answer(offer), timeout=15)
    except Exception as e:  # noqa: BLE001 - any failure here means the call can't be answered
        sessions.pop(call_id, None)
        await s.pc.close()
        log.warning("call %s: could not answer: %s", call_id, e)
        return web.json_response({"error": "could not answer"}, status=500)
    asyncio.ensure_future(_forget_later(call_id, s))
    return web.json_response({"sdpAnswer": answer})


@signed
async def end_session(request: web.Request):
    s = sessions.get(request.match_info["id"])
    if s:
        await s.end("nexus_end")
    return web.json_response({"ok": True})


async def health(_):
    return web.json_response({"ok": True, "sessions": len(sessions), "keys": {k: bool(v) for k, v in config.KEYS.items()}})


# ── Lab: talk to the assistant from the browser (same audio path as WhatsApp) ─────────────────────────────────
def lab_assistant() -> dict:
    path = os.environ.get("VOICE_LAB_ASSISTANT", os.path.join(HERE, "..", "lab-assistant.json"))
    with open(path, encoding="utf-8") as f:
        return json.load(f)


async def lab_page(_):
    return web.FileResponse(os.path.join(HERE, "lab.html"))


async def lab_offer(request: web.Request):
    b = await request.json()
    conf = lab_assistant()
    call_id = "lab-" + uuid.uuid4().hex[:10]
    s = CallSession(call_id, conf["assistant"], conf.get("knowledge") or {}, {"name": None}, None, lab=True)
    sessions[call_id] = s
    answer = await s.answer(b["sdp"])
    asyncio.ensure_future(_forget_later(call_id, s))
    return web.json_response({"id": call_id, "sdp": answer, "type": "answer"})


async def lab_events(request: web.Request):
    s = sessions.get(request.match_info["id"])
    if not s:
        return web.json_response({"error": "not found"}, status=404)
    return web.json_response({"ended": s.ended, "events": s.events})


async def lab_end(request: web.Request):
    s = sessions.get(request.match_info["id"])
    if s:
        await s.end("lab_end")
    return web.json_response({"ok": True})


def make_app() -> web.Application:
    app = web.Application(client_max_size=2 * 1024 * 1024)
    app.add_routes([web.get("/health", health), web.post("/sessions", create_session), web.post("/sessions/{id}/end", end_session)])
    if config.LAB:
        app.add_routes([web.get("/lab", lab_page), web.post("/lab/offer", lab_offer), web.get("/lab/{id}/events", lab_events), web.post("/lab/{id}/end", lab_end)])
    return app


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(message)s")
    if not config.LAB and len(config.SECRET) < 32:
        raise SystemExit("VOICE_GATEWAY_SECRET must be at least 32 characters")
    web.run_app(make_app(), host=config.HOST, port=config.PORT)


if __name__ == "__main__":
    main()
