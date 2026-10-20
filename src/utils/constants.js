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
  MAX_POINTS: 1000,               // Maximum number of data points stored per PV
  UPDATE_INTERVAL: 100,           // Plot update interval (milliseconds)
  
  // Grid layout settings
  GRID_COLS: 12,                  // Number of columns in the grid layout
  ROW_HEIGHT: 120,                // Height of each row (pixels)
  
  // Default plot dimensions (in grid units)
  DEFAULT_WIDTH: 4,               // Default width of a plot widget
  DEFAULT_HEIGHT: 3,              // Default height of a plot widget
};

// ================================================================
// Plotly Layout Template
// ================================================================
export const PLOT_LAYOUT_TEMPLATE = {
  autosize: true,
  margin: { l: 50, r: 30, t: 40, b: 40 },
  paper_bgcolor: 'white',
  plot_bgcolor: '#f8f9fa',
  
  font: {
    family: 'Arial, sans-serif',
    size: 12,
    color: '#333'
  },
  
  xaxis: {
    title: 'Time',                // X-axis label
    gridcolor: '#ddd',            // Grid line color
    showgrid: true,               // Show grid lines
    zeroline: false,              // Hide zero line
    type: 'date'                  // X-axis data type (date/time)
  },
  
  yaxis: {
    title: 'Value',               // Y-axis label
    gridcolor: '#ddd',            // Grid line color
    showgrid: true,               // Show grid lines
    zeroline: false               // Hide zero line
  },
  
  hovermode: 'x',
  //hovermode: 'closest',           // Hover tooltip mode
  showlegend: true,               // Show plot legend
 
  legend: {
    x: 0.01,
    y: 1,
    xanchor: 'left',           // 
    yanchor: 'top',
    orientation: 'v',
    width: 0.32,               // 
    bgcolor: 'rgba(255,255,255,0.95)',
    bordercolor: '#d0d0d0',
    borderwidth: 1,
    font: { size: 11 },
    traceorder: 'normal',
    itemclick: false,
    itemdoubleclick: false
  }



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





