#!/usr/bin/env python3
"""
EPICS Channel Access WebSocket Gateway using FastAPI + caproto

This gateway translates EPICS Channel Access protocol to WebSocket,
allowing web browsers and other WebSocket clients to monitor and 
control EPICS Process Variables (PVs) in real-time.

Author: Your Name
License: MIT
"""

import asyncio
import logging
from typing import Dict, Optional, AsyncIterator
from datetime import datetime
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi import Response
import uvicorn

from routers import config as config_router
from routers import thresholds as thresholds_router
from caproto.asyncio.client import Context
import numpy as np

# ================================================================
# Logging Configuration
# ================================================================
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%H:%M:%S'
)
log = logging.getLogger(__name__)

# ================================================================
# Global State Management
# ================================================================
# Global caproto Context for Channel Access communication
CA_CONTEXT: Optional[Context] = None

# Dictionary to track active WebSocket subscriptions
# Key: "client_ip:client_port:pv_name", Value: caproto subscription object
active_subscriptions: Dict[str, any] = {}

# ================================================================
# Application Lifecycle Management
#
# ================================================================

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """
    Manage application lifespan events using modern FastAPI approach.
    
    This replaces the deprecated @app.on_event("startup") and @app.on_event("shutdown")
    decorators with the new lifespan context manager.
    
    Yields control to the application, then runs cleanup on shutdown.
    """
    global CA_CONTEXT
    
    # ============================================================
    # STARTUP: Initialize resources
    # ============================================================
    log.info("🚀 Starting EPICS WebSocket Gateway...")
    
    # Create caproto context for Channel Access protocol.
    # client_name is passed explicitly because caproto otherwise falls back
    # to getpass.getuser(), which fails when running as a uid with no
    # matching /etc/passwd entry inside the container (e.g. when the
    # container is run as the host's own uid to satisfy NFS permissions -
    # see docker-compose.yml).
    CA_CONTEXT = Context(client_name="epics-pv-plotter")
    
    # Display startup banner
    log.info("╔════════════════════════════════════════════════════════╗")
    log.info("║   EPICS Channel Access WebSocket Gateway (FastAPI)    ║")
    log.info("║   Running on http://0.0.0.0:8000                       ║")
    log.info("╚════════════════════════════════════════════════════════╝")
    log.info("")
    log.info("📖 API Docs    : http://localhost:8000/docs")
    log.info("📖 ReDoc       : http://localhost:8000/redoc")
    log.info("🔗 WebSocket   : ws://localhost:8000/ws?pv=YOUR:PV:NAME")
    log.info("💚 Health Check: http://localhost:8000/health")
    log.info("")
    
    # Yield control to the application
    # Everything after this runs on shutdown
    yield
    
    # ============================================================
    # SHUTDOWN: Clean up resources
    # ============================================================
    log.info("🛑 Shutting down...")
    log.info("🧹 Cleaning up active subscriptions...")
    
    # Iterate through all active subscriptions and clean them up
    for client_id, subscription in list(active_subscriptions.items()):
        try:
            # Unsubscribe from EPICS PV
            subscription.clear()
        except Exception as e:
            # Log but don't fail shutdown
            log.warning(f"Error cleaning up {client_id}: {e}")
    
    # Clear the subscriptions dictionary
    active_subscriptions.clear()
    
    log.info("✅ Cleanup complete")


# ================================================================
# FastAPI Application Setup (with lifespan)
# ================================================================
app = FastAPI(
    title="EPICS WebSocket Gateway",
    description="Real-time EPICS Channel Access data streaming via WebSocket",
    version="1.0.0",
    docs_url="/docs",      # Swagger UI endpoint
    redoc_url="/redoc",    # ReDoc endpoint
    lifespan=lifespan      # NEW: Use lifespan context manager
)

# Add routers 
app.include_router(config_router.router)
app.include_router(thresholds_router.router)

# Enable CORS to allow frontend applications from different origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify exact origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ================================================================
# Helper Functions
# ================================================================

