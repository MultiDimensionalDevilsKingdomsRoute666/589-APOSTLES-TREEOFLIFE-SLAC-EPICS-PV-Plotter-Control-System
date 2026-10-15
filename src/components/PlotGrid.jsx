// src/components/PlotGrid.jsx
import { useMemo } from "react";
import { Responsive, WidthProvider } from "react-grid-layout";

import { usePlotStore } from "../stores/usePlotStore";
import MultiPVPlot from "./MultiPVPlot";
import { PLOT_CONFIG } from "../utils/constants";

import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import "./PlotGrid.css";

const ResponsiveGridLayout = WidthProvider(Responsive);

export default function PlotGrid() {
  const plots = usePlotStore((state) => state.plots);
  const updateLayout = usePlotStore((state) => state.updateLayout);
  const loadLayout = usePlotStore((state) => state.loadLayout);
  const layout = useMemo(
    () =>
      plots.map((plot) => ({
        i: plot.id.toString(),
        x: plot.x,
        y: plot.y,
        w: plot.w,
        h: plot.h,
        minW: 3,
        minH: 2,
        maxH: 6,
      })),
    [plots],
  );
  const handleStandardConfigLoad = async () => {
    console.log("Loading Standard Configurations");
    const API_BASE = `http://${window.location.hostname}:8000`;

    try {
      const response = await fetch(`${API_BASE}/api/config`);
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      const data = await response.json();
      console.log("Success:", data);

      const layout = data.layouts.default; // whole layout object
      console.log("Incoming layout:", layout);

      if (layout && layout.plots && layout.plots.length > 0) {
        usePlotStore.getState().loadLayout(layout); // whole layout object
        console.log("Successfully loaded layout!");
      } else {
        console.warn("No plots found in the default layout.");
      }
    } catch (error) {
      console.error("Failed to load configuration:", error.message);
    }
  };
  //if not plots, show the default panel
  if (plots.length === 0) {
    return (
      <div className="plot-grid-container">
        <div className="empty-state">
          <div className="empty-content">
            <h2>No plots yet</h2>
            <p>Enter a PV name above to start monitoring</p>

            <div className="example-pvs">
              <p className="example-title">Example PV names:</p>
              <code>TEST:PV:01</code>
              <code>SYS:TEMP:CPU</code>
              <code>BEAM:CURRENT</code>
            </div>
            <p> Or</p>
            <div>
              <button
                className="btn-load-config"
                onClick={handleStandardConfigLoad}
              >
                Load Standord Configurations
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="plot-grid-container">
      <ResponsiveGridLayout
        className="plot-grid"
        layouts={{ lg: layout }}
        breakpoints={{
          lg: 1200,
          md: 996,
          sm: 768,
          xs: 480,
          xxs: 0,
        }}
        cols={{
          lg: 12,
          md: 10,
          sm: 6,
          xs: 4,
          xxs: 2,
        }}
        rowHeight={PLOT_CONFIG.ROW_HEIGHT}
        onDragStop={(newLayout) => {
          updateLayout(newLayout);
        }}
        onResizeStop={(newLayout) => {
          updateLayout(newLayout);
        }}
        draggableHandle=".plot-header"
        compactType="vertical"
        preventCollision={false}
        isDraggable={true}
        isResizable={true}
        margin={[16, 16]}
      >
        {plots.map((plot) => (
          <div key={plot.id.toString()}>
            <MultiPVPlot plotId={plot.id} pvNames={plot.pvNames} />
          </div>
        ))}
      </ResponsiveGridLayout>
    </div>
  );
}
