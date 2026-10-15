// src/stores/usePlotStore.js

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import { PLOT_CONFIG } from "../utils/constants";

let nextPlotId = 1;

export const usePlotStore = create(
  persist(
    (set, get) => ({
      plots: [],

      //PVs explicitly added to the Live PV Values list
      livePVNames: [],

      // Time synchronization settings
      timeSyncEnabled: true,
      globalTimeWindow: 60,

      // Toggle global time synchronization
      toggleTimeSync: () => {
        set((state) => ({
          timeSyncEnabled: !state.timeSyncEnabled,
        }));

        console.log(`Time sync: ${get().timeSyncEnabled ? "ON" : "OFF"}`);
      },

      // Set the global time window in seconds
      setTimeWindow: (seconds) => {
        set({
          globalTimeWindow: seconds,
        });

        console.log(`Time window set to: ${seconds}s`);
      },

      // Add a new plot and calculate its initial position
      addPlot: (pvNames, width, height) => {
        const currentPlots = get().plots;

        const newPlotWidth = PLOT_CONFIG.DEFAULT_WIDTH * width;

        const newPlotHeight = PLOT_CONFIG.DEFAULT_HEIGHT * height;

        const position = findBestPosition(
          currentPlots,
          newPlotWidth,
          newPlotHeight,
        );

        const newPlot = {
          id: nextPlotId++,
          pvNames: Array.isArray(pvNames) ? pvNames : [pvNames],
          x: position.x,
          y: position.y,
          w: newPlotWidth,
          h: newPlotHeight,
        };

        set({
          plots: [...currentPlots, newPlot],
        });

        console.log(
          `Plot added at (${newPlot.x}, ${newPlot.y}), ` +
            `size: ${newPlot.w}x${newPlot.h}`,
          newPlot,
        );
      },

      // Add one or more PVs directly to the Live PV Values list.
      addLivePVs: (pvNames) => {
        const normalizedNames = Array.from(
          new Set(
            (Array.isArray(pvNames) ? pvNames : [pvNames])
              .map((pvName) => pvName.trim())
              .filter(Boolean),
          ),
        );

        if (normalizedNames.length === 0) {
          return;
        }

        const currentNames = get().livePVNames;

        const nextNames = Array.from(
          new Set([...currentNames, ...normalizedNames]),
        );

        if (nextNames.length === currentNames.length) {
          return;
        }

        set({
          livePVNames: nextNames,
        });
      },

      // Remove a PV from the explicit Live PV Values list.
      removeLivePV: (pvName) => {
        const currentNames = get().livePVNames;

        if (!currentNames.includes(pvName)) {
          return;
        }

        set({
          livePVNames: currentNames.filter((name) => name !== pvName),
        });
      },

      // Remove an entire plot
      removePlot: (plotId) => {
        const currentPlots = get().plots;

        const plotExists = currentPlots.some((plot) => plot.id === plotId);

        if (!plotExists) {
          return;
        }

        set({
          plots: currentPlots.filter((plot) => plot.id !== plotId),
        });

        console.log(`Plot removed: ${plotId}`);
      },

      // Remove a PV from a plot
      removePVFromPlot: (plotId, pvName) => {
        const currentPlots = get().plots;
        let changed = false;

        const nextPlots = currentPlots
          .map((plot) => {
            if (plot.id !== plotId) {
              return plot;
            }

            if (!plot.pvNames.includes(pvName)) {
              return plot;
            }

            changed = true;

            const updatedPVs = plot.pvNames.filter((pv) => pv !== pvName);

            if (updatedPVs.length === 0) {
              return null;
            }

            return {
              ...plot,
              pvNames: updatedPVs,
            };
          })
          .filter(Boolean);

        if (!changed) {
          return;
        }

        set({
          plots: nextPlots,
        });

        console.log(`PV removed: ${pvName} from plot ${plotId}`);
      },

      // Update plot positions and sizes only when the layout changed
      updateLayout: (newLayout) => {
        const currentPlots = get().plots;

        if (!Array.isArray(newLayout)) {
          return;
        }

        const layoutMap = new Map(newLayout.map((item) => [item.i, item]));

        let changed = false;

        const nextPlots = currentPlots.map((plot) => {
          const layoutItem = layoutMap.get(plot.id.toString());

          if (!layoutItem) {
            return plot;
          }

          const layoutChanged =
            plot.x !== layoutItem.x ||
            plot.y !== layoutItem.y ||
            plot.w !== layoutItem.w ||
            plot.h !== layoutItem.h;

          if (!layoutChanged) {
            return plot;
          }

          changed = true;

          return {
            ...plot,
            x: layoutItem.x,
            y: layoutItem.y,
            w: layoutItem.w,
            h: layoutItem.h,
          };
        });

        // Avoid unnecessary store updates and localStorage writes
        if (!changed) {
          return;
        }

        set({
          plots: nextPlots,
        });
      },
      // Load a complete layout from backend (replaces current plots)
      loadLayout: (layout) => {
        console.log("loading layout with plots number ", layout.length);
        if (!layout) {
          return;
        }

        const plots = Array.isArray(layout.plots) ? layout.plots : [];
        const livePVNames = Array.isArray(layout.livePVNames)
          ? layout.livePVNames
          : [];

        set({
          plots: plots,
          livePVNames: livePVNames,
          globalTimeWindow: layout.globalTimeWindow || 60,
        });

        // Update nextPlotId to avoid ID conflicts
        //const maxId = plots.reduce(
        //  (max, plot) => Math.max(max, plot.id || 0),
        //  0
        //);
        //nextPlotId = maxId + 1;

        console.log(`Layout loaded: ${plots.length} plots`);
      },

      // Remove all plots
      clearAll: () => {
        const state = get();

        if (state.plots.length === 0 && state.livePVNames.length === 0) {
          return;
        }

        set({
          plots: [],
          livePVNames: [],
        });

        nextPlotId = 1;

        console.log("All plots and live PVs cleared");
      },
    }),
    {
      name: "epics-plot-storage",

      storage: createJSONStorage(() => localStorage),

      // Restore the next available plot ID after page reload
      onRehydrateStorage: () => (state) => {
        if (!state) {
          return;
        }

        const restoredPlots = Array.isArray(state.plots) ? state.plots : [];

        const maxId = restoredPlots.reduce(
          (maximumId, plot) => Math.max(maximumId, plot.id),
          0,
        );

        nextPlotId = maxId + 1;

        console.log(
          `State rehydrated: ` + `${restoredPlots.length} plots restored`,
        );

        console.log(`Next plot ID will be: ${nextPlotId}`);
      },

      // Persist only configuration data
      partialize: (state) => ({
        plots: state.plots,
        livePVNames: state.livePVNames,
        //timeSyncEnabled: state.timeSyncEnabled,
        globalTimeWindow: state.globalTimeWindow,
      }),
    },
  ),
);

