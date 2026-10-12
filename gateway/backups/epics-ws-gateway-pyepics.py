#!/usr/bin/env python3
"""
EPICS Channel Access WebSocket Gateway using pyepics
Auto-detects available port
"""
import asyncio
import websockets
from urllib.parse import urlparse, parse_qs
import logging
import signal
import epics
import threading
from datetime import datetime
import socket
import json
# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%H:%M:%S'
)
log = logging.getLogger(__name__)

# Store active PVs
active_pvs = {}
data_lock = threading.Lock()


def find_available_port(start_port=8083, max_attempts=10):
    """Find an available port starting from start_port"""
    for port in range(start_port, start_port + max_attempts):
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.bind(('0.0.0.0', port))
            sock.close()
            return port
        except OSError:
            continue
    raise RuntimeError(f"No available ports found in range {start_port}-{start_port+max_attempts}")


def extract_value(data):
    """Extract value from EPICS data"""
    import numpy as np
    
    if isinstance(data, (list, tuple)):
        if len(data) == 1:
            return extract_value(data[0])
        return [extract_value(item) for item in data]
    
    if isinstance(data, bytes):
        return data.decode('utf-8', errors='replace').rstrip('\x00')
    
    if isinstance(data, str):
        return data.rstrip('\x00')
    
    if hasattr(data, 'tolist'):
        val = data.tolist()
        if isinstance(val, list) and len(val) == 1:
            return float(val[0]) if isinstance(val[0], (int, float, np.number)) else val[0]
        return val
    
    if isinstance(data, (int, float, np.number)):
        return float(data)
    
    try:
        return float(data)
    except:
        return str(data)

#------------------------------------------------------
async def handle_client(websocket):
    """Handle WebSocket client connection"""
    
    path = websocket.request.path
    parsed = urlparse(path)
    query_params = parse_qs(parsed.query)
    
    log.info("╔" + "=" * 58 + "╗")
    log.info("║ WebSocket Connection                                     ║")
    log.info("╠" + "=" * 58 + "╣")
    log.info(f"║ Path           : {path:<40} ║")
    log.info(f"║ Remote IP      : {websocket.remote_address[0]:<40} ║")
    log.info("╚" + "=" * 58 + "╝")
    
    if 'pv' not in query_params:
        await websocket.send('ERROR: Missing PV name in query string')
        return
    
    pv_name = query_params['pv'][0]
    client_id = f"{websocket.remote_address}:{pv_name}"
    
    log.info(f"Client connected: {client_id}")
    
    # message_queue = asyncio.Queue(maxsize = 10)
    # asyncio.Queue put method is defined as async, this kind of 
    # of methods return to a coroutine object when called
    message_queue = asyncio.Queue()
    
    # FIXED: Get event loop reference BEFORE creating callback
    loop = asyncio.get_running_loop()
    
    def pv_callback(pvname=None, value=None, timestamp=None, status=None, severity=None, **kwargs):
        """EPICS PV callback - automatically called when PV updates"""
        try:
            data = {
                'value': extract_value(value),
                'timestamp': timestamp if timestamp else datetime.now().timestamp(),
                'status': status if status is not None else 0,
                'severity': severity if severity is not None else 0
            }
            # FIXED: Use the stored loop reference 
            # asyncio.run_coroutine_threadsafe(coro, loop) --> submit the coroutine coro to loop(the main thread's event)
            asyncio.run_coroutine_threadsafe(
                message_queue.put(data),
                loop  # Use the loop we captured earlier
            )
            log.debug(f"Queued for {client_id}: {data['value']}")
        except Exception as e:
            log.error(f"Callback error for {client_id}: {e}")
    
    try:
        pv = epics.PV(
            pv_name,
            callback=pv_callback,
            auto_monitor=True,
            form='time'
        )
        
        with data_lock:
            active_pvs[client_id] = pv
        
        if not pv.wait_for_connection(timeout=5):
            error_msg = f"ERROR: Could not connect to PV: {pv_name}"
            log.error(error_msg)
            await websocket.send(error_msg)
            return
        
        initial_data = {
            'value': extract_value(pv.value),
            'timestamp': pv.timestamp if pv.timestamp else datetime.now().timestamp(),
            'status': pv.status if hasattr(pv, 'status') else 0,
            'severity': pv.severity if hasattr(pv, 'severity') else 0
        }
        await websocket.send(json.dumps(str(initial_data)))
        log.info(f"Connected to PV: {pv_name} = {initial_data['value']} (Host: {pv.host})")
        
        while True:
            try:
                data = await asyncio.wait_for(message_queue.get(), timeout=1.0)
                await websocket.send(str(data))
                log.debug(f"Sent to {client_id}: {data['value']}")
            except asyncio.TimeoutError:
                try:
                    pong = await websocket.ping()
                    await asyncio.wait_for(pong, timeout=5)
                except:
                    log.warning(f"Ping failed for {client_id}")
                    break
            except websockets.exceptions.ConnectionClosed:
                log.info(f"Client disconnected: {client_id}")
                break
    
    except asyncio.CancelledError:
        log.info(f"Task cancelled for {client_id}")
        raise
    
    except Exception as e:
        error_msg = f"ERROR: {str(e)}"
        log.error(f"Error for {client_id}: {e}")
        try:
            await websocket.send(error_msg)
        except:
            pass
    
    finally:
        with data_lock:
            if client_id in active_pvs:
                pv = active_pvs.pop(client_id)
                pv.clear_callbacks()
                pv.disconnect()
        log.info(f"Cleaned up {client_id}")    
#------------------------------------------------------------------

async def main():
    """Main function"""
    
    HOST = '0.0.0.0'
    
    # Find available port
    try:
        PORT = find_available_port(8083, 10)
        log.info(f"Found available port: {PORT}")
    except RuntimeError as e:
        log.error(f"Error: {e}")
        return
    
    log.info("╔════════════════════════════════════════════════════════╗")
    log.info("║   EPICS Channel Access WebSocket Gateway (pyepics)    ║")
    log.info(f"║   Running on ws://{HOST}:{PORT}                       ║")
    log.info("╚════════════════════════════════════════════════════════╝")
    log.info("")
    log.info(f"Usage: ws://localhost:{PORT}?pv=YOUR:PV:NAME")
    log.info("")
    
    stop_event = asyncio.Event()
    loop = asyncio.get_running_loop()
    
    def signal_handler():
        log.info("\nShutting down...")
        stop_event.set()
    
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, signal_handler)
    
    try:
        async with websockets.serve(handle_client, HOST, PORT):
            log.info("Server started successfully")
            await stop_event.wait()
    finally:
        log.info("Cleaning up active PVs...")
        with data_lock:
            for client_id, pv in list(active_pvs.items()):
                try:
                    pv.clear_callbacks()
                    pv.disconnect()
                except:
                    pass
            active_pvs.clear()
        log.info("Cleanup complete")
    
    log.info("Gateway stopped")


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log.info("Interrupted by user")
