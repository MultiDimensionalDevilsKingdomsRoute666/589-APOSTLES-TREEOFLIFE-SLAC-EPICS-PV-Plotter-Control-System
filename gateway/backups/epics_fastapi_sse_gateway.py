#!/usr/bin/env python3
"""
EPICS Channel Access SSE Gateway using FastAPI + caproto

- GET /sse?pv=PV:NAME  streams PV updates via Server-Sent Events (SSE)
- GET /health
- GET /api/subscriptions

Run:
  python epics_fastapi_sse_gateway.py
or:
  uvicorn epics_fastapi_sse_gateway:app --host 0.0.0.0 --port 8001
"""

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Dict, Optional, AsyncIterator

import numpy as np
from caproto.asyncio.client import Context
from fastapi import FastAPI, Query
from fastapi import Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import uvicorn

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("epics_sse_gateway")

CA_CONTEXT: Optional[Context] = None

# Track active SSE subscriptions
# key: client_id, value: caproto subscription
active_subscriptions: Dict[str, object] = {}


def extract_value(data):
    # Similar to your WebSocket gateway helper
    if hasattr(data, "__iter__") and not isinstance(data, (str, bytes)):
        try:
            result = []
            for item in data:
                if isinstance(item, bytes):
                    result.append(item.decode("utf-8", errors="replace").rstrip("\x00"))
                elif isinstance(item, (np.number, int, float)):
                    result.append(float(item))
                else:
                    result.append(item)
            return result[0] if len(result) == 1 else result
        except Exception:
            pass

    if isinstance(data, bytes):
        return data.decode("utf-8", errors="replace").rstrip("\x00")
    if isinstance(data, str):
        return data.rstrip("\x00")
    if hasattr(data, "tolist"):
        val = data.tolist()
        if isinstance(val, list) and len(val) == 1:
            v = val[0]
            return float(v) if isinstance(v, np.number) else v
        return val
    if isinstance(data, (int, float, np.number)):
        return float(data)

    try:
        return float(data)
    except (ValueError, TypeError):
        return str(data)


def sse_event(data: dict, event: str = "update", event_id: Optional[str] = None) -> str:
    """
    Format one SSE message.
    SSE format:
      id: <id>\n
      event: <event>\n
      data: <string>\n
      \n
    """
    payload = json.dumps(data, ensure_ascii=False)
    lines = []
    if event_id is not None:
        lines.append(f"id: {event_id}")
    if event:
        lines.append(f"event: {event}")
    lines.append(f"data: {payload}")
    return "\n".join(lines) + "\n\n"


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    global CA_CONTEXT
    log.info("Starting EPICS SSE Gateway...")
    CA_CONTEXT = Context()
    yield
    log.info("Shutting down... clearing subscriptions")
    for cid, sub in list(active_subscriptions.items()):
        try:
            sub.clear()
        except Exception as e:
            log.warning(f"Cleanup error for {cid}: {e}")
    active_subscriptions.clear()
    log.info("Cleanup complete")


app = FastAPI(
    title="EPICS SSE Gateway",
    version="1.0.0",
    description="Stream EPICS CA PV updates via Server-Sent Events (SSE)",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.head("/health")
async def health_head():
    return Response(
        status_code=200,
        headers={
            "X-Status": "healthy",
            "X-Active-Subscriptions": str(len(active_subscriptions)),
        },
    )


@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "active_subscriptions": len(active_subscriptions),
        "timestamp": datetime.now().isoformat(),
    }


@app.get("/api/subscriptions")
async def subscriptions():
    return {"count": len(active_subscriptions), "subscriptions": list(active_subscriptions.keys())}


@app.get("/sse")
async def sse(pv: str = Query(..., description="EPICS PV name to monitor via SSE")):
    """
    SSE endpoint:
      GET /sse?pv=PV:NAME

    Client example (browser):
      const es = new EventSource("http://host:8001/sse?pv=TEST:PV");
      es.onmessage = (e) => console.log(e.data);
    """
    if CA_CONTEXT is None:
        # should not happen if lifespan ran
        raise RuntimeError("CA context not initialized")

    # A simple client id (no direct access to client IP like WebSocket object)
    client_id = f"sse:{pv}:{datetime.now().timestamp()}"
    log.info(f"SSE subscribe: {client_id}")

    async def event_generator():
        subscription = None
        try:
            epics_pv, = await CA_CONTEXT.get_pvs(pv)

            # Send an initial value as a "snapshot" event
            initial = await epics_pv.read(data_type="time")
            snapshot = {
                "pv": pv,
                "value": extract_value(initial.data),
                "timestamp": initial.metadata.timestamp,
                "status": initial.metadata.status,
                "severity": initial.metadata.severity,
                "type": "snapshot",
            }
            yield sse_event(snapshot, event="snapshot", event_id="0")

            # Subscribe for updates
            subscription = epics_pv.subscribe(data_type="time")
            active_subscriptions[client_id] = subscription

            event_count = 0
            async for ev in subscription:
                event_count += 1
                msg = {
                    "pv": pv,
                    "value": extract_value(ev.data),
                    "timestamp": ev.metadata.timestamp,
                    "status": ev.metadata.status,
                    "severity": ev.metadata.severity,
                    "type": "update",
                }
                yield sse_event(msg, event="update", event_id=str(event_count))

        except asyncio.CancelledError:
            # Happens when client disconnects and StreamingResponse cancels the generator
            raise
        except Exception as e:
            err = {"pv": pv, "error": str(e), "type": "error", "timestamp": datetime.now().isoformat()}
            yield sse_event(err, event="error")
        finally:
            # cleanup subscription
            if subscription is not None:
                try:
                    subscription.clear()
                except Exception:
                    pass
            active_subscriptions.pop(client_id, None)
            log.info(f"SSE cleaned up: {client_id}")

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            # If behind nginx, you may also want: "X-Accel-Buffering": "no"
        },
    )


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8001, log_level="info")
