// src/components/MultiPVPlot.jsx
import { useState, useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { X, Wifi, WifiOff, AlertCircle, Download } from "lucide-react";

import { DataBuffer } from "../services/DataBuffer";
import { pvConnectionPool } from "../services/PVConnectionPool";
import {
  API_BASE,
  PLOT_CONFIG,
  PLOT_THEME,
  getPVColor,
} from "../utils/constants";
import { usePlotStore } from "../stores/usePlotStore";
import "./MultiPVPlot.css";

// Relative path: nginx proxies /api to the backend on the same origin.

export default function MultiPVPlot({ plotId, pvNames }) {
  const SHOW_PV_TAGS = false;

  const [inputValue, setInputValue] = useState("");

  const [displayText, setDisplayText] = useState("");

  //Load Aliases and  EGU from backend
  const [egus, setEgus] = useState({});
  const [aliases, setAliases] = useState({});
  const badTimestampWarnedRef = useRef(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/egus`)
      .then((res) => res.json())
      .then((data) => setEgus(data || {}))
      .catch((err) => console.error("Failed to load EGUs:", err));

    fetch(`${API_BASE}/api/aliases`)
      .then((res) => res.json())
      .then((data) => setAliases(data || {}))
      .catch((err) => console.error("Failed to load aliases:", err));
  }, []);

  //
  const [showAlias, setShowAlias] = useState(true);
  // Get the display name for a PV (alias if enabled and available, else raw name)
  const getDisplayName = (pvName) => {
    if (showAlias && aliases[pvName]) {
      return aliases[pvName]; // show alias
    }
    return pvName; // show raw PV name
  };

  // The uPlot legend is built by uPlot itself (outside React), so a React
  // icon component can't be placed in it - a colored dot glyph is used
  // instead, matching the colors used by the (hidden) HTML status icons below.
  const getStatusGlyph = (status) => {
    switch (status) {
      case "connected":
        return "🟢";
      case "error":
        return "🔴";
      default:
        return "🟡";
    }
  };

  const buildTraceName = (pvName, status) =>
    `${getDisplayName(pvName)} ${getStatusGlyph(status)}`;

  const handleSubmit = () => {
    if (inputValue.trim() === "") return;
    setDisplayText(inputValue);
    setInputValue(""); //Empty input box
    console.log("entered the value", inputValue);
  };

  const handleClear = () => {
    setDisplayText("");
    setInputValue("");
    console.log("cleared the value");
  };
  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      handleSubmit();
    }
  };

  const [connectionStatus, setConnectionStatus] = useState({});

  // uPlot draws straight to a canvas, so plot data never goes through React
  // state: the redraw timer pushes new data into the uPlot instance directly.
  const plotContainerRef = useRef(null);
  const uplotRef = useRef(null);

  const [liveStats, setLiveStats] = useState({
    dataRate: 0, // Number of PV data message received by this plot per second
    plotRate: 0, // Number of plot update requests issued per second
    plotDelay: null, // Time in milliseconds between receiving the lastest PV data and starting the next plot updated
    totalPoints: 0,
  });

  const buffersRef = useRef({}); // pvName -> DataBuffer

  // Must come after buffersRef is declared (reading it earlier throws).
  const anyBadTimestamp = pvNames.some(
    (pv) => buffersRef.current[pv]?.hasBadTimestampFlag?.()
  );
  const unsubscribersRef = useRef({}); // pvName -> unsubscribe()
  const updateTimerRef = useRef(null);

  const statsRef = useRef({
    windowStart: performance.now(), //High resolution start time
    receivedInWindow: 0, //Number of PV messaged received during the current window
    plottedInWindow: 0, //Number of plot updated requests made during the current window
    latestSequence: 0, //Incremented whnever this plot receives a new PV message
    plottedSequence: 0, //Sequence number included in the most recent plot update
    latestReceiveTime: null, //Browser time at which the latest PV message was received
    latestPlotDelay: null, //Waiting time from the latest data receipt to the next plot update
  });

  //const {
  //  removePlot,
  //  removePVFromPlot,
  //  timeSyncEnabled,
  //  globalTimeWindow,
  //updateLatestValue,
  //} = usePlotStore();

  const removePlot = usePlotStore((state) => state.removePlot);

  const removePVFromPlot = usePlotStore((state) => state.removePVFromPlot);

  const timeSyncEnabled = usePlotStore((state) => state.timeSyncEnabled);

  const globalTimeWindow = usePlotStore((state) => state.globalTimeWindow);

  const plotsPaused = usePlotStore((state) => state.plotsPaused);

  const getTraceColor = (pvName) => getPVColor(pvName);

  const exportData = (pvName) => {
    const buffer = buffersRef.current[pvName];

    if (!buffer || buffer.getPointCount() === 0) {
      alert("No data to export");
      return;
    }

    const data = buffer.getData();
    //construct csv string
    const csv = ["Timestamp,Value"]
      .concat(data.x.map((time, i) => `${time.toISOString()},${data.y[i]}`))
      .join("\n");
    //Wrap the CSV text in a Blob (a build-in browser API) object
    //tagged as a UTF-8 CSV file so the browser treats it as a downloable .csv file
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob); //generate a temperal download url pointing to the blob in memmery
    const link = document.createElement("a"); //hyperlink component
    link.href = url;

    //time stamp as part of the file name
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    link.download = `${pvName}_${timestamp}.csv`;

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    console.log(`Exported ${data.x.length} data points for ${pvName}`);
  };

  const exportAllData = () => {
    if (pvNames.length === 1) {
      exportData(pvNames[0]);
      return;
    }

    const allData = pvNames.map((pvName) => {
      const buffer = buffersRef.current[pvName];
      return buffer ? buffer.getData() : { x: [], y: [] };
    });

    if (allData.every((d) => d.x.length === 0)) {
      alert("No data to export");
      return;
    }

    const header = ["Timestamp"].concat(pvNames.map((pv) => `${pv}_Value`));

    const allTimestamps = new Set();
    allData.forEach((data) => {
      data.x.forEach((time) => allTimestamps.add(time.getTime()));
    });

    const sortedTimestamps = Array.from(allTimestamps).sort();

    const rows = sortedTimestamps.map((ts) => {
      const row = [new Date(ts).toISOString()];

      pvNames.forEach((pvName, idx) => {
        const data = allData[idx];
        const timeIndex = data.x.findIndex((t) => t.getTime() === ts);
        row.push(timeIndex >= 0 ? data.y[timeIndex] : "");
      });

      return row.join(",");
    });

    const csv = [header.join(",")].concat(rows).join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    link.download = `multi-pv_${timestamp}.csv`;

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    console.log(`Exported data for ${pvNames.length} PVs`);
  };

  // Effect 1: subscribe/unsubscribe PVs for this plot
  // This effect keeps the actually-subscribed PVs in sync with the `pvNames` prop.
  // It runs whenever `pvNames` changes: it subscribes new PVs and unsubscribes removed ones.
  useEffect(() => {
    console.log("Sync subscriptions:", pvNames);

    // Subscribe new PVs
    pvNames.forEach((pvName) => {
      if (!buffersRef.current[pvName]) {
        //key check: does this PV already have a buffer
        buffersRef.current[pvName] = new DataBuffer(PLOT_CONFIG.MAX_POINTS);
        //set the status of this PV into connecting
        setConnectionStatus((prev) => ({ ...prev, [pvName]: "connecting" }));
        //subscribe this PV by sending PV name and callbacks
        const unsubscribe = pvConnectionPool.subscribe(pvName, {
          onData: (value, timestamp) => {
            const buf = buffersRef.current[pvName];
            if (!buf) return;
            buf.addPoint(value, timestamp);
            if (buf.hasBadTimestampFlag() && !badTimestampWarnedRef.current) {
              badTimestampWarnedRef.current = true;
              alert(
                `⚠️ Warning: PV "${pvName}" has an invalid timestamp ` +
                `(missing, or more than 1 hour away from the current time).\n\n` +
                `This usually means the IOC clock is not synchronized. ` +
                `The plot shows the timestamp exactly as received from the backend.`
              );
            }
            //updateLatestValue(pvName, value, timestamp);
            setConnectionStatus((prev) =>
              prev[pvName] === "connected"
                ? prev
                : { ...prev, [pvName]: "connected" }
            );


            const stats = statsRef.current;

            stats.receivedInWindow += 1;
            stats.latestSequence += 1;
            stats.latestReceiveTime = performance.now();
          },
          onError: (error) => {
            console.error(`Error for ${pvName}:`, error);
            setConnectionStatus((prev) => ({ ...prev, [pvName]: "error" }));
          },
          onConnect: () => {
            setConnectionStatus((prev) => ({ ...prev, [pvName]: "connected" }));
          },
        });

        unsubscribersRef.current[pvName] = unsubscribe;
      }
    });

    // Unsubscribe PVs removed from this plot
    Object.keys(buffersRef.current).forEach((pvName) => {
      if (!pvNames.includes(pvName)) {
        unsubscribersRef.current[pvName]?.();
        delete unsubscribersRef.current[pvName];

        delete buffersRef.current[pvName];

        setConnectionStatus((prev) => {
          const next = { ...prev };
          delete next[pvName];
          return next;
        });
      }
    });

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pvNames]);

  ///////////////////////////////////////////////////////////////////////
  // Unsubscribe everything on unmount
  useEffect(() => {
    return () => {
      console.log("Unsubscribing all PVs (unmount)");
      Object.keys(unsubscribersRef.current).forEach((pvName) => {
        unsubscribersRef.current[pvName]?.();
      });
      unsubscribersRef.current = {};
      buffersRef.current = {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getYAxisTitle = () => {
    console.log("getYAxisTitle - egus:", egus, "pvNames:", pvNames);
    //Collect EGUs of this plot's PVs (ignore empty or default)
    for (const pv of pvNames) {
      if (egus[pv] && egus[pv] !== "default") {
        console.log("found EGU for", pv, ":", egus[pv]);
        return egus[pv];
      }
    }
    return "Value";
  };
  // Build the uPlot data table for the current buffers: [xs, ys_pv1, ys_pv2, ...].
  // uPlot needs every series to share one x array, so each PV's samples are
  // merged onto the union of all timestamps (uPlot.join fills the holes, and
  // spanGaps draws the lines straight across them).
  const buildPlotData = () => {
    let xMin = null;
    let xMax = null;

    // If time sync is enabled, find the latest timestamp across all PVs
    if (timeSyncEnabled) {
      let latest = null;

      pvNames.forEach((pvName) => {
        const buffer = buffersRef.current[pvName];

        const timestamp = buffer ? buffer.getLatestTimestamp() : null;

        // Skip invalid Dates: NaN never compares greater, so one would freeze xMax.
        if (timestamp && !isNaN(timestamp.getTime()) && (!latest || timestamp > latest)) {
          latest = timestamp;
        }
      });

      xMax = latest;
      xMin = xMax ? new Date(xMax.getTime() - globalTimeWindow * 1000) : null;
    }

    const tables = pvNames.map((pvName) => {
      const buffer = buffersRef.current[pvName];
      const data = buffer ? buffer.getData() : { x: [], y: [] };

      // uPlot time scales are in seconds. Points with an invalid timestamp
      // can't be placed on the x axis, so they are dropped here.
      const xs = [];
      const ys = [];

      for (let index = 0; index < data.x.length; index += 1) {
        const timestamp = data.x[index];
        const ms = timestamp.getTime();

        if (isNaN(ms)) continue;
        if (xMin && xMax && (timestamp < xMin || timestamp > xMax)) continue;

        const value = data.y[index];
        xs.push(ms / 1000);
        ys.push(Number.isFinite(value) ? value : null);
      }

      return [xs, ys];
    });

    const data = tables.length > 0 ? uPlot.join(tables) : [[]];

    return {
      data,
      xRange: xMin && xMax ? [xMin.getTime() / 1000, xMax.getTime() / 1000] : null,
    };
  };

  // Push new data into the uPlot instance. Rescales both axes to the data
  // (or to the shared time window when time sync is on), which also drops
  // any zoom the user made while the plots were paused.
  const pushPlotData = (plot) => {
    const { data, xRange } = buildPlotData();

    plot.setData(data);

    if (xRange) {
      plot.setScale("x", { min: xRange[0], max: xRange[1] });
    }
  };

  const seriesLabels = pvNames.map((pvName) =>
    buildTraceName(pvName, connectionStatus[pvName]),
  );
  const yAxisTitle = getYAxisTitle();

  // Effect 2: create the uPlot instance.
  // uPlot series and axis labels are fixed at creation time, so the plot is
  // rebuilt (from the existing buffers) when the PV list, a legend label or
  // the Y-axis title changes. These are rare compared to data updates.
  useEffect(() => {
    const container = plotContainerRef.current;
    if (!container) return undefined;

    const axisStyle = {
      stroke: PLOT_THEME.fontColor,
      font: `${PLOT_THEME.fontSize}px ${PLOT_THEME.fontFamily}`,
      labelFont: `${PLOT_THEME.fontSize + 2}px ${PLOT_THEME.fontFamily}`,
      grid: { stroke: PLOT_THEME.gridColor, width: 1 },
      ticks: { stroke: PLOT_THEME.gridColor, width: 1 },
    };
    const formatXTick = uPlot.fmtDate(PLOT_THEME.xTickFormat);

    // The legend sits below the canvas, so the canvas gets whatever height
    // the legend leaves over.
    const getPlotSize = (plot) => {
      const legend = plot?.root.querySelector(".u-legend");
      return {
        width: Math.max(container.clientWidth, 1),
        height: Math.max(container.clientHeight - (legend?.offsetHeight ?? 0), 1),
      };
    };
    const formatValue = (u, value) =>
      value == null ? "--" : String(Number(value.toPrecision(6)));

    const options = {
      ...getPlotSize(null),
      padding: [10, 30, 0, 0],
      scales: {
        x: { time: true },
      },
      axes: [
        {
          ...axisStyle,
          label: "Time",
          values: (u, splits) =>
            splits.map((split) => formatXTick(new Date(split * 1000))),
        },
        {
          ...axisStyle,
          label: yAxisTitle,
          size: 75,
        },
      ],
      series: [
        {
          label: "Time",
          value: "{YYYY}-{MM}-{DD} {HH}:{mm}:{ss}.{fff}",
        },
        ...pvNames.map((pvName, index) => ({
          label: seriesLabels[index],
          stroke: getTraceColor(pvName),
          width: PLOT_THEME.lineWidth,
          spanGaps: true,
          points: { show: false },
          value: formatValue,
        })),
      ],
      // The legend is built by uPlot outside React, so it can't contain React components.
      legend: {
        markers: { width: 2 },
      },
      cursor: {
        // Drag horizontally to zoom the time axis; double-click to reset.
        drag: { x: true, y: false },
      },
      hooks: {
        // The next live redraw rescales the axes and would undo a drag
        // zoom, so zooming pauses all plots. The user resumes manually.
        setSelect: [
          (u) => {
            if (u.select.width > 0) {
              usePlotStore.getState().setPlotsPaused(true);
            }
          },
        ],
      },
    };

    const plot = new uPlot(options, buildPlotData().data, container);
    uplotRef.current = plot;

    // Disable legend click-to-hide (matches the old itemclick: false).
    plot.root.querySelectorAll(".u-legend .u-series").forEach((row) => {
      row.style.pointerEvents = "none";
    });
    plot.setSize(getPlotSize(plot));

    // Track the container size (react-grid-layout resizes widgets freely),
    // and the legend's, which grows when hover values make it wrap.
    const resizeObserver = new ResizeObserver(() => {
      plot.setSize(getPlotSize(plot));
    });
    resizeObserver.observe(container);
    resizeObserver.observe(plot.root.querySelector(".u-legend"));

    return () => {
      resizeObserver.disconnect();
      plot.destroy();
      if (uplotRef.current === plot) {
        uplotRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pvNames, seriesLabels.join("\u0000"), yAxisTitle]);

  // Effect 3: periodic plot redraw
  useEffect(() => {
    //----------------------------------
    const updateTimer = setInterval(() => {
      const stats = statsRef.current;
      const plotUpdateTime = performance.now();

      const hasNewData = stats.latestSequence !== stats.plottedSequence;
      const plot = uplotRef.current;

      // While paused, data keeps buffering but the plot is not redrawn.
      // plottedSequence stays behind, so the plot catches up on resume.
      // Read the store directly: a zoom pauses from a uPlot hook, and a tick
      // may run before React re-renders with the new plotsPaused.
      if (hasNewData && !usePlotStore.getState().plotsPaused && plot) {
        // Capture the newest sequence included in this update.
        const sequenceBeingPlotted = stats.latestSequence;

        // Measure the time from the latest data receipt
        // to the start of this plot update.
        if (stats.latestReceiveTime !== null) {
          stats.latestPlotDelay = plotUpdateTime - stats.latestReceiveTime;
        }

        pushPlotData(plot);

        // Count only real plot update requests.
        stats.plottedInWindow += 1;

        // Mark all data up to this sequence as submitted
        // in the current plot update.
        stats.plottedSequence = sequenceBeingPlotted;
      }

      // Update the displayed statistics even when no new
      // PV data has arrived.
      const statsElapsed = plotUpdateTime - stats.windowStart;

      if (statsElapsed >= 2000) {
        const elapsedSeconds = statsElapsed / 1000;

        const totalPoints = pvNames.reduce((sum, pvName) => {
          const buffer = buffersRef.current[pvName];

          return sum + (buffer ? buffer.getPointCount() : 0);
        }, 0);

        setLiveStats({
          dataRate: stats.receivedInWindow / elapsedSeconds,

          plotRate: stats.plottedInWindow / elapsedSeconds,

          plotDelay: stats.latestPlotDelay,

          totalPoints,
        });

        stats.windowStart = plotUpdateTime;
        stats.receivedInWindow = 0;
        stats.plottedInWindow = 0;
      }
    }, PLOT_CONFIG.UPDATE_INTERVAL);

    //-----------------------------------
    updateTimerRef.current = updateTimer;

    console.log(
      `Plot update timer started ` + `(${PLOT_CONFIG.UPDATE_INTERVAL}ms)`,
    );

    return () => {
      clearInterval(updateTimer);

      if (updateTimerRef.current === updateTimer) {
        updateTimerRef.current = null;
      }

      console.log("Plot update timer stopped");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pvNames, timeSyncEnabled, globalTimeWindow, plotsPaused]);

  // Returns a connection-status icon based on the status string.
  // Note: currently unused in the UI because SHOW_PV_TAGS is false (PV tags are hidden).

  const getStatusIcon = (status) => {
    switch (status) {
      case "connected":
        return <Wifi size={14} className="status-icon connected" />;
      case "error":
        return <AlertCircle size={14} className="status-icon error" />;
      default:
        return <WifiOff size={14} className="status-icon connecting" />;
    }
  };
  return (
    <div className="plot-widget">
      <div className="plot-header">
        {/*
	<div className="live-stats">
          <span title="Incoming WebSocket messages per second">
            Data: {liveStats.dataRate.toFixed(1)} Hz
          </span>
        
          <span title="Plot update operations per second">
            Plot: {liveStats.plotRate.toFixed(1)} Hz
          </span>
        
          <span title="Delay from data receipt to the next plot update">
            Delay:{" "}
            {liveStats.plotDelay === null
              ? "---"
              : `${liveStats.plotDelay.toFixed(0)} ms`}
          </span>
        
          <span title="Total points currently buffered by this plot">
            Points: {liveStats.totalPoints}
          </span>
        </div>
        */}

        <div className="user-input">
          {/*
	  {displayText ? displayText: <span style={{ color:'#999'}}> </span>}
	  <input   
            type="text" value={inputValue} onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
	      placeholder=''
	  />
          <button className="enter-button" onClick={handleSubmit}>Enter</button>
	  <button className="clear-button" onClick={handleClear}>Clear</button>
	  */}
        </div>
        <div className="legend-toggle">
          <button
            className="btn btn-secondary"
            style={{}}
            onClick={() => setShowAlias((prev) => !prev)}
            title="Toggle legend between alias and PV name"
          >
            {showAlias ? "Show PV Names" : "Show Aliases"}
          </button>
        </div>

        <div className="pv-tags">
          {SHOW_PV_TAGS &&
            pvNames.map((pvName) => (
              <div key={pvName} className="pv-tag">
                {getStatusIcon(connectionStatus[pvName])}
                <span className="pv-name">{pvName}</span>
                {buffersRef.current[pvName] && (
                  <span className="pv-count">
                    ({buffersRef.current[pvName].getPointCount()})
                  </span>
                )}
                {pvNames.length > 1 && (
                  <button
                    className="pv-remove"
                    onClick={() => removePVFromPlot(plotId, pvName)}
                    title="Remove this PV"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            ))}
        </div>

        <div className="plot-actions">
          <button
            className="plot-action-btn"
            onClick={exportAllData}
            title="Export data to CSV"
          >
            <Download size={16} />
          </button>

          <button
            className="plot-close"
            onClick={() => removePlot(plotId)}
            title="Close plot"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="plot-container">
        <div ref={plotContainerRef} className="uplot-host" />
      </div>
    </div>
  );
}
