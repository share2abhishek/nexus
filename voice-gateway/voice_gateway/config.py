"""Settings from the environment. API keys stay in the gateway's own environment and never travel with call data."""
import os


def env(name, default=None):
    v = os.environ.get(name)
    return v if v not in (None, "") else default


HOST = env("VOICE_GATEWAY_HOST", "127.0.0.1")
PORT = int(env("VOICE_GATEWAY_PORT", "3400"))
SECRET = env("VOICE_GATEWAY_SECRET", "")
LAB = env("VOICE_LAB", "0") == "1"  # the browser test page; never on production
STUN_URLS = [u for u in (env("VOICE_STUN_URLS", "stun:stun.l.google.com:19302") or "").split(",") if u]
RECORDINGS_DIR = env("VOICE_RECORDINGS_DIR", os.path.join(os.path.dirname(__file__), "..", "recordings"))

KEYS = {
    "openai": env("OPENAI_API_KEY"),
    "anthropic": env("ANTHROPIC_API_KEY"),
    "gemini": env("GEMINI_API_KEY") or env("GOOGLE_API_KEY"),
}
