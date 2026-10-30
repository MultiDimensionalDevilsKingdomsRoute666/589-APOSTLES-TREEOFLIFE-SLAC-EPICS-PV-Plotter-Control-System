// src/pages/ConfigPage.jsx
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { usePlotStore } from "../stores/usePlotStore";
import { API_BASE } from "../utils/constants";   
// Relative path: nginx proxies /api to the backend on the same origin.

function ConfigPage() {
  const navigate = useNavigate();

  // Get all the plots / live PVs from store
  const plots = usePlotStore((state) => state.plots);
  const livePVNames = usePlotStore((state) => state.livePVNames);
  const globalTimeWindow = usePlotStore((state) => state.globalTimeWindow);

  // Collect all monitored PV names (from plots + live list, de-duplicated)
  const plotPVNames = plots.flatMap((plot) => plot.pvNames);
  const displayedPVNames = Array.from(
    new Set([...plotPVNames, ...livePVNames]),
  );

  // Alias state (loaded from backend)
  const [aliases, setAliases] = useState({});

  const [selectedEgus, setSelectedEgus] = useState({});
  // Thresholds are kept as raw input strings ({ upper, lower } per PV)
  // so the user can type freely
  const [thresholds, setThresholds] = useState({});
  // "regular" or "exponential" per PV (missing means regular)
  const [valueFormats, setValueFormats] = useState({});
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState("");

  const handleEguChange = (pvName, newEguValue) => {
    setSelectedEgus((prevEgus) => ({
      ...prevEgus,
      [pvName]: newEguValue, // Dynamically updates EGU for this specific PV
    }));
  };

  // bound is "upper" or "lower"
  const handleThresholdChange = (pvName, bound, newThreshold) => {
    setThresholds((prev) => ({
      ...prev,
      [pvName]: { upper: "", lower: "", ...prev[pvName], [bound]: newThreshold },
    }));
  };

  const handleValueFormatChange = (pvName, newFormat) => {
    setValueFormats((prev) => ({ ...prev, [pvName]: newFormat }));
  };

  // Load aliases, EGUs and thresholds from backend on page mount
  useEffect(() => {
    // Load aliases
    fetch(`${API_BASE}/api/aliases`)
      .then((res) => res.json())
      .then((data) => setAliases(data || {}))
      .catch((err) => console.error("Failed to load aliases:", err));

    // Load thresholds
    fetch(`${API_BASE}/api/thresholds`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        const asStrings = {};
        for (const [pvName, value] of Object.entries(data || {})) {
          asStrings[pvName] = {
            upper: value?.upper != null ? String(value.upper) : "",
            lower: value?.lower != null ? String(value.lower) : "",
          };
        }
        setThresholds((prev) => ({ ...asStrings, ...prev }));
      })
      .catch((err) => console.error("Failed to load thresholds:", err));

    // Load value formats
    fetch(`${API_BASE}/api/value-formats`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => setValueFormats((prev) => ({ ...(data || {}), ...prev })))
      .catch((err) => console.error("Failed to load value formats:", err));

    // Load EGUs
    fetch(`${API_BASE}/api/egus`)
      .then((res) => res.json())
      .then((data) => {
        setSelectedEgus(data || {});
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load EGUs:", err);
        setLoading(false);
      });
  }, []);

  // Update alias locally while typing
  const handleAliasChange = (pvName, newAlias) => {
    setAliases((prev) => ({ ...prev, [pvName]: newAlias }));
  };

  // Save aliases to backend
  // Backend expects one { pv_name, alias } per POST, so submit each entry
  const handleSave = async () => {
    // Validate thresholds before saving anything
    for (const [pvName, { upper, lower }] of Object.entries(thresholds)) {
      const upperTrimmed = upper.trim();
      const lowerTrimmed = lower.trim();
      if (upperTrimmed !== "" && !Number.isFinite(Number(upperTrimmed))) {
        setSaveStatus(`Invalid upper threshold for ${pvName}`);
        return;
      }
      if (lowerTrimmed !== "" && !Number.isFinite(Number(lowerTrimmed))) {
        setSaveStatus(`Invalid lower threshold for ${pvName}`);
        return;
      }
      if (
        upperTrimmed !== "" &&
        lowerTrimmed !== "" &&
        Number(lowerTrimmed) > Number(upperTrimmed)
      ) {
        setSaveStatus(`Lower threshold exceeds upper threshold for ${pvName}`);
        return;
      }
    }

    try {
      setSaveStatus("Saving...");

      //Save aliases
      for (const [pvName, alias] of Object.entries(aliases)) {
        if (!alias) continue; // skip empty aliases
        const res = await fetch(`${API_BASE}/api/aliases`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pv_name: pvName, alias: alias }),
        });
        if (!res.ok) throw new Error("Save failed");
      }

      //Save EGUS ("default" removes the saved EGU)
      for (const [pvName, egu] of Object.entries(selectedEgus)) {
        const res =
          !egu || egu === "default"
            ? await fetch(
                `${API_BASE}/api/egus/${encodeURIComponent(pvName)}`,
                { method: "DELETE" },
              )
            : await fetch(`${API_BASE}/api/egus`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ pv_name: pvName, egu }),
              });
        if (!res.ok) throw new Error("Save failed");
      }

      //Save thresholds (emptying both fields removes the thresholds)
      for (const [pvName, { upper, lower }] of Object.entries(thresholds)) {
        const upperTrimmed = upper.trim();
        const lowerTrimmed = lower.trim();
        const res =
          upperTrimmed === "" && lowerTrimmed === ""
            ? await fetch(
                `${API_BASE}/api/thresholds/${encodeURIComponent(pvName)}`,
                { method: "DELETE" },
              )
            : await fetch(`${API_BASE}/api/thresholds`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  pv_name: pvName,
                  upper: upperTrimmed === "" ? null : Number(upperTrimmed),
                  lower: lowerTrimmed === "" ? null : Number(lowerTrimmed),
                }),
              });
        if (!res.ok) throw new Error("Save failed");
      }

      //Save value formats ("regular" removes the saved format)
      for (const [pvName, valueFormat] of Object.entries(valueFormats)) {
        const res =
          valueFormat === "exponential"
            ? await fetch(`${API_BASE}/api/value-formats`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  pv_name: pvName,
                  value_format: valueFormat,
                }),
              })
            : await fetch(
                `${API_BASE}/api/value-formats/${encodeURIComponent(pvName)}`,
                { method: "DELETE" },
              );
        if (!res.ok) throw new Error("Save failed");
      }

      setSaveStatus("Saved!");
      setTimeout(() => setSaveStatus(""), 2000);
    } catch (err) {
      console.error(err);
      setSaveStatus("Save failed");
    }
  };

  if (loading) {
    return <div style={{ padding: "20px" }}>Loading configurations...</div>;
  }

  return (
    <div style={{ padding: "20px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "20px",
        }}
      >
        <h1>Configurations</h1>
        <button className="btn btn-secondary" onClick={() => navigate("/")}>
          ← Back to Plots
        </button>
      </div>

      {/* Layout Info */}
      <section style={{ marginBottom: "30px" }}>
        <h2>Current Layout</h2>
        <p>Active plots: {plots.length}</p>
        <p>Monitored PVs: {displayedPVNames.length}</p>
        <p>Time window: {globalTimeWindow}s</p>
      </section>

      {/* PV Aliases */}
      <section>
        <h2>PV Aliases</h2>
        {displayedPVNames.length === 0 ? (
          <p>No PVs are being monitored. Add some PVs first.</p>
        ) : (
          <>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                maxWidth: "1100px",
              }}
            >
              <thead>
                <tr>
                  <th
                    style={{
                      textAlign: "left",
                      padding: "8px",
                      borderBottom: "2px solid #ccc",
                    }}
                  >
                    PV Name
                  </th>
                  <th
                    style={{
                      textAlign: "center",
                      padding: "8px",
                      borderBottom: "2px solid #ccc",
                    }}
                  >
                    In Plot?
                  </th>
                  <th
                    style={{
                      textAlign: "center",
                      padding: "8px",
                      borderBottom: "2px solid #ccc",
                    }}
                  >
                    Live Only
                  </th>
                  <th
                    style={{
                      textAlign: "left",
                      padding: "8px",
                      borderBottom: "2px solid #ccc",
                    }}
                  >
                    Alias (optional)
                  </th>
                  <th
                    style={{
                      textAlign: "left",
                      padding: "8px",
                      borderBottom: "2px solid #ccc",
                      minWidth: "160px",
                    }}
                  >
                    EGU
                  </th>
                  <th
                    style={{
                      textAlign: "left",
                      padding: "8px",
                      borderBottom: "2px solid #ccc",
                    }}
                  >
                    Lower Threshold (optional)
                  </th>
                  <th
                    style={{
                      textAlign: "left",
                      padding: "8px",
                      borderBottom: "2px solid #ccc",
                    }}
                  >
                    Upper Threshold (optional)
                  </th>
                  <th
                    style={{
                      textAlign: "left",
                      padding: "8px",
                      borderBottom: "2px solid #ccc",
                      minWidth: "130px",
                    }}
                  >
                    Value Format
                  </th>
                </tr>
              </thead>
              <tbody>
                {displayedPVNames.map((pvName) => {
                  const inPlot = plotPVNames.includes(pvName);
                  const liveOnly = livePVNames.includes(pvName) && !inPlot;
                  return (
                    <tr key={pvName}>
                      <td
                        style={{
                          padding: "8px",
                          borderBottom: "2px solid #eee",
                        }}
                      >
                        {pvName}
                      </td>
                      <td
                        style={{
                          textAlign: "center",
                          padding: "8px",
                          borderBottom: "2px solid #eee",
                        }}
                      >
                        {inPlot ? (
                          <span style={{ color: "#22c55e", fontSize: "18px" }}>
                            ✓
                          </span>
                        ) : (
                          <span style={{ color: "#ef4444", fontSize: "18px" }}>
                            ✗
                          </span>
                        )}
                      </td>
                      <td
                        style={{
                          textAlign: "center",
                          padding: "8px",
                          borderBottom: "2px solid #eee",
                        }}
                      >
                        {liveOnly ? (
                          <span style={{ color: "#22c55e", fontSize: "18px" }}>
                            ✓
                          </span>
                        ) : (
                          <span style={{ color: "#ef4444", fontSize: "18px" }}>
                            ✗
                          </span>
                        )}
                      </td>
                      <td
                        style={{
                          padding: "8px",
                          borderBottom: "2px solid #eee",
                        }}
                      >
                        <input
                          type="text"
                          value={aliases[pvName] || ""}
                          onChange={(e) =>
                            handleAliasChange(pvName, e.target.value)
                          }
                          placeholder="(no alias)"
                          style={{ width: "100%", padding: "4px" }}
                        />
                      </td>
                      <td
                        style={{
                          padding: "8px",
                          borderBottom: "2px solid #eee",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                          }}
                        >
                          <span style={{ minWidth: "40px", color: "#666" }}>
                            {selectedEgus[pvName] &&
                            selectedEgus[pvName] !== "default"
                              ? selectedEgus[pvName]
                              : "—"}
                          </span>

                          <select
                            id={`egu-${pvName}`}
                            value={selectedEgus[pvName] || "default"}
                            onChange={(e) =>
                              handleEguChange(pvName, e.target.value)
                            }
                            style={{ width: "100%", padding: "4px" }}
                          >
                            <option value="default">Arb.</option>
                            <option value="mm">mm</option>
                            <option value="deg">deg</option>
                            <option value="Volts">Volts</option>
                            <option value="mA">mA</option>
                            <option value="Counts">Counts</option>
                          </select>
                        </div>
                      </td>
                      <td
                        style={{
                          padding: "8px",
                          borderBottom: "2px solid #eee",
                        }}
                      >
                        <input
                          type="text"
                          inputMode="decimal"
                          value={thresholds[pvName]?.lower ?? ""}
                          onChange={(e) =>
                            handleThresholdChange(
                              pvName,
                              "lower",
                              e.target.value,
                            )
                          }
                          placeholder="(no lower)"
                          style={{ width: "100%", padding: "4px" }}
                        />
                      </td>
                      <td
                        style={{
                          padding: "8px",
                          borderBottom: "2px solid #eee",
                        }}
                      >
                        <input
                          type="text"
                          inputMode="decimal"
                          value={thresholds[pvName]?.upper ?? ""}
                          onChange={(e) =>
                            handleThresholdChange(
                              pvName,
                              "upper",
                              e.target.value,
                            )
                          }
                          placeholder="(no upper)"
                          style={{ width: "100%", padding: "4px" }}
                        />
                      </td>
                      <td
                        style={{
                          padding: "8px",
                          borderBottom: "2px solid #eee",
                        }}
                      >
                        <select
                          id={`value-format-${pvName}`}
                          value={valueFormats[pvName] || "regular"}
                          onChange={(e) =>
                            handleValueFormatChange(pvName, e.target.value)
                          }
                          style={{ width: "100%", padding: "4px" }}
                        >
                          <option value="regular">Regular</option>
                          <option value="exponential">Exponential</option>
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div style={{ marginTop: "20px" }}>
              <button className="btn btn-primary" onClick={handleSave}>
                Save Configs
              </button>
              {saveStatus && (
                <span style={{ marginLeft: "10px" }}>{saveStatus}</span>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

export default ConfigPage;
