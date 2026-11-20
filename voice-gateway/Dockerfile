# Voice gateway (docs/platform/VOICE-AGENTS.md 2.2). Runs with host networking: WebRTC needs UDP straight to the host.
FROM python:3.11-slim
WORKDIR /app
COPY pyproject.toml ./
COPY voice_gateway ./voice_gateway
RUN pip install --no-cache-dir .
ENV VOICE_GATEWAY_HOST=127.0.0.1 VOICE_GATEWAY_PORT=3400
CMD ["python", "-m", "voice_gateway.server"]
