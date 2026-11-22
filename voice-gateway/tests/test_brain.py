from datetime import datetime

from voice_gateway import brain
from voice_gateway.sign import sign, verify


def test_sentences_stream_out_whole_and_markers_are_never_spoken():
    c = brain.SentenceChunker()
    out = []
    for piece in ["Namaste ji! Aapki society", " mein kitne flats hain? Main demo", " book kar deti hoon. [[HAND", "OVER: wants 800 flats price]]"]:
        out += c.feed(piece)
    out += c.flush()
    assert out == ["Namaste ji!", "Aapki society mein kitne flats hain?", "Main demo book kar deti hoon."]
    assert brain.markers(c.full) == {"handover": "wants 800 flats price", "end": False}


def test_end_marker_and_hindi_full_stop():
    c = brain.SentenceChunker()
    out = c.feed("Dhanyavaad। Aapka din achha rahe! [[END]]") + c.flush()
    assert out == ["Dhanyavaad।", "Aapka din achha rahe!"]
    assert brain.markers(c.full)["end"] is True


def test_long_sentence_breaks_at_a_comma():
    c = brain.SentenceChunker(max_len=40)
    out = c.feed("Bills apne aap schedule par chale jaate hain, har flat ko statement milta hai")
    assert out == ["Bills apne aap schedule par chale jaate hain,"]


def test_hours_and_prompt():
    h = {"hoursFrom": "08:00", "hoursTo": "22:00", "days": [0, 1, 2, 3, 4, 5, 6]}
    ist = brain.IST
    assert brain.in_hours(h, datetime(2026, 11, 22, 9, 0, tzinfo=ist))
    assert not brain.in_hours(h, datetime(2026, 11, 22, 22, 30, tzinfo=ist))
    p = brain.system_prompt({"name": "Sneha", "instructions": "Sell UrbanSociety", "handover": h}, {"faqs": [{"q": "Price?", "a": "15 per flat"}]}, {}, datetime(2026, 11, 22, 23, 0, tzinfo=ist))
    assert "Sneha" in p and "Sell UrbanSociety" in p and "Q: Price?" in p and "not available now" in p and "AI assistant" in p


def test_summary_parsing_is_strict():
    s = brain.parse_summary('Sure: {"summary": "Chairman, 240 flats.", "outcome": "demo_booked", "next_step": "Demo Sunday"}')
    assert s == {"summary": "Chairman, 240 flats.", "outcome": "demo_booked", "next_step": "Demo Sunday"}
    assert brain.parse_summary('{"outcome": "sold_everything"}')["outcome"] is None
    assert brain.parse_summary("not json") == {"summary": None, "outcome": None, "next_step": None}


def test_signature_matches_nexus_scheme():
    s = "x" * 40
    h = sign(b'{"a":1}', s, t=1700000000)
    assert verify(b'{"a":1}', h, s, now=1700000100)
    assert not verify(b'{"a":2}', h, s, now=1700000100)
    assert not verify(b'{"a":1}', h, s, now=1700000400)
