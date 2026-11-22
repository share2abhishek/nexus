# Voice assistant: sample recording kit (UrbanSociety PoC)

**Why:** phase V1 (speech lab, `docs/platform/VOICE-AGENTS.md` 12) chooses our in-house speech-to-text and voice by testing
them on how real committee members talk: Hinglish, Marathi and Gujarati mixed in, flat numbers, amounts, society words,
phone audio and background noise. Synthetic or studio speech would hide the real problems.

**Who records:** 8–10 people. Mix men and women, young and older, and accents (Pune, Mumbai, Ahmedabad or Surat, and the
Hindi belt). Committee members, residents, friends and staff are all fine.

**Consent (read and keep):** before recording, each person reads or agrees to:
> "I agree that Radixile may use this recording to test its voice assistant. It will not be published, it will be deleted
> when the test ends, and I can ask for it to be deleted at any time."

Note the person's first name, age range, home city and languages. No other personal data.

**How to record**
- Use a phone: a WhatsApp voice note to the team, or the phone's recorder app. Don't use a studio microphone.
- Record each part twice: once in a quiet room, once with normal noise (TV, traffic, kitchen, a lift lobby).
- Speak naturally. Change words to how you would really say them; that is the point.
- File name: `<first-name>_<lang>_<part>_<quiet|noisy>.<ext>`, for example `meera_hinglish_A_quiet.ogg`.
- Upload to the shared folder the owner names. Never send them to anyone outside the team.
- **Retention:** kept only for the V1 test and deleted when V1 ends (or earlier on request). Results keep scores, not audio.

---

## Part A: lines to read (about 5 minutes per person)

### Hinglish (everyone)
1. Hello, main A wing ke flat 1204 se bol raha hoon, maintenance bill ke baare mein poochna tha.
2. Hamari society mein 240 flats hain, chaar wings hain, A se D tak.
3. Abhi hum sab kuch Excel aur register mein karte hain, bahut time jaata hai.
4. Pichhle mahine ka maintenance 4,800 rupaye tha, UPI se pay kiya tha, receipt nahi mili.
5. Sinking fund aur repair fund alag dikhna chahiye member ke statement mein.
6. Hamara treasurer har mahine bank statement match karta hai, do din lagte hain.
7. AGM 18 May ko hai, uske pehle sab dues clear chahiye.
8. Lift AMC ka bill Schindler se aaya hai, 18,000 ka, NEFT se dena hai.
9. Gate par Amazon delivery ke liye OTP wala system hai kya?
10. Clubhouse booking Saturday shaam 7 baje ke liye karni hai.
11. Committee ko pehle demo dikhana padega, phir hi decide karenge.
12. Per flat 15 rupaye mahina matlab 100 flats ka 1,500 hua na?
13. Kya ye Android app mein chalega? Hamare bahut members iPhone use karte hain.
14. Data safe rahega na? Kisi aur society ko hamara data toh nahi dikhega?
15. Mera naam Prakash Kulkarni hai, main society ka secretary hoon.
16. Mera number hai nau aath saat chhe, paanch chaar teen, do ek zero. (9876 543 210, a made-up number: read it your own way, digits, pairs or English)
17. Kal subah 11 baje ya parso shaam 6 baje demo rakh sakte hain.
18. Nahi nahi, abhi nahi, main meeting mein hoon, baad mein call karna.
19. Aap insaan ho ya computer? Mujhe kisi person se baat karni hai.
20. Theek hai, WhatsApp pe link bhej do, main committee group mein daal dunga.

### Marathi (Marathi speakers)
21. Namaskar, mi B wing madhun boltoy, flat number 702.
22. Aamchya society madhe ekshe vees flats aahet. (120)
23. Maintenance bill dar mahinyala vel var yet nahi, members tension gheta.
24. Committee meeting Ravivari aahe, tevha demo dakhvaa.
25. Kiti paise lagtil mahinyala, ekdam clear sanga.
26. Watchman la visitor entry sathi app vaparta yeil ka?
27. Majha naav Sunita Deshpande, mi treasurer aahe.
28. Udya sakali dahala call kara, aata vel nahi.
29. Hey Marathi madhe pan chalta ka?
30. Thik aahe, chaala, demo book kara.

### Gujarati (Gujarati speakers)
31. Kem cho, hu C wing, flat number 304 thi bolu chhu.
32. Amari society ma so ne pachaas flats chhe. (150)
33. Maintenance ni receipt WhatsApp par mali jaay to saru.
34. Committee ne pehla demo batavvo padshe.
35. Mahine ketla rupiya thashe, ek flat na?
36. Gate pass mate OTP aave chhe ke nahi?
37. Maru naam Hetal Shah chhe, hu secretary chhu.
38. Kaale saanje chha vaage call karjo.
39. Aa Gujarati ma pan chaale chhe?
40. Saru, demo book kari do.

---

## Part B: role-play calls (2–4 minutes each, two people, one plays Sneha from the script in VOICE-AGENTS A.4)

Record both sides, as a speaker-phone call or a WhatsApp call recorded on a second phone.

| # | Caller | Situation to act | What it tests |
|---|---|---|---|
| B1 | Chairman, Pune, 240 flats | Uses Excel; wants a demo for the committee on Sunday | the happy path, numbers, dates |
| B2 | Treasurer, Mumbai | Talks over Sneha twice to ask about bank reconciliation | interruptions (barge-in) |
| B3 | Secretary, Ahmedabad | Starts in Hinglish, switches to Gujarati halfway | language switch mid-call |
| B4 | Resident, Thane | Wrong person: not on the committee; asks how to tell the committee | polite qualification, no hard sell |
| B5 | Committee member, Nashik | "Already using another app", unhappy about its support | objection, no criticism of others |
| B6 | Chairman, 800 flats | Asks for a discount | custom-plan hand-over |
| B7 | Elderly member, Pune | Speaks slowly, asks to repeat the price twice | slow speech, repetition, patience |
| B8 | Busy caller | "Meeting mein hoon, baad mein" within 10 seconds | scheduling a call-back |
| B9 | Curious caller | "Aap insaan ho ya robot?" | the honest AI-assistant answer, then carry on |
| B10 | Existing customer | Complains that a bill went out wrong | hand-over to staff, no promises |
| B11 | Caller in a noisy place | Traffic or a festival in the background | noise handling |
| B12 | Late-night caller (after 22:00) | Wants to talk to a person now | out-of-hours call-back promise |

---

## What V1 measures from these recordings

| Measure | How | Target to pass |
|---|---|---|
| Word error rate (STT) | our transcript vs a human-corrected one, per language and quiet or noisy | lowest of the candidates; under about 20% on noisy Hinglish |
| Key details right (STT) | flat numbers, amounts, dates, names, phone numbers exactly right | 95% or more |
| Naturalness of the voice (TTS) | 5 listeners score Sneha's lines 1–5, mixed with real human clips, without being told which is which | average 4 or more |
| Pronunciation (TTS) | society words, Marathi and Gujarati names, rupee amounts | no wrong ones in the pilot lines |
| Turn latency (whole loop) | from the caller stopping to Sneha starting, on the test page | median under 1.5 s |
| Barge-in | Sneha stops after the caller starts talking | under 200 ms |

Results go into `docs/platform/UAT-LOG.md` with the model names and versions tested.
