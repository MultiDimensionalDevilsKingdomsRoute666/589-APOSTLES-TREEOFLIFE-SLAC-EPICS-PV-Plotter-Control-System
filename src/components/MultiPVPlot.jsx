// src/components/MultiPVPlot.jsx
import { useState, useEffect, useRef } from "react";
import Plot from "react-plotly.js";
import { X, Wifi, WifiOff, AlertCircle, Download } from "lucide-react";

import { DataBuffer } from "../services/DataBuffer";
import { pvConnectionPool } from "../services/PVConnectionPool";
import {
  API_BASE,
  PLOT_CONFIG,
  PLOT_LAYOUT_TEMPLATE,
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

  // Plotly legend text is rendered as SVG, so a React icon component can't
  // be placed in it - a colored dot glyph is used instead, matching the
  // colors used by the (hidden) HTML status icons below.
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

  const [plotData, setPlotData] = useState([]);
  const [connectionStatus, setConnectionStatus] = useState({});
  // Mirrors connectionStatus for the periodic redraw effect below, which
  // intentionally doesn't depend on connectionStatus (to avoid restarting
  // its timer on every connect/error flicker) and would otherwise read a
  // stale value through its closure.
  const connectionStatusRef = useRef({});
  useEffect(() => {
    connectionStatusRef.current = connectionStatus;
  }, [connectionStatus]);
  const [yAxisRange, setYAxisRange] = useState(null);
  const [xAxisRange, setXAxisRange] = useState(null);
  const [revision, setRevision] = useState(0);

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
  // Effect 2: periodic plot redraw
  useEffect(() => {
    let updateCount = 0;
    //----------------------------------
    const updateTimer = setInterval(() => {
      const stats = statsRef.current;
      const plotUpdateTime = performance.now();

      const hasNewData = stats.latestSequence !== stats.plottedSequence;

      // While paused, data keeps buffering but the plot is not redrawn.
      // plottedSequence stays behind, so the plot catches up on resume.
      if (hasNewData && !plotsPaused) {
        updateCount += 1;

        // Capture the newest sequence included in this update.
        const sequenceBeingPlotted = stats.latestSequence;

        // Measure the time from the latest data receipt
        // to the start of this plot update.
        if (stats.latestReceiveTime !== null) {
          stats.latestPlotDelay = plotUpdateTime - stats.latestReceiveTime;
        }

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

          xMax = latest; //xMax = latest || new Date();
          xMin = xMax ? new Date(xMax.getTime() - globalTimeWindow * 1000) : null;
          //xMin = new Date(xMax.getTime() - globalTimeWindow * 1000);
        }

        const traces = pvNames.map((pvName) => {
          const buffer = buffersRef.current[pvName];

          let data = buffer ? buffer.getData() : { x: [], y: [] };

          if (timeSyncEnabled && xMin && xMax && data.x.length > 0) {
            const filteredX = [];
            const filteredY = [];

            for (let index = 0; index < data.x.length; index += 1) {
              const timestamp = data.x[index];

              if (timestamp >= xMin && timestamp <= xMax) {
                filteredX.push(timestamp);
                filteredY.push(data.y[index]);
              }
            }

            data = {
              x: filteredX,
              y: filteredY,
            };
          }

          return {
            x: data.x,
            y: data.y,
            type: "scatter",
            //type: "scattergl",
            mode: "lines",
            name: buildTraceName(pvName, connectionStatusRef.current[pvName]),
            _pvName: pvName,

            line: {
              width: 2,
              color: getTraceColor(pvName),
            },
          };
        });

        // Recalculate the Y-axis less frequently.
        if (updateCount === 1 || updateCount % 10 === 0) {
          const allValues = traces.flatMap((trace) => trace.y);

          if (allValues.length > 0) {
            const min = Math.min(...allValues);
            const max = Math.max(...allValues);
            const range = max - min;
            const padding = range * 0.2 || 0.0001;

            setYAxisRange([min - padding * 0.8, max + padding * 3.0]);
          }
        }

        if (timeSyncEnabled && xMin && xMax) {
          setXAxisRange([xMin, xMax]);
        } else {
          setXAxisRange(null);
        }

        // Count only real plot update requests.
        stats.plottedInWindow += 1;

        setPlotData(traces);
        setRevision((previousRevision) => previousRevision + 1);

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
  }, [pvNames, timeSyncEnabled, globalTimeWindow, showAlias, aliases, plotsPaused]);

  // Refresh the legend's status glyph as soon as connectionStatus changes,
  // rather than waiting for the next data-driven redraw above - a PV that
  // errors out before ever producing data would otherwise never show it.
  useEffect(() => {
    setPlotData((previousTraces) =>
      previousTraces.map((trace) => ({
        ...trace,
        name: buildTraceName(trace._pvName, connectionStatus[trace._pvName]),
      })),
    );
    setRevision((previousRevision) => previousRevision + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionStatus, showAlias, aliases]);

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
  // Build the Plotly layout object. These keys follow the Plotly.js layout spec
  //
  const plotLayout = {
    ...PLOT_LAYOUT_TEMPLATE, //spread the shared default layout from constants.js
    datarevision: revision, //redraw signal: bump this to force Plotly to re-render
    // A constant uirevision keeps the user's zoom/pan/legend clicks across
    // re-renders while paused; a changing one resets them to live behavior.
    uirevision: plotsPaused ? "paused" : revision,
    showlegend: true, //show the legend
    legend: {
      font: { size: 18 },
      x: 0,
      y: 1,
      xanchor: "left",
      yanchor: "top",
      bgcolor: "255,255,255, 0.7",
    },
    yaxis: {
      ...PLOT_LAYOUT_TEMPLATE.yaxis,
      //autorange: yAxisRange ? false : true,
      autorange: true,
      range: yAxisRange,
      title: { text: getYAxisTitle() },
      //exponentformat: "e",
      //tickformat: ".2e",
      tickformat: "",
    },
    xaxis: {
      ...PLOT_LAYOUT_TEMPLATE.xaxis,
      type: "date",
      tickformat: "%H:%M:%S",
      autorange: xAxisRange ? false : true,
      range: xAxisRange,
    },

    margin: { l: 85, r: 30, t: 10, b: 50 },
  };

  //

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
        <Plot
          data={plotData}
          layout={plotLayout}
          config={{
            responsive: true,
            displayModeBar: false,
            displaylogo: false,
            modeBarButtonsToRemove: ["lasso2d", "select2d"],
            toImageButtonOptions: {
              format: "png",
              filename: pvNames.join("_"),
              height: 600,
              width: 1000,
            },
          }}
          style={{ width: "100%", height: "100%" }}
          useResizeHandler={true}
        />
      </div>
    </div>
  );
}
