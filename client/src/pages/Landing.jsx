import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as api from "../api";
import { TrainingPanel } from "../components/TrainingPanel";

export function Landing() {
  const [status, setStatus] = useState({ api: null, db: null });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await api.health();
        if (alive) setStatus((s) => ({ ...s, api: true }));
      } catch {
        if (alive) setStatus((s) => ({ ...s, api: false }));
      }
      try {
        await api.pingDb();
        if (alive) setStatus((s) => ({ ...s, db: true }));
      } catch {
        if (alive) setStatus((s) => ({ ...s, db: false }));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const dot = (v) => (v === true ? "●" : v === false ? "○" : "·");

  return (
    <div className="landing">
      <div className="landing__hero">
        <div className="landing__display">
          <p className="landing__display-eyebrow">Cloud security platform</p>
          <h1 className="landing__display-title">DevSecOps</h1>
        </div>
        <p className="landing__tagline">
          Cloud-native DevSecOps — ship securely, scale your teams and workloads with confidence, and keep
          infrastructure spend efficient as you grow.
        </p>
        <div className="landing__status mono">
          <span>
            API {dot(status.api)}{" "}
            {status.api === true ? "up" : status.api === false ? "down" : "…"}
          </span>
          <span className="landing__status-sep">|</span>
          <span>
            MongoDB {dot(status.db)}{" "}
            {status.db === true ? "reachable" : status.db === false ? "unreachable" : "…"}
          </span>
        </div>
        <div className="landing__cta">
          <Link className="btn btn--primary" to="/signup">
            Start free
          </Link>
          <Link className="btn btn--ghost" to="/login">
            Sign in
          </Link>
        </div>
      </div>
      <TrainingPanel className="landing__training" />
    </div>
  );
}
