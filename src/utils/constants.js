// src/utils/constants.js
//export const API_BASE = "";   
export const API_BASE = `http://${window.location.hostname}:8000`;
// ================================================================
// WebSocket Configuration
// ================================================================
export const WS_CONFIG = {
  // Same-origin WebSocket URL: nginx proxies /ws to the backend on :8000,
  // so no host/port needs to be hardcoded here. wss:// is used automatically
  // when the page itself is loaded over https.
  //BASE_URL: `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`,
  BASE_URL: `ws://${window.location.hostname}:8000`,   

  // Reconnection settings
  MAX_RECONNECT_ATTEMPTS: 5,      // Maximum number of reconnection attempts
  RECONNECT_DELAY: 3000,          // Delay between reconnection attempts (milliseconds)
  
  // Heartbeat configuration
  HEARTBEAT_INTERVAL: 30000,      // Heartbeat interval to keep connection alive (30 seconds)
};

// ================================================================
// Plot Configuration
// ================================================================
export const PLOT_CONFIG = {
  // Data buffer settings
  MAX_POINTS: 5000,               // Maximum number of data points stored per PV
  UPDATE_INTERVAL: 100,           // Plot update interval (milliseconds)
  
  // Grid layout settings
  GRID_COLS: 12,                  // Number of columns in the grid layout
  ROW_HEIGHT: 120,                // Height of each row (pixels)
  
  // Default plot dimensions (in grid units)
  DEFAULT_WIDTH: 4,               // Default width of a plot widget
  DEFAULT_HEIGHT: 3,              // Default height of a plot widget
};

// ================================================================
// uPlot Theme
// ================================================================
export const PLOT_THEME = {
  fontFamily: 'Arial, sans-serif',
  fontSize: 12,
  fontColor: '#333',
  plotBgColor: '#f8f9fa',         // Background of the plotting area
  gridColor: '#ddd',              // Grid line color
  lineWidth: 2,                   // Trace line width (CSS pixels)
  xTickFormat: '{HH}:{mm}:{ss}',  // uPlot.fmtDate template for X-axis ticks
};

// ================================================================
// Color Theme Palette
// ================================================================
// ================================================================
// PV Color Palette (vibrant colors first)
// ================================================================
export const PV_COLORS = [
  '#1f77b4', // 1. blue
  '#ff7f0e', // 2. orange
  '#2ca02c', // 3. green
  '#d62728', // 4. red
  '#9467bd', // 5. purple
  '#8c564b', // 6. brown
  '#e377c2', // 7. pink
  '#7f7f7f', // 8. gray
  '#bcbd22', // 9. yellow-green
  '#17becf', // 10. cyan
  // fallback lighter shades (used only after the vibrant ones run out)
  '#aec7e8', // 11. light blue
  '#ffbb78', // 12. light orange
  '#98df8a', // 13. light green
  '#ff9896', // 14. light red
  '#c5b0d5'  // 15. light purple
];

// ================================================================
// Persistent PV -> color assignment
//   Same PV name always gets the same color across ALL plots.
//   Colors are assigned in order of first appearance (blue, orange, green, ...).
// ================================================================
const pvColorMap = new Map();   // pvName -> color string
let nextColorIndex = 0;

export const getPVColor = (pvName) => {
  if (!pvColorMap.has(pvName)) {
    const color = PV_COLORS[nextColorIndex % PV_COLORS.length];
    pvColorMap.set(pvName, color);
    nextColorIndex++;
  }
  return pvColorMap.get(pvName);
};

// Optional: reset assignments (e.g. when clearing all plots)
export const resetPVColors = () => {
  pvColorMap.clear();
  nextColorIndex = 0;
};