def extract_value(data):
    """
    Extract and normalize values from EPICS data types.
    
    EPICS returns various data types (DBR_STRING, DBR_FLOAT, DBR_LONG, etc.)
    This function converts them to Python-native types for JSON serialization.
    
    Args:
        data: Raw EPICS data from caproto (can be bytes, numpy array, etc.)
        
    Returns:
        Normalized Python value (str, float, int, or list)
        
    Example:
        DBR_STRING -> "text"
        DBR_FLOAT  -> 3.14
        DBR_LONG   -> 42
        Waveform   -> [1.0, 2.0, 3.0]
    """
    
    # Handle iterable types (arrays, strings) but exclude bytes and str
    if hasattr(data, '__iter__') and not isinstance(data, (str, bytes)):
        try:
            result = []
            for item in data:
                # Convert bytes to string (common for DBR_STRING)
                if isinstance(item, bytes):
                    result.append(item.decode('utf-8', errors='replace').rstrip('\x00'))
                # Convert numpy numeric types to Python float
                elif isinstance(item, (np.number, int, float)):
                    result.append(float(item))
                else:
                    result.append(item)
            
            # Return single value if array has only one element
            if len(result) == 1:
                return result[0]
            return result
        except Exception:
            pass  # Fall through to next handlers
    
    # Handle raw bytes (single DBR_STRING value)
    if isinstance(data, bytes):
        return data.decode('utf-8', errors='replace').rstrip('\x00')
    
    # Handle regular Python strings
    if isinstance(data, str):
        return data.rstrip('\x00')  # Remove null terminators
    
    # Handle numpy arrays (common for waveform records)
    if hasattr(data, 'tolist'):
        val = data.tolist()
        # Unwrap single-element arrays
        if isinstance(val, list) and len(val) == 1:
            v = val[0]
            # Convert numpy types to Python native types
            if isinstance(v, np.number):
                return float(v)
            return v
        return val
    
    # Handle numeric types (DBR_FLOAT, DBR_LONG, etc.)
    if isinstance(data, (int, float, np.number)):
        return float(data)
    
    # Fallback: try to convert to float, or return as string
    try:
        return float(data)
    except (ValueError, TypeError):
        return str(data)


# ================================================================
# REST API Endpoints (Optional Features)
# ================================================================

@app.get("/", response_class=HTMLResponse)
async def root():
    """
    Home page with usage instructions.
    
    Returns HTML page explaining how to use the WebSocket gateway.
    Accessible at: http://localhost:8000/
    """
    html = """
    <!DOCTYPE html>
    <html>
    <head>
        <title>EPICS WebSocket Gateway</title>
        <style>
            body { 
                font-family: 'Courier New', monospace; 
                margin: 40px; 
                background: #1e1e1e; 
                color: #d4d4d4; 
            }
            h1 { color: #4ec9b0; }
            h3 { color: #569cd6; }
            code { 
                background: #2d2d2d; 
                padding: 2px 6px; 
                border-radius: 3px; 
                color: #ce9178; 
            }
            pre { 
                background: #2d2d2d; 
                padding: 15px; 
                border-radius: 5px; 
                overflow-x: auto;
                color: #dcdcaa;
            }
            .endpoint { 
                margin: 20px 0; 
                padding: 15px; 
                background: #252526; 
                border-left: 3px solid #4ec9b0; 
            }
            a { color: #4ec9b0; text-decoration: none; }
            a:hover { text-decoration: underline; }
        </style>
    </head>
    <body>
        <h1>🚀 EPICS WebSocket Gateway</h1>
        <p>FastAPI + caproto WebSocket gateway for real-time EPICS data streaming</p>
        
        <div class="endpoint">
            <h3>📡 WebSocket Connection</h3>
            <p>Connect to a PV using query parameter:</p>
            <code>ws://localhost:8000/ws?pv=YOUR:PV:NAME</code>
            
            <h4>JavaScript Example:</h4>
            <pre>
// Connect to WebSocket
const ws = new WebSocket('ws://localhost:8000/ws?pv=test:ai');

// Handle incoming messages
ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log('PV:', data.pv);
    console.log('Value:', data.value);
    console.log('Timestamp:', data.timestamp);
    console.log('Status:', data.status);
    console.log('Severity:', data.severity);
};

// Handle connection open
ws.onopen = () => {
    console.log('Connected to EPICS PV');
};

// Handle errors
ws.onerror = (error) => {
    console.error('WebSocket error:', error);
};

// Handle connection close
ws.onclose = () => {
    console.log('Disconnected from EPICS PV');
};</pre>
        </div>
        
        <div class="endpoint">
            <h3>📖 API Documentation</h3>
            <p>Visit <a href="/docs">/docs</a> for interactive Swagger UI documentation</p>
            <p>Visit <a href="/redoc">/redoc</a> for ReDoc documentation</p>
        </div>
        
        <div class="endpoint">
            <h3>💚 Health Check</h3>
            <p><code>GET /health</code> - Check server status and active connections</p>
        </div>
        
        <div class="endpoint">
            <h3>📊 Active Subscriptions</h3>
            <p><code>GET /api/subscriptions</code> - List all active WebSocket subscriptions</p>
        </div>
    </body>
    </html>
    """
    return html

