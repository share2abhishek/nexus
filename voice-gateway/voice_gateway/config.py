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

ENV_FILE = os.path.join(os.path.dirname(__file__), "..", ".env")  # local only; git ignores it


def _file_env() -> dict:
    out = {}
    try:
        with open(ENV_FILE, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    out[k.strip()] = v.strip().strip('"').strip("'")
    except OSError:
        pass
    return out


def key(provider: str) -> str | None:
    """Read on every use, so a key added to .env works without a restart."""
    names = {"openai": ["OPENAI_API_KEY"], "anthropic": ["ANTHROPIC_API_KEY"], "gemini": ["GEMINI_API_KEY", "GOOGLE_API_KEY"], "groq": ["GROQ_API_KEY"]}[provider]
    f = _file_env()
    for n in names:
        v = f.get(n) or env(n)  # voice-gateway/.env wins over the shell
        if v:
            return v
    return None


class _Keys(dict):
    def get(self, provider, default=None):  # noqa: D401 - dict-like view used by /health
        return key(provider) or default

    def items(self):
        return [(p, key(p)) for p in ("openai", "anthropic", "gemini", "groq")]


KEYS = _Keys()
