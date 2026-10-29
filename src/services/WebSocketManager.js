// src/services/WebSocketManager.js
// Manages a single PV WebSocket connection (used by the global PV connection pool).

import { WS_CONFIG } from "../utils/constants";

export class PVWebSocket {
  constructor(pvName, onData, onError, onConnect, onClose) {
    this.pvName = pvName;

    // Callback functions (separation of transport and handling)
    this.onData = onData;       // called when data is received
    this.onError = onError;     // called when an error happens
    this.onConnect = onConnect; // called when the connection is opened
    this.onClose = onClose;     // called when the connection closes unexpectedly

    this.ws = null;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.messageCount = 0;      // number of messages received in the current session

    // When true, an unexpected close will trigger auto-reconnect.
    // Set to false on intentional disconnect() to prevent reconnecting.
    this.shouldReconnect = true;
  }

  // Open the WebSocket connection and attach event handlers.
  connect() {
    try {
      // Any manual/previous close should not block a new connect attempt.
      this.shouldReconnect = true;

      // WS_CONFIG.BASE_URL (IP + port) is defined in utils/constants.js
      // encodeURIComponent: safely encode PV name (colons, etc.) into the URL.
      const wsUrl = `${WS_CONFIG.BASE_URL}/ws?pv=${encodeURIComponent(this.pvName)}`;

      console.log(`🔗 Connecting to: ${wsUrl}`);
      this.ws = new WebSocket(wsUrl);

      // Fired when the WebSocket handshake completes and the connection is OPEN.
      this.ws.onopen = () => {
        console.log(`✅ Connected: ${this.pvName}`);
        this.reconnectAttempts = 0;
        this.messageCount = 0;
        if (this.onConnect) this.onConnect();
      };

      // Fired for every message pushed by the server.
      // event is a MessageEvent; event.data is the raw payload (JSON string here).
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // Server-side error message: { error, pv, timestamp }
          if (data.error) {
            console.error(`❌ PV Error (${this.pvName}):`, data.error);
            if (this.onError) this.onError(data.error);
            return;
          }

          this.messageCount++;

          // Periodic log to confirm updates are arriving.
          if (this.messageCount % 10 === 0) {
            console.log(`📡 ${this.pvName}: Received ${this.messageCount} messages`);
          }

          // Forward the value to the caller (UI / buffer).
          if (this.onData) {
            this.onData(data.value, data.timestamp);
          }
        } catch (err) {
          console.error("Parse error:", err);
          if (this.onError) this.onError("Data parse error");
        }
      };

      // Fired on transport-level errors (network/handshake issues).
      this.ws.onerror = (error) => {
        // Reduce noise: only report errors after a reconnect attempt.
        if (this.reconnectAttempts > 0) {
          console.error(`❌ WebSocket error (${this.pvName}):`, error);
          if (this.onError) this.onError("Connection error");
        }
      };

      // Fired when the connection closes (either intentional or unexpected).
      this.ws.onclose = () => {
        console.log(
          `🔌 Connection closed: ${this.pvName} (received ${this.messageCount} messages)`
        );
        // Only auto-reconnect if the close was NOT intentional.
        if (this.shouldReconnect) {
          if (this.onClose) this.onClose();
          this.attemptReconnect();
        }
      };
    } catch (err) {
      console.error("WebSocket creation failed:", err);
      if (this.onError) this.onError(err.message);
    }
  }

  // Try to reconnect after an unexpected close, up to MAX_RECONNECT_ATTEMPTS.
  attemptReconnect() {
    if (this.reconnectAttempts >= WS_CONFIG.MAX_RECONNECT_ATTEMPTS) {
      console.error(
        `❌ ${this.pvName}: Reconnection failed (${WS_CONFIG.MAX_RECONNECT_ATTEMPTS} attempts)`
      );
      if (this.onError) {
        this.onError(`Reconnection failed (${WS_CONFIG.MAX_RECONNECT_ATTEMPTS} attempts)`);
      }
      return;
    }

    this.reconnectAttempts++;
    console.log(
      `🔄 ${this.pvName}: Reconnecting in ${WS_CONFIG.RECONNECT_DELAY / 1000}s ` +
        `(attempt ${this.reconnectAttempts}/${WS_CONFIG.MAX_RECONNECT_ATTEMPTS})...`
    );

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, WS_CONFIG.RECONNECT_DELAY);
  }
  isConnected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }
  // Intentionally close the connection and stop any reconnect logic.
  disconnect() {
    // Prevent onclose from triggering auto-reconnect.
    this.shouldReconnect = false;

    // Fixed typo: was this.reconnectAttemps
    this.reconnectAttempts = 0;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
