#!/usr/bin/env python3
"""
EPICS WebSocket Gateway
Bridges EPICS PVs to WebSocket clients using p4p
Supports both PVAccess and Channel Access protocols
"""

import asyncio
import websockets
import json
import logging
from p4p.client.thread import Context
from urllib.parse import urlparse, parse_qs
import signal
import sys

logging.basicConfig(
    #level=logging.INFO,
    level=logging.DEBUG,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%H:%M:%S'
)

logger = logging.getLogger(__name__)

class EPICSWebSocketGateway:
    def __init__(self, host='0.0.0.0', port=8082):
        self.host = host
        self.port = port
        self.ctx_ca = Context('ca')    # Channel Access context (优先)
        self.ctx_pva = Context('pva')  # PVAccess context (备用)
        self.active_connections = {}
        
    async def handle_client(self, websocket):
        """Handle WebSocket connection for a single PV"""
        # Extract PV name from URL - get path from websocket.request
        path = websocket.request.path
        parsed = urlparse(path)
        query_params = parse_qs(parsed.query)
        pv_name = query_params.get('pv', [None])[0]
        
        if not pv_name:
            # Try to get from path
            pv_name = parsed.path.strip('/')
        
        if not pv_name:
            logger.warning("Connection without PV name")
            await websocket.close(1002, "No PV name specified")
            return
        
        client_id = f"{websocket.remote_address}:{pv_name}"
        logger.info(f"📡 CONNECTED: {pv_name} from {websocket.remote_address}")
        
        try:
            # Get the event loop for callbacks
            main_loop = asyncio.get_running_loop()
            
            # Callback for PV updates
            async def on_update(value):
                try:
                    # Check for connection status messages
                    value_str = str(value)
                    value_class = str(type(value))
                    
                    # Skip disconnected/connection status messages
                    if 'Disconnected' in value_class or 'disconnected' in value_str.lower():
                        logger.debug(f"Skipping disconnected status for {pv_name}")
                        return
                    
                    # Extract value - p4p CA returns simple values
                    val = None
                    timestamp = None
                    
                    # Debug: log what we received
                    logger.debug(f"Received value type: {type(value)}, value: {value}")
                    
                    # Try different value extraction methods
                    try:
                        # Method 1: Direct numeric value (most common for CA)
                        if isinstance(value, (int, float)):
                            val = float(value)
                            logger.debug(f"Method 1: Direct numeric value = {val}")
                        
                        # Method 2: Has 'raw' attribute (p4p wrapper)
                        elif hasattr(value, 'raw'):
                            if hasattr(value.raw, 'value'):
                                raw_val = value.raw.value
                                if hasattr(raw_val, 'tolist'):
                                    val = raw_val.tolist()
                                    if isinstance(val, list) and len(val) == 1:
                                        val = val[0]
                                else:
                                    val = float(raw_val)
                            else:
                                val = float(value.raw)
                            logger.debug(f"Method 2: From raw attribute = {val}")
                        
                        # Method 3: Has 'value' attribute (structured data)
                        elif hasattr(value, 'value'):
                            v = value.value
                            if hasattr(v, 'tolist'):
                                val = v.tolist()
                                if isinstance(val, list) and len(val) == 1:
                                    val = val[0]
                            else:
                                val = float(v)
                            logger.debug(f"Method 3: From value attribute = {val}")
                        
                        # Method 4: Try direct conversion as last resort
                        else:
                            val = float(value)
                            logger.debug(f"Method 4: Direct conversion = {val}")
                            
                    except (ValueError, TypeError, AttributeError) as e:
                        logger.error(f"Could not extract numeric value from {pv_name}: {e}")
                        logger.error(f"Value type: {type(value)}, Value repr: {repr(value)}")
                        return
                    
                    # Skip if we couldn't get a value
                    if val is None:
                        logger.warning(f"No valid value extracted for {pv_name}")
                        return
                    
                    # Try to get timestamp
                    if hasattr(value, 'timeStamp'):
                        # PVAccess timestamp
                        timestamp = value.timeStamp.secondsPastEpoch + value.timeStamp.nanoseconds / 1e9
                    elif hasattr(value, 'timestamp'):
                        # Alternative timestamp format
                        if hasattr(value.timestamp, 'tolist'):
                            timestamp = value.timestamp.tolist()
                        else:
                            timestamp = value.timestamp
                    
                    message = {
                        'type': 'update',
                        'pv': pv_name,
                        'value': val,
                        'timestamp': timestamp
                    }
                    
                    if websocket.open:
                        await websocket.send(json.dumps(message))
                        logger.info(f"📤 Sent {pv_name}: {val}")
                    else:
                        logger.warning(f"WebSocket closed, cannot send {pv_name}: {val}")
                        
                except Exception as e:
                    logger.error(f"Error processing value for {pv_name}: {e}")
                    import traceback
                    logger.error(traceback.format_exc())


            # Subscribe to PV using p4p monitor
            def sync_callback(value):
                """Synchronous callback that schedules async update"""
                try:
                    logger.info(f"Callback triggered for {pv_name}: {value}")
                    asyncio.run_coroutine_threadsafe(on_update(value), main_loop)
                except Exception as e:
                    logger.error(f"Error in sync_callback: {e}")

            # Try Channel Access FIRST (most common), then PVAccess
            subscription = None
            protocol_used = None
            
            try:
                logger.info(f"Trying Channel Access for {pv_name}...")
                subscription = self.ctx_ca.monitor(pv_name, sync_callback)
                subscription = self.ctx_ca.monitor(
                    pv_name, 
                    sync_callback,
                    notify_disconnect=True,  # notify disconnect
                )
                logger.info(f"📋 Monitor subscription created for {pv_name}")


                protocol_used = "Channel Access"
                logger.info(f"✅ Using Channel Access for {pv_name}")
            except Exception as ca_error:
                logger.info(f"Channel Access failed: {ca_error}")
                try:
                    logger.info(f"Trying PVAccess for {pv_name}...")
                    subscription = self.ctx_pva.monitor(pv_name, sync_callback, notify_disconnect=True)
                    protocol_used = "PVAccess"
                    logger.info(f"✅ Using PVAccess for {pv_name}")
                except Exception as pva_error:
                    logger.error(f"❌ Both protocols failed for {pv_name}")
                    logger.error(f"  CA: {ca_error}")
                    logger.error(f"  PVA: {pva_error}")
                    await websocket.send(json.dumps({
                        'type': 'error',
                        'pv': pv_name,
                        'message': f'Could not connect via Channel Access or PVAccess'
                    }))
                    return
            
            # Store subscription
            self.active_connections[client_id] = {
                'subscription': subscription,
                'protocol': protocol_used
            }
            
            # Keep connection alive
            await websocket.wait_closed()
            
        except Exception as e:
            logger.error(f"❌ Error with {pv_name}: {e}")
            
        finally:
            # Cleanup
            if client_id in self.active_connections:
                conn_info = self.active_connections.pop(client_id)
                conn_info['subscription'].close()
                logger.info(f"🔌 DISCONNECTED: {pv_name} ({conn_info['protocol']})")
    
    async def start(self):
        """Start the WebSocket server"""
        logger.info("╔════════════════════════════════════════════════════════╗")
        logger.info("║   EPICS WebSocket Gateway (CA + PVA)                   ║")
        logger.info(f"║   Running on ws://{self.host}:{self.port}                       ║")
        logger.info("╚════════════════════════════════════════════════════════╝")
        logger.info("")
        logger.info("Usage: ws://localhost:8082?pv=YOUR:PV:NAME")
        logger.info("Protocol priority: Channel Access → PVAccess")
        logger.info("")
        
        async with websockets.serve(self.handle_client, self.host, self.port):
            await asyncio.Future()  # Run forever
    
    def shutdown(self):
        """Cleanup on shutdown"""
        logger.info("\n🛑 Shutting down...")
        for conn_id, conn_info in self.active_connections.items():
            conn_info['subscription'].close()
        self.ctx_ca.close()
        self.ctx_pva.close()

def main():
    gateway = EPICSWebSocketGateway(host='0.0.0.0', port=8082)
    
    # Handle shutdown gracefully
    def signal_handler(sig, frame):
        gateway.shutdown()
        sys.exit(0)
    
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    try:
        asyncio.run(gateway.start())
    except KeyboardInterrupt:
        gateway.shutdown()

if __name__ == '__main__':
    main()