// Find an available position for a new plot
function findBestPosition(existingPlots, width, height) {
  if (existingPlots.length === 0) {
    return {
      x: 0,
      y: 0,
    };
  }

  const gridColumns = PLOT_CONFIG.GRID_COLS;
  let currentRow = 0;

  while (true) {
    for (let column = 0; column <= gridColumns - width; column += 1) {
      const candidate = {
        x: column,
        y: currentRow,
      };

      const hasConflict = existingPlots.some((plot) =>
        rectanglesOverlap(
          candidate.x,
          candidate.y,
          width,
          height,
          plot.x,
          plot.y,
          plot.w,
          plot.h,
        ),
      );

      if (!hasConflict) {
        return candidate;
      }
    }

    currentRow += PLOT_CONFIG.DEFAULT_HEIGHT;

    if (currentRow > 100) {
      console.warn(
        "Could not find an available position; " +
          "placing the plot at the end",
      );

      return {
        x: 0,
        y: currentRow,
      };
    }
  }
}

// Check whether two grid rectangles overlap
function rectanglesOverlap(x1, y1, width1, height1, x2, y2, width2, height2) {
  return !(
    x1 + width1 <= x2 ||
    x2 + width2 <= x1 ||
    y1 + height1 <= y2 ||
    y2 + height2 <= y1
  );
}
