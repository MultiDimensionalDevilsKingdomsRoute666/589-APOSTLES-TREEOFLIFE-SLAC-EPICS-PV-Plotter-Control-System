// src/utils/valueFormat.js
// Per-PV value format ("regular" or "exponential"), set on the Config page.

export const isExponential = (format) => format === "exponential";

// Format a PV value. `formatRegular` is the caller's existing regular format,
// so each display keeps its own precision when exponential is off.
export const formatPVValue = (value, format, formatRegular) =>
  isExponential(format) ? value.toExponential(4) : formatRegular(value);

// Y-axis tick label: shortest exponential form ("1e-4", "2.5e-4").
export const formatExponentialTick = (value) =>
  value === 0 ? "0" : Number(value.toPrecision(3)).toExponential();
