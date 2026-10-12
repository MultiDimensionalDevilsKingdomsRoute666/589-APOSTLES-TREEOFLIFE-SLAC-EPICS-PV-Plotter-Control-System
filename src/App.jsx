// src/App.jsx
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlotStore } from './stores/usePlotStore';
import { useLiveValueStore } from "./stores/useLiveValueStore";
import { pvConnectionPool } from "./services/PVConnectionPool";

import PlotGrid from './components/PlotGrid';
import { Plus, Trash2, Activity, Clock, ChevronDown, ChevronUp, X } from 'lucide-react';
import './App.css';


function LivePVValue({
  pvName,
  canRemove,
  onRemove,
}) {
  const valueInfo = useLiveValueStore(
    (state) => state.latestValues[pvName]
  );

  const numericValue = Number(valueInfo?.value);

  return (
    <div className="value-item">
      <div className="pv-name">
        <div className="pv-name-scroll-container">
        {pvName}
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

  const handleDirectToConfig = () => {
    navigate('/config');
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
		Configuratons
	  </button>
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
      
        {/* Plot */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          <PlotGrid />
        </div>


        <div className="right-sidebar">
          <div className="sidebar-header">
            Live PV Values ({displayedPVNames.length})
          </div>
        
          <div className="sidebar-content">
            {displayedPVNames.map((pvName) => (
              <LivePVValue
                key={pvName}
                pvName={pvName}
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
