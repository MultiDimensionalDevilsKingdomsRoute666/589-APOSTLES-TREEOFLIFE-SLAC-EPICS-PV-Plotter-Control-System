import { PVWebSocket } from "./WebSocketManager";
import { useLiveValueStore } from "../stores/useLiveValueStore";

class PVConnectionPool {
  constructor() {
    // pvName -> { ws: PVWebSocket, subscribers: Set<Subscriber> }
    this.pool = new Map();
  }

  subscribe(pvName, callbacks = {}) {
    let entry = this.pool.get(pvName);

    if (!entry) {
      console.log(
        `[POOL] creating new connection for ${pvName}`
      );

      const subscribers = new Set();

      const ws = new PVWebSocket(
        pvName,

        // Update the latest-value store once per WebSocket message,
        // then distribute the same sample to every subscriber.
        (value, timestamp) => {
          useLiveValueStore
            .getState()
            .updateLatestValue(
              pvName,
              value,
              timestamp
            );

          subscribers.forEach((subscriber) => {
            subscriber.onData?.(
              value,
              timestamp
            );
          });
        },

        // Distribute connection errors to all subscribers.
        // The cached value can no longer be trusted, so drop it
        // until a fresh sample arrives.
        (error) => {
          useLiveValueStore
            .getState()
            .removeLatestValue(pvName);

          subscribers.forEach((subscriber) => {
            subscriber.onError?.(error);
          });
        },

        // Notify all subscribers when the shared connection opens.
        () => {
          subscribers.forEach((subscriber) => {
            subscriber.onConnect?.();
          });
        },

        // Unexpected close: drop the cached value and notify
        // subscribers while the connection reconnects.
        () => {
          useLiveValueStore
            .getState()
            .removeLatestValue(pvName);

          subscribers.forEach((subscriber) => {
            subscriber.onDisconnect?.();
          });
        }
      );

      ws.connect();

      entry = {
        ws,
        subscribers,
      };

      this.pool.set(pvName, entry);
    } else {
      console.log(
        `[POOL] reusing connection for ${pvName}`
      );
    }

    const subscriber = {
      onData: callbacks.onData,
      onError: callbacks.onError,
      onConnect: callbacks.onConnect,
      onDisconnect: callbacks.onDisconnect,
    };

    entry.subscribers.add(subscriber);
    if (entry.ws.isConnected()) {
      subscriber.onConnect?.();
    }
    console.log(
      `[POOL] ${pvName} ` +
        `subscribers=${entry.subscribers.size}, ` +
        `activeConns=${this.pool.size}`
    );

    return () => {
      const currentEntry = this.pool.get(pvName);

      if (!currentEntry) {
        return;
      }

      currentEntry.subscribers.delete(subscriber);

      console.log(
        `[POOL] ${pvName} unsubscribed, ` +
          `subscribers=${currentEntry.subscribers.size}`
      );

      if (currentEntry.subscribers.size === 0) {
        currentEntry.ws.disconnect();
        this.pool.delete(pvName);

        useLiveValueStore
          .getState()
          .removeLatestValue(pvName);

        console.log(
          `[POOL] closed connection for ${pvName}, ` +
            `activeConns=${this.pool.size}`
        );
      }
    };
  }

  getActiveConnectionCount() {
    return this.pool.size;
  }
}

export const pvConnectionPool =
  new PVConnectionPool();
