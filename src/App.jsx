// src/App.jsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlotStore } from './stores/usePlotStore';
import { useLiveValueStore } from "./stores/useLiveValueStore";
import { pvConnectionPool } from "./services/PVConnectionPool";

import PlotGrid from './components/PlotGrid';
import BeamlineStatus from './components/BeamlineStatus';
import { Plus, Trash2, Activity, Clock, ChevronDown, ChevronUp, X, Pause, Play } from 'lucide-react';
import './App.css';
import { API_BASE } from "./utils/constants";
// Relative path: nginx proxies /api to the backend on the same origin.

function LivePVValue({
  pvName,
  displayName,
  threshold,
  canRemove,
  onRemove,
}) {
  const valueInfo = useLiveValueStore(
    (state) => state.latestValues[pvName]
  );

  const numericValue = Number(valueInfo?.value);

  const upper = threshold?.upper;
  const lower = threshold?.lower;
  const hasValue = valueInfo != null && Number.isFinite(numericValue);

  const aboveThreshold =
    hasValue && typeof upper === "number" && numericValue > upper;
  const belowThreshold =
    hasValue && typeof lower === "number" && numericValue < lower;
  const outOfRange = aboveThreshold || belowThreshold;

  let alarmTitle;
  if (aboveThreshold) alarmTitle = `Above upper threshold (${upper})`;
  else if (belowThreshold) alarmTitle = `Below lower threshold (${lower})`;

  return (
    <div
      className={`value-item${outOfRange ? " value-item-alarm" : ""}`}
      title={alarmTitle}
    >
      <div className="pv-name">
        <div className="pv-name-scroll-container">
        {displayName}
        </div>
        </div>

      <div className="pv-value">        
        {valueInfo && Number.isFinite(numericValue)
          ? numericValue.toFixed(5)
          : "---"}                
      </div>

      {valueInfo && (
        <div className="pv-time">
          {new Date(
            valueInfo.timestamp * 1000
          ).toLocaleTimeString()}
        </div>
      )}

      {canRemove && (
        <button
          type="button"
          className="live-pv-remove"
          onClick={() => onRemove(pvName)}
          title="Remove from the Live PV Values list"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}


function LivePVSubscription({ pvName }) {
  useEffect(() => {
    const unsubscribe = pvConnectionPool.subscribe(pvName, {
      // The connection pool updates useLiveValueStore once
      // for every WebSocket message.
      onData: () => {},

      onConnect: () => {
        console.log(`[LIVE LIST] Connected: ${pvName}`);
      },

      onError: (error) => {
        console.error(
          `[LIVE LIST] Error for ${pvName}:`,
          error
        );
      },
    });

    return unsubscribe;
  }, [pvName]);

  return null;
}


function App() {
  const [pvInput, setPvInput] = useState('');
  const [showInfo, setShowInfo] = useState(false);

  const [selectedPlotSize, setSelectedPlotSize] = useState('1*1');
  const plotsize_options = [
    { value: '1*1', label: '1*1', width: 1, height: 1 },
    { value: '1*2', label: '1*2', width: 1, height: 2 },
    { value: '2*1', label: '2*1', width: 2, height: 1 },
    { value: '2*2', label: '2*2', width: 2, height: 2 },
  ];
  //handle change events when a user picks an option
  const handlePlotSizeChange = (event) => {
    setSelectedPlotSize(event.target.value);
  };
  const [saveStatus, setSaveStatus] = useState('');
	
  const handleSavePlotConfigBk = (event) =>{
    console.log("save the plots configuration");
  };
  const plots = usePlotStore((state) => state.plots);
  const addPlot = usePlotStore((state) => state.addPlot);
  const clearAll = usePlotStore((state) => state.clearAll);
  
  const timeSyncEnabled = usePlotStore(
    (state) => state.timeSyncEnabled
  );
  
  const globalTimeWindow = usePlotStore(
    (state) => state.globalTimeWindow
  );
  
  const toggleTimeSync = usePlotStore(
    (state) => state.toggleTimeSync
  );
  
  const setTimeWindow = usePlotStore(
    (state) => state.setTimeWindow
  );

  const plotsPaused = usePlotStore(
    (state) => state.plotsPaused
  );

  const togglePlotsPaused = usePlotStore(
    (state) => state.togglePlotsPaused
  );

  const livePVNames = usePlotStore(
    (state) => state.livePVNames
  );

  const addLivePVs = usePlotStore(
    (state) => state.addLivePVs
  );

  const removeLivePV = usePlotStore(
    (state) => state.removeLivePV
  );

  const navigate = useNavigate();

  // Per-PV { upper, lower } thresholds; App remounts when returning from /config,
  // so this always reflects the latest saved values
  const [thresholds, setThresholds] = useState({});

  // Auto-load the standard config on startup when no layout was restored
  // from localStorage (rehydration is synchronous, so plots is already set)
  useEffect(() => {
    if (usePlotStore.getState().plots.length > 0) return;

    fetch(`${API_BASE}/api/config`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        const layout = data?.layouts?.default;
        if (layout?.plots?.length > 0) {
          usePlotStore.getState().loadLayout(layout);
        }
      })
      .catch((err) => console.error("Failed to load standard config:", err));
  }, []);

  useEffect(() => {
    fetch(`${API_BASE}/api/thresholds`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => setThresholds(data || {}))
      .catch((err) => console.error("Failed to load thresholds:", err));
  }, []);

  // PV aliases for the Live PV Values panel, toggled like the plot legend
  const [aliases, setAliases] = useState({});
  const [showAlias, setShowAlias] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/api/aliases`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => setAliases(data || {}))
      .catch((err) => console.error("Failed to load aliases:", err));
  }, []);

  // Alias if enabled and available, else the raw PV name
  const getDisplayName = (pvName) =>
    showAlias && aliases[pvName] ? aliases[pvName] : pvName;

  const handleDirectToConfig = () => {
    navigate('/config');
  };

  const handleSavePlotConfig = async () => {
    try {
      console.log("saving the plot configurations")
      setSaveStatus('Saving...');

      //Save Plot Layouts
    
      const res = await fetch(`${API_BASE}/api/layout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plots: plots,
          livePVNames: livePVNames,
          globalTimeWindow: globalTimeWindow,
        }),
      });
      if (!res.ok) throw new Error('Save failed');
      setSaveStatus('Saved!');
      setTimeout(() => setSaveStatus(''), 2000);
    } catch (err) {
      console.error(err);
      setSaveStatus('Save failed');
    }
  };


  useEffect(() => {
    if (plots.length > 0) {
      console.log(`✅ Active plots: ${plots.length} `);
    }
  }, [plots.length]);

  const parsePVNames = (input) =>
    input
      .trim()
      .split(",")
      .map((pvName) => pvName.trim())
      .filter(Boolean);


  //function to handle adding Plots and  PV latest values
  const handleAddPlot = () => {
    const pvNames = parsePVNames(pvInput);
  
    if (pvNames.length === 0) {
      alert("Please enter valid PV name(s)");
      return;
    }
  
    const option =
      plotsize_options.find(
        (item) => item.value === selectedPlotSize
      ) ?? plotsize_options[0];
  
    addPlot(
      pvNames,
      option.width,
      option.height
    );
  
    setPvInput("");
  };	
  	
  const handleAddLivePV = () => {
    const pvNames = parsePVNames(pvInput);
  
    if (pvNames.length === 0) {
      alert("Please enter valid PV name(s)");
      return;
    }
  
    addLivePVs(pvNames);
    setPvInput("");
  };

  const handleKeyDown = (event) => {
    if (event.key === "Enter") {
      handleAddPlot();
    }
  };


  const handleClearAll = () => {
    if (
      plots.length === 0 &&
      livePVNames.length === 0
    ) {
      return;
    }
  
    if (
      window.confirm(
        "Are you sure you want to clear all plots and live PVs?"
      )
    ) {
      clearAll();
  
      console.log(
        "All plots and live PVs cleared"
      );
    }
  };

  const plotPVNames = plots.flatMap(
    (plot) => plot.pvNames
  );

  const displayedPVNames = Array.from(
    new Set([
      ...plotPVNames,
      ...livePVNames,
    ])
  );



  return (
    <div className="app">
      {/*
      <header className="app-header">
        <div className="header-content">
          <h1> 
            <Activity size={32} />
            EPICS Real-time Monitor
          </h1>
          <p>Real-time Process Variable monitoring and visualization</p>
        </div>
      </header>
      */}
      {livePVNames.map((pvName) => (
        <LivePVSubscription
          key={`live-subscription-${pvName}`}
          pvName={pvName}
        />
      ))}


      <div className="control-panel">
        <div className="input-group">
          <input
            type="text"
            className="pv-input"
            placeholder="Enter PV name (e.g., IOC:ai1 or IOC:ai1,IOC:ai2 for multi-PV plot)"
            value={pvInput}
            onChange={(e) => setPvInput(e.target.value)}
	    onKeyDown={handleKeyDown}
          />
	<select className="plot-size-select" value={selectedPlotSize} onChange={handlePlotSizeChange}>
           <option value="" disabled>-- Choose an option --</option>
        
           {plotsize_options.map((option) => (
             <option key={option.value} value={option.value}>
               {option.label}
             </option>
           ))}
         </select>

          <button
            className="btn btn-primary"
            onClick={handleAddPlot}
            disabled={!pvInput.trim()}
          >
            <Activity size={18} />
            Add Plot
          </button>
	  <button
	    className="btn btn-secondary"
	    onClick={handleAddLivePV}
	    disabled={!pvInput.trim()}
	  >
	    <Plus size={18} />
	    Add Live PV
	  </button>
          <button
            className="btn btn-danger"
            onClick={handleClearAll}
            disabled={plots.length === 0 && livePVNames.length === 0}
          >
            <Trash2 size={18} />
            Clear All
          </button>
          {/* 
          <button
            className="btn btn-info"
            onClick={() => setShowInfo(!showInfo)}
            title="Toggle info panel"
          >
            {showInfo ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            Info Details
          </button>
	  */}
          {/* Vertical Separator */}
          <div className="separator"></div>

          {/* Pause/resume plot redraws; data keeps buffering while paused */}
          <button
            className={`btn ${plotsPaused ? 'btn-success' : 'btn-secondary'}`}
            onClick={togglePlotsPaused}
            title={plotsPaused ? 'Resume live plot updates' : 'Freeze all plots for analysis'}
          >
            {plotsPaused ? <Play size={18} /> : <Pause size={18} />}
            {plotsPaused ? 'Resume Plots' : 'Pause Plots'}
          </button>

          {/* Time Synchronization Controls - Now Inline */}
	  {/*
          <button
            className={`btn ${timeSyncEnabled ? 'btn-success' : 'btn-secondary'}`}
            onClick={toggleTimeSync}
            title="Toggle time axis synchronization"
          >
            <Clock size={18} />
            {timeSyncEnabled ? 'Time Sync: ON' : 'Time Sync: OFF'}
          </button>
          */}
          {timeSyncEnabled && (
            <>
              <label className="time-window-label">Time Window:</label>
              <select 
                value={globalTimeWindow} 
                onChange={(e) => setTimeWindow(Number(e.target.value))}
                className="time-window-select"
              >
                <option value={30}>30 seconds</option>
                <option value={60}>1 minute</option>
                <option value={120}>2 minutes</option>
                <option value={300}>5 minutes</option>
                <option value={600}>10 minutes</option>
                <option value={1800}>30 minutes</option>
                <option value={3600}>1 hour</option>
              </select>
            </>
          )}
	  <button
	    className="btn btn-third"
	    onClick={handleDirectToConfig}
	  >
		PV Configurations
	  </button>
	  <div>
	    <button
	      className="btn btn-fourth"
	      onClick={handleSavePlotConfig}
	    >
	      Save Plot Configurations
	    </button>
              {saveStatus && (
                <span style={{ marginLeft: '10px' }}>{saveStatus}</span>
              )}
          </div> 
        </div>

        {/* Collapsible Info Panel */}
        {showInfo && (
          <div className="info-panel">
            <div className="info-item">
              <div className="info-label">Active Plots</div>
              <div className="info-value">{plots.length}</div>
            </div>
            <div className="info-item">
              <div className="info-label">Monitored PVs</div>
              <div className="info-value">
		{displayedPVNames.length}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="main-content" style={{ 
        display: 'flex', 
        flex: 1, 
        overflow: 'hidden',
        //minHeight: 'calc(100vh - 80px)'   // adjust the height
      }}>
      
        {/* Beamline status + Plot */}
        <div style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          <BeamlineStatus />
          <div style={{ flex: 1, overflow: 'auto' }}>
            <PlotGrid />
          </div>
        </div>


        <div className="right-sidebar">
          <div className="sidebar-header">
            <span>Live PV Values ({displayedPVNames.length})</span>
            <button
              type="button"
              className="btn btn-secondary sidebar-alias-toggle"
              onClick={() => setShowAlias((prev) => !prev)}
              title="Toggle live values between alias and PV name"
            >
              {showAlias ? "Show PV Names" : "Show Aliases"}
            </button>
          </div>
        
          <div className="sidebar-content">
            {displayedPVNames.map((pvName) => (
              <LivePVValue
                key={pvName}
                pvName={pvName}
                displayName={getDisplayName(pvName)}
                threshold={thresholds[pvName]}
                canRemove={livePVNames.includes(pvName)}
                onRemove={removeLivePV}
              />
            ))}
          </div>
        </div>



      </div>
    </div>











  );
}

export default App;