@app.head("/health")
async def health_head():
    return Response(

            status_code=200,
            headers={
                "X-Status": "healthy",
                "X-Active-Connections": str(len(active_subscriptions)),
                },

            )

@app.get("/health")
async def health_check():
    """
    Health check endpoint for monitoring and load balancers.
    
    Returns:
        JSON with server status, active connection count, and timestamp
        
    Example Response:
        {
            "status": "healthy",
            "active_connections": 3,
            "timestamp": "2024-01-15T10:30:45.123456"
        }
    """
    return {
        "status": "healthy",
        "active_connections": len(active_subscriptions),
        "timestamp": datetime.now().isoformat()
    }


@app.get("/api/subscriptions")
async def list_subscriptions():
    """
    List all active WebSocket subscriptions.
    
    Useful for debugging and monitoring which PVs are currently being watched.
    
    Returns:
        JSON with subscription count and list of client IDs
        
    Example Response:
        {
            "count": 2,
            "subscriptions": [
                "192.168.1.100:54321:test:ai",
                "192.168.1.101:54322:test:ao"
            ]
        }
    """
    return {
        "count": len(active_subscriptions),
        "subscriptions": list(active_subscriptions.keys())
    }


# ================================================================
# WebSocket Endpoint (Core Functionality)
# ================================================================

@app.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket, 
    pv: str = Query(..., description="EPICS PV name to monitor")
):
    """
    Main WebSocket endpoint for real-time PV monitoring.
    
    This endpoint:
    1. Accepts WebSocket connection
    2. Connects to the specified EPICS PV via Channel Access
    3. Sends initial PV value
    4. Streams real-time updates whenever the PV changes
    5. Handles client disconnection and cleanup
    
    Args:
        websocket: FastAPI WebSocket connection object
        pv: EPICS PV name (e.g., "test:ai", "IOC:m1.VAL")
        
    Query Parameters:
        ?pv=YOUR:PV:NAME (required)
        
    WebSocket Message Format (JSON):
        {
            "value": 3.14,           # PV value (type depends on EPICS record type)
            "timestamp": 1234567890, # EPICS timestamp (seconds since epoch)
            "status": 0,             # Alarm status
            "severity": 0,           # Alarm severity
            "pv": "test:ai"          # PV name
        }
        
    Example:
        ws://localhost:8000/ws?pv=test:ai
    """
    
    # Accept the WebSocket connection
    await websocket.accept()
    
    # Generate unique client identifier
    client_addr = f"{websocket.client.host}:{websocket.client.port}"
    client_id = f"{client_addr}:{pv}"
    
    # Log connection details (beautiful box format for readability)
    log.info("╔" + "=" * 58 + "╗")
    log.info("║ WebSocket Connection Established                        ║")
    log.info("╠" + "=" * 58 + "╣")
    log.info(f"║ PV Name      : {pv:<42} ║")
    log.info(f"║ Client IP    : {websocket.client.host:<42} ║")
    log.info(f"║ Client Port  : {websocket.client.port:<42} ║")
    log.info(f"║ Client ID    : {client_id:<42} ║")
    log.info("╚" + "=" * 58 + "╝")
    
    # Initialize subscription reference (used in finally block)
    subscription = None
    
    try:
        # ============================================================
        # Step 1: Connect to EPICS PV via Channel Access
        # ============================================================
        # caproto returns a tuple, we unpack the first element
        epics_pv, = await CA_CONTEXT.get_pvs(pv)
        
        # ============================================================
        # Step 2: Read initial value with timestamp metadata
        # ============================================================
        # data_type='time' includes timestamp, status, and severity
        initial_reading = await epics_pv.read(data_type='time')
        
        # Construct initial data message
        initial_data = {
            'value': extract_value(initial_reading.data),
            'timestamp': initial_reading.metadata.timestamp,  # EPICS timestamp
            'status': initial_reading.metadata.status,        # Alarm status
            'severity': initial_reading.metadata.severity,    # Alarm severity
            'pv': pv
        }
        # Send initial value to client
        await websocket.send_json(initial_data)
        log.info(f"✅ Connected to PV: {pv} = {initial_data['value']}")
        
        # ============================================================
        # Step 3: Subscribe to PV updates
        # ============================================================
        # This creates an async iterator that yields new values
        subscription = epics_pv.subscribe(data_type='time')
        
        # Track this subscription for cleanup and monitoring
        active_subscriptions[client_id] = subscription
        
        # ============================================================
        # Step 4: Stream updates to client
        # ============================================================
        # This loop continues until client disconnects or error occurs
        async for event in subscription:
            try:
                # Construct update message

                if log.isEnabledFor(logging.DEBUG):
                    raw_ts = event.metadata.timestamp
                    now = datetime.now()
                    log.debug(f"🕐 raw_ts={raw_ts}")
                    log.debug(f"   fromtimestamp={datetime.fromtimestamp(raw_ts)}")
                    log.debug(f"   now={now}")
                    log.debug(f"   diff_days={(datetime.fromtimestamp(raw_ts) - now).total_seconds() / 86400:.3f}")

                data = {
                    'value': extract_value(event.data),
                    'timestamp': event.metadata.timestamp,
                    'status': event.metadata.status,
                    'severity': event.metadata.severity,
                    'pv': pv
                }
                
                # Send update to client
                await websocket.send_json(data)
                log.debug(f"📤 Sent to {client_id}: {data['value']}")
                
            except WebSocketDisconnect:
                # Client closed connection gracefully
                log.info(f"🔌 Client disconnected: {client_id}")
                break
                
    except WebSocketDisconnect:
        # Client disconnected during initial setup
        log.info(f"🔌 Client disconnected during setup: {client_id}")
        
    except Exception as e:
        # Handle any errors (PV not found, network issues, etc.)
        error_msg = {
            'error': str(e),
            'pv': pv,
            'timestamp': datetime.now().isoformat()
        }
        log.error(f"❌ Error for {client_id}: {e}")
        
        # Try to send error to client (may fail if connection is broken)
        try:
            await websocket.send_json(error_msg)
        except Exception:
            pass  # Client already disconnected, ignore
    
    finally:
        # ============================================================
        # Cleanup: Always executed, even if exception occurred
        # ============================================================
        # Remove from active subscriptions
        if client_id in active_subscriptions:
            sub = active_subscriptions.pop(client_id)
            try:
                # Unsubscribe from EPICS PV
                sub.clear()
            except Exception:
                pass  # Subscription may already be cleared
                
        log.info(f"🧹 Cleaned up {client_id}")


