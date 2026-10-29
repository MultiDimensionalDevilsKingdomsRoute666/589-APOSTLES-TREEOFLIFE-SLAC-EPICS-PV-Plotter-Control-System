// src/components/BeamlineStatus.jsx
// Open/Closed status lights for every beamline, read from BLxx:OpenState.

import { useEffect } from "react";
import { pvConnectionPool } from "../services/PVConnectionPool";
import { useLiveValueStore } from "../stores/useLiveValueStore";
import "./BeamlineStatus.css";

const BEAMLINE_COUNT = 17;

const BEAMLINES = Array.from({ length: BEAMLINE_COUNT }, (_, i) => {
  const number = String(i + 1).padStart(2, "0");
  return { number, pvName: `BL${number}:OpenState` };
});

// BLxx:OpenState is DBF_ENUM: [0] Closed, [1] Open.
// The gateway sends the enum index, but accept the string form too.
const toState = (value) => {
  if (value === 1 || value === "Open") return "open";
  if (value === 0 || value === "Closed") return "closed";
  return "unknown";
};

const STATE_LABELS = {
  open: "Open",
  closed: "Closed",
  unknown: "No data",
};

function BeamlineLight({ pvName }) {
  const valueInfo = useLiveValueStore(
    (state) => state.latestValues[pvName]
  );

  const state = toState(valueInfo?.value);

  return (
    <span title={`${pvName}: ${STATE_LABELS[state]}`}>
      <span
        className={`beamline-light beamline-light-${state}`}
        aria-hidden="true"
      />{" "}
      {STATE_LABELS[state]}
    </span>
  );
}

function BeamlineStatus() {
  useEffect(() => {
    const unsubscribers = BEAMLINES.map(({ pvName }) =>
      pvConnectionPool.subscribe(pvName, {
        // The connection pool updates useLiveValueStore.
        onData: () => {},

        onError: (error) => {
          console.error(
            `[BEAMLINE STATUS] Error for ${pvName}:`,
            error
          );
        },
      })
    );

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, []);

  return (
    <div className="beamline-status-panel">
      <table className="beamline-status-table">
        <tbody>
          <tr>
            <th scope="row">Beamline</th>
            {BEAMLINES.map(({ number }) => (
              <td key={number}>BL{number}</td>
            ))}
          </tr>
          <tr>
            <th scope="row">Status</th>
            {BEAMLINES.map(({ number, pvName }) => (
              <td key={number}>
                <BeamlineLight pvName={pvName} />
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export default BeamlineStatus;
