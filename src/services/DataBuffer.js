// src/services/DataBuffer.js

export class DataBuffer {
  constructor(maxPoints = 1000) {
    this.maxPoints = maxPoints;
    this.timestamps = [];
    this.values = [];
    this.totalPointsReceived = 0;
    this.hadBadTimestamp = false;
  }

  addPoint(value, timestamp) {
    this.totalPointsReceived += 1;

    // Backend timestamp is in seconds; JavaScript Date expects milliseconds.
    const time = new Date(timestamp * 1000);

    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600000);
    const oneHourFromNow = new Date(now.getTime() + 3600000);

    if (time < oneHourAgo || time > oneHourFromNow) {
      this.hadBadTimestamp = true;
      console.warn("⚠️ Suspicious timestamp:", {
        backend: timestamp,
        converted: time.toISOString(),
        now: now.toISOString(),
      });

      time.setTime(Date.now());
    }

    const numValue =
      typeof value === "number" ? value : parseFloat(value);

    this.timestamps.push(time);
    this.values.push(numValue);

    if (this.timestamps.length > this.maxPoints) {
      this.timestamps.shift();
      this.values.shift();
    }

    // Print the first three buffered points.
    if (this.values.length <= 3) {
      console.log(`📊 Point #${this.values.length}:`, {
        backendTimestamp: timestamp,
        jsTime: time.toISOString(),
        localTime: time.toLocaleTimeString(),
        value: numValue.toExponential(2),
      });
    }

    // Use total received count, not current buffer length.
    if (this.totalPointsReceived % 500 === 0) {
      console.log(
        `📊 Received: ${this.totalPointsReceived}, ` +
        `buffered: ${this.values.length}`
      );
    }
  }

  getData() {
    return {
      x: this.timestamps,
      y: this.values,
    };
  }

  clear() {
    this.timestamps = [];
    this.values = [];
    this.totalPointsReceived = 0;
  }

  getLatestValue() {
    if (this.values.length === 0) return null;
    return this.values[this.values.length - 1];
  }

  getLatestTimestamp() {
    if (this.timestamps.length === 0) return null;
    return this.timestamps[this.timestamps.length - 1];
  }

  getPointCount() {
    return this.values.length;
  }

  getValueRange() {
    if (this.values.length === 0) {
      return { min: 0, max: 1 };
    }

    const min = Math.min(...this.values);
    const max = Math.max(...this.values);

    return { min, max };
  }
  // UI 
  hasBadTimestampFlag() {
    return this.hadBadTimestamp;
  }

}