# ================================================================
# Main Entry Point
# ================================================================

if __name__ == '__main__':
    """
    Application entry point when run directly.
    
    Usage:
        Development mode (with auto-reload):
            python epics_fastapi_gateway.py --dev
            
        Production mode:
            python epics_fastapi_gateway.py
            
    Alternative usage with uvicorn command:
        Development:
            uvicorn epics_fastapi_gateway:app --reload --host 0.0.0.0 --port 8000
            
        Production (single worker):
            uvicorn epics_fastapi_gateway:app --host 0.0.0.0 --port 8000
            
        Production (multiple workers):
            uvicorn epics_fastapi_gateway:app --host 0.0.0.0 --port 8000 --workers 4
    """
    
    import sys
    
    # Determine if running in development mode
    # Check for --dev flag or ENV environment variable
    is_dev_mode = "--dev" in sys.argv or os.getenv("ENV", "prod") == "dev"
    
    # Configure uvicorn server
    uvicorn.run(
        # Application module and instance
        # IMPORTANT: Use underscores instead of hyphens in module name
        # Python module names cannot contain hyphens
        # This should match your filename (without .py extension)
        app,  # Pass app object directly instead of string when running from __main__
        
        # Server binding
        host="0.0.0.0",  # Listen on all network interfaces
        port=8000,       # HTTP port (use 443 for HTTPS in production)
        
        # Auto-reload configuration
        # Development: reload=True  - Automatically restart when code changes
        # Production:  reload=False - Better performance, no file watching
        reload=is_dev_mode,
        
        # Logging configuration
        log_level="debug" if is_dev_mode else "info",
        
        # Access log
        # Development: Show all requests
        # Production:  Can disable for performance (access_log=False)
        access_log=is_dev_mode,
        
        # Additional production settings (commented out, uncomment as needed)
        # workers=4,              # Number of worker processes (production only, incompatible with reload=True)
        # limit_concurrency=1000, # Maximum concurrent connections
        # timeout_keep_alive=5,   # Keep-alive timeout in seconds
        # ssl_keyfile="key.pem",  # SSL private key (for HTTPS)
        # ssl_certfile="cert.pem" # SSL certificate (for HTTPS)
    )


