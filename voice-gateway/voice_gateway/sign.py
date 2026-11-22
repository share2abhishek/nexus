"""Signed requests with Nexus: X-Voice-Signature: t=<epoch>,v1=<hex HMAC-SHA256 of "<t>.<sha256 hex of body>">.
The same scheme as services/voice/sign.js; a 300 s window."""
import hashlib
import hmac
import time

WINDOW = 300


def sign(body: bytes, secret: str, t: int | None = None) -> str:
    t = int(time.time()) if t is None else t
    mac = hmac.new(secret.encode(), f"{t}.{hashlib.sha256(body).hexdigest()}".encode(), hashlib.sha256).hexdigest()
    return f"t={t},v1={mac}"


def verify(body: bytes, header: str | None, secret: str, now: int | None = None) -> bool:
    if not secret or not header:
        return False
    try:
        parts = dict(p.strip().split("=", 1) for p in header.split(","))
        t = int(parts["t"])
        got = parts["v1"]
    except (KeyError, ValueError):
        return False
    now = int(time.time()) if now is None else now
    if abs(now - t) > WINDOW:
        return False
    want = hmac.new(secret.encode(), f"{t}.{hashlib.sha256(body).hexdigest()}".encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(want, got)
