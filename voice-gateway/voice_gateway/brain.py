"""What the assistant says: the system prompt, splitting a streamed reply into sentences for the voice, the control
markers ([[HANDOVER: …]] and [[END]]), and the end-of-call summary. Pure functions, tested in tests/test_brain.py."""
from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30))
OUTCOMES = ["interested", "callback", "visit_booked", "demo_booked", "not_interested", "wrong_number", "no_answer", "handover", "dropped"]

HANDOVER_RE = re.compile(r"\[\[\s*HANDOVER\s*:?\s*([^\]]*)\]\]", re.I)
END_RE = re.compile(r"\[\[\s*END\s*\]\]", re.I)
ANY_MARKER_RE = re.compile(r"\[\[[^\]]*\]\]")
SENTENCE_END = re.compile(r"(.+?[.!?।]+)(\s+|$)", re.S)


def in_hours(handover: dict, now: datetime | None = None) -> bool:
    now = (now or datetime.now(IST)).astimezone(IST)
    days = handover.get("days") or [0, 1, 2, 3, 4, 5, 6]
    if (now.weekday() + 1) % 7 not in days:  # Sunday = 0, as in JavaScript
        return False
    hhmm = now.strftime("%H:%M")
    return handover.get("hoursFrom", "08:00") <= hhmm < handover.get("hoursTo", "22:00")


def system_prompt(assistant: dict, knowledge: dict, caller: dict, now: datetime | None = None) -> str:
    now = (now or datetime.now(IST)).astimezone(IST)
    h = assistant.get("handover") or {}
    staff = "available now" if in_hours(h, now) else f"not available now (they work {h.get('hoursFrom', '08:00')}–{h.get('hoursTo', '22:00')} IST)"
    faqs = "\n".join(f"Q: {f['q']}\nA: {f['a']}" for f in (knowledge.get("faqs") or [])[:40])
    kb = (knowledge.get("text") or "")[:12000]
    who = f"The caller is {caller['name']} (a known lead)." if caller.get("name") else "The caller is not known yet."
    return f"""You are {assistant.get('name', 'Sneha')}, the AI assistant of this business, speaking on a live WhatsApp voice call.

How you speak:
- Like a warm, polite person on the phone: one or two short sentences per turn, then let the caller talk.
- Hinglish by default. If the caller speaks Marathi, Gujarati or another language, reply in it or mix in their words.
- Plain spoken words only: no lists, no markdown, no emojis, no links read out letter by letter. Say amounts like "pandrah rupaye" or "fifteen rupees", naturally.
- You are an AI assistant. If asked whether you are a person or a computer, say honestly that you are the business's AI assistant, then carry on helping.
- Never invent facts, prices, offers or dates that are not in the knowledge below. If you don't know, say a team member will call back.
- Never ask for card numbers, OTPs, passwords or bank details.

Hand-over: staff are {staff}. When the caller asks for a person, is upset, or you could not answer twice, say so kindly and add the marker [[HANDOVER: one-line note for staff]] at the end of your reply.
Ending: when the caller is done and you have said goodbye, add [[END]] at the end of your reply.
Markers are never spoken; everything else is.

Current time: {now.strftime('%A %d %B %Y, %H:%M')} IST. {who}

Business instructions:
{assistant.get('instructions') or '(none)'}

Knowledge (FAQs):
{faqs or '(none)'}

Knowledge (notes):
{kb or '(none)'}"""


def tts_style(assistant: dict) -> str:
    return ("Speak as a warm, friendly young Indian woman on a phone call, in natural Hinglish with an Indian accent. "
            "Calm, clear and unhurried; sound like a person, not an announcer.")


class SentenceChunker:
    """Collects streamed text and gives back whole sentences for the voice. Markers are held back, never spoken."""

    def __init__(self, max_len: int = 160):
        self.buf = ""
        self.max_len = max_len
        self.full = ""

    def feed(self, piece: str) -> list[str]:
        self.buf += piece
        self.full += piece
        out = []
        while True:
            clean = self.buf
            # don't speak half a marker: wait for the closing ]]
            if "[[" in clean and "]]" not in clean[clean.rfind("[["):]:
                head = clean[: clean.rfind("[[")]
            else:
                head = clean
            m = SENTENCE_END.match(head)
            if m:
                out.append(m.group(1))
                self.buf = self.buf[m.end():]
                continue
            if len(head) > self.max_len and "," in head:
                cut = head.rfind(",") + 1
                out.append(head[:cut])
                self.buf = self.buf[cut:]
                continue
            break
        return [s for s in (speakable(x) for x in out) if s]

    def flush(self) -> list[str]:
        rest, self.buf = self.buf, ""
        s = speakable(rest)
        return [s] if s else []


def speakable(text: str) -> str:
    return re.sub(r"\s+", " ", ANY_MARKER_RE.sub("", text)).strip(" -*_#")


def markers(full_reply: str) -> dict:
    h = HANDOVER_RE.search(full_reply)
    return {"handover": (h.group(1).strip() or "The caller asked for a person.") if h else None, "end": bool(END_RE.search(full_reply))}


SUMMARY_SYSTEM = "You summarise phone calls for a sales team. Reply with JSON only."


def summary_prompt(turns: list[dict]) -> str:
    lines = "\n".join(f"{t['speaker']}: {t['text']}" for t in turns)
    return f"""Here is a call between our AI assistant and a caller.

{lines}

Return JSON: {{"summary": "2 short sentences in English: who called, what they need, what was agreed",
"outcome": one of {json.dumps(OUTCOMES)}, "next_step": "one line, or empty"}}"""


def parse_summary(text: str) -> dict:
    m = re.search(r"\{.*\}", text or "", re.S)
    try:
        j = json.loads(m.group(0)) if m else {}
    except json.JSONDecodeError:
        j = {}
    outcome = j.get("outcome") if j.get("outcome") in OUTCOMES else None
    return {"summary": str(j.get("summary") or "")[:2000] or None, "outcome": outcome, "next_step": str(j.get("next_step") or "")[:400] or None}
