#!/usr/bin/env python3
"""
EPICS Channel Access WebSocket Gateway using caproto
"""
import asyncio
import websockets
from urllib.parse import urlparse, parse_qs
import logging
import signal
from caproto.asyncio.client import Context
import json

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%H:%M:%S'
)
log = logging.getLogger(__name__)

# Global caproto context
CA_CONTEXT = None

# Store active subscriptions
active_subscriptions = {}


def extract_value(data):
    """Extract value from different EPICS data types"""
    import numpy as np
    
    # Handle caproto DBR string types - iterate directly
    if hasattr(data, '__iter__') and not isinstance(data, (str, bytes)):
        try:
            # Try to iterate and decode
            result = []
            for item in data:
                if isinstance(item, bytes):
                    result.append(item.decode('utf-8', errors='replace').rstrip('\x00'))
                elif isinstance(item, (np.number, int, float)):
                    result.append(float(item))
                else:
                    result.append(item)
            # Return single value if only one element
            if len(result) == 1:
                return result[0]
            return result
        except:
            pass
    
    # Handle bytes
    if isinstance(data, bytes):
        return data.decode('utf-8', errors='replace').rstrip('\x00')
    
    # Handle strings
    if isinstance(data, str):
        return data.rstrip('\x00')
    
    # Handle numpy arrays
    if hasattr(data, 'tolist'):
        val = data.tolist()
        if isinstance(val, list) and len(val) == 1:
            v = val[0]
            # Convert numpy types to Python types
            if isinstance(v, np.number):
                return float(v)
            return v
        return val
    
    # Handle numbers (including numpy numbers)
    if isinstance(data, (int, float, np.number)):
        return float(data)
    
    # Fallback
    try:
        return float(data)
    except:
        return str(data)


async def handle_client(websocket):
    """Handle WebSocket client connection"""
    
    # Parse PV name from query string
    path = websocket.request.path
    parsed = urlparse(path)

    log.info(f"parsed full path from url is : {parsed}")

    query_params = parse_qs(parsed.query) # query string converts the string into dictionary
    

    log.info("╔" + "=" * 58 + "╗")
    log.info("║ WebSocket Connection Debug                              ║")
    log.info("╠" + "=" * 58 + "╣")
    log.info(f"║ Full Path      : {path:<40} ║")
    log.info("╠" + "-" * 58 + "╣")
    log.info(f"║ URL Components:                                          ║")
    log.info(f"║   - Scheme     : {parsed.scheme:<40} ║")
    log.info(f"║   - Netloc     : {parsed.netloc:<40} ║")
    log.info(f"║   - Path       : {parsed.path:<40} ║")
    log.info(f"║   - Query      : {parsed.query:<40} ║")
    log.info("╠" + "-" + "╣")
    log.info(f"║ Query Parameters:                                        ║")
    for key, value in query_params.items():
        log.info(f"║   - {key:<10} : {str(value):<40} ║")
    log.info("╠" + "-" * 58 + "╣")
    log.info(f"║ Client Info:                                             ║")
    log.info(f"║   - Remote IP  : {websocket.remote_address[0]:<40} ║")
    log.info(f"║   - Remote Port: {websocket.remote_address[1]:<40} ║")
    log.info("╚" + "=" * 58 + "╝")

    
    if 'pv' not in query_params:
        await websocket.send('ERROR: Missing PV name in query string')
        return
    
    pv_name = query_params['pv'][0]
    client_id = f"{websocket.remote_address}:{pv_name}"
    
    log.info(f"📡 Client connected: {client_id}")

    try:
        # Connect to PV
        pv, = await CA_CONTEXT.get_pvs(pv_name)
        
        # Read initial value
        initial_reading = await pv.read(data_type='time')
        initial_data = {
            'value': extract_value(initial_reading.data),
            'timestamp': initial_reading.metadata.timestamp,
            'status': initial_reading.metadata.status,
            'severity': initial_reading.metadata.severity
        }
        await websocket.send(json.dumps(str(initial_data))) # send the data back to the client
        log.info(f"✅ Connected to PV: {pv_name} = {initial_data['value']}")
        
        # Create subscription which is an async interator with __aiter__(), __anext__() methods
        # data_type = ‘native’, ‘status’, ‘time’, ‘graphic’, ‘control’
        subscription = pv.subscribe(data_type='time')
        active_subscriptions[client_id] = subscription


        
        # Listen for PV updates
        async for event in subscription:  
            try:
                data = {
                    'value': extract_value(event.data),
                    'timestamp': event.metadata.timestamp,
                    'status': event.metadata.status,
                    'severity': event.metadata.severity
                }
                await websocket.send(str(data))
                log.debug(f"📤 Sent to {client_id}: {data['value']}")
            except websockets.exceptions.ConnectionClosed:
                log.info(f"🔌 Client disconnected: {client_id}")
                break
        #----------------------------------------
    except asyncio.CancelledError:
        log.info(f"⚠️ Task cancelled for {client_id}")
        raise
    
    except Exception as e:
        error_msg = f"ERROR: {str(e)}"
        log.error(f"❌ Error for {client_id}: {e}")
        try:
            await websocket.send(error_msg)
        except:
            pass
    
    finally:
        # Clean up subscription
        if client_id in active_subscriptions:
            subscription = active_subscriptions.pop(client_id)
            subscription.clear()
        log.info(f"🧹 Cleaned up {client_id}")


async def main():
    """Main function"""
    global CA_CONTEXT
    
    # Create caproto context
    CA_CONTEXT = Context()

    # Configuration
    HOST = '0.0.0.0'
    PORT = 8082
    
    # Startup banner
    log.info("╔════════════════════════════════════════════════════════╗")
    log.info("║   EPICS Channel Access WebSocket Gateway              ║")
    log.info(f"║   Running on ws://{HOST}:{PORT}                       ║")
    log.info("╚════════════════════════════════════════════════════════╝")
    log.info("")
    log.info(f"Usage: ws://localhost:{PORT}?pv=YOUR:PV:NAME")
    log.info("")
    
    # Create stop event
    stop_event = asyncio.Event()
    
    # Signal handler
    loop = asyncio.get_running_loop()
    
    def signal_handler():
        log.info("\n Shutting down...")
        stop_event.set()
    
    # Register signal handlers
    # Signal Terminate : command, Signal Interrupt : keyborad
    # call the handler when the loop gets signal
    # Signal Interrupt, Ctrl + C
    # Signal Terminate kill <pid>
    for sig in (signal.SIGTERM, signal.SIGINT):

        loop.add_signal_handler(sig, signal_handler)
    
    # Start WebSocket server
    try:
        async with websockets.serve(handle_client, HOST, PORT):
            # let stop event wait until get signal to stop
            await stop_event.wait()
    finally:
        # Clean up all active subscriptions
        log.info("Cleaning up active subscriptions...")
        for client_id, subscription in list(active_subscriptions.items()):
            try:
                subscription.clear()
            except:
                pass
        active_subscriptions.clear()
        log.info("Cleanup complete")
    
    log.info("Gateway stopped")


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log.info("Interrupted by user")
