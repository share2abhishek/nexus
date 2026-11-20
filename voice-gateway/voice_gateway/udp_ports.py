"""Keep call audio inside one UDP port range (VOICE_UDP_PORTS, for example "40000-40199"), so the server's firewall
opens only that range. aioice (the ICE library under aiortc) always asks for any free port; this wraps the event loop's
UDP bind so a request for "any port" picks a free one inside the range instead."""
from __future__ import annotations

import asyncio
import itertools
import os
import random

_installed = False


def parse(spec: str | None) -> range | None:
    if not spec:
        return None
    lo, _, hi = spec.partition("-")
    lo, hi = int(lo), int(hi or lo)
    if not (1024 <= lo <= hi <= 65535):
        raise ValueError(f"VOICE_UDP_PORTS must be like 40000-40199, got {spec!r}")
    return range(lo, hi + 1)


def install(spec: str | None = None) -> range | None:
    global _installed
    ports = parse(spec if spec is not None else os.environ.get("VOICE_UDP_PORTS", "40000-40199"))
    if not ports or _installed:
        return ports
    original = asyncio.base_events.BaseEventLoop.create_datagram_endpoint

    async def create_datagram_endpoint(self, protocol_factory, local_addr=None, remote_addr=None, **kw):
        if not local_addr or local_addr[1] != 0:
            return await original(self, protocol_factory, local_addr=local_addr, remote_addr=remote_addr, **kw)
        start = random.randrange(len(ports))
        last = None
        for i in itertools.islice(itertools.cycle(range(len(ports))), start, start + len(ports)):
            try:
                return await original(self, protocol_factory, local_addr=(local_addr[0], ports[i]), remote_addr=remote_addr, **kw)
            except OSError as e:  # in use: try the next one
                last = e
        raise OSError(f"no free UDP port in {ports.start}-{ports.stop - 1}") from last

    asyncio.base_events.BaseEventLoop.create_datagram_endpoint = create_datagram_endpoint
    _installed = True
    return ports
