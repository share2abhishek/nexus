# Voice gateway

The AI voice assistant's audio side (`docs/platform/VOICE-AGENTS.md`). Nexus handles WhatsApp's call signalling and
sends this service Meta's SDP offer. The gateway answers with its own SDP, holds the call audio (WebRTC, Opus) and
runs the turn loop.

The loop: voice detection with barge-in, then speech-to-text, then a streamed AI reply, then the voice, sentence by
sentence. The AI and speech steps use the OpenAI, Gemini or Anthropic APIs with your keys; no model is installed. It
also handles hand-over and end markers, silence and maximum-length limits, a hold line, and the end-of-call summary.
It sends Nexus signed events (turns, hand-over, end) and the stereo recording.

## Keys (gateway environment only; never sent with call data)
| Variable | Used for |
|---|---|
| `OPENAI_API_KEY` | speech-to-text (`gpt-4o-transcribe`), voice (`gpt-4o-mini-tts`), or the AI replies |
| `ANTHROPIC_API_KEY` | AI replies (Claude); Anthropic has no speech API |
| `GEMINI_API_KEY` | speech-to-text, voice or AI replies with Gemini |
| `VOICE_GATEWAY_SECRET` | the same 32+ character secret as Nexus `VOICE_GATEWAY_SECRET` |

The assistant's `models` setting in Nexus chooses the provider and model for each step.

## Lab: talk to the assistant in the browser
```
cd voice-gateway
uv venv .venv && uv pip install -p .venv -e ".[test]"
OPENAI_API_KEY=… ANTHROPIC_API_KEY=… VOICE_LAB=1 .venv/bin/python -m voice_gateway.server
# open http://127.0.0.1:3400/lab (use headphones)
```
`lab-assistant.json` holds the UrbanSociety "Sneha" setup (VOICE-AGENTS Appendix A). The page shows the transcript and
the timing of each turn. Recordings go to `recordings/`, which git ignores.

## Tests
`.venv/bin/python -m pytest -q` runs a real WebRTC call between two local peers with the AI providers faked.

## Production (V2)
Docker with `network_mode: host`, HTTP on 127.0.0.1:3400, and UDP open in the EC2 security group for the call audio.
Nexus settings: `VOICE_ENABLED=true`, `VOICE_GATEWAY_URL=http://127.0.0.1:3400`, `VOICE_GATEWAY_SECRET`.
