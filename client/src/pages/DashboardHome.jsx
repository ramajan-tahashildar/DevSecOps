import { TrainingPanel } from "../components/TrainingPanel";

export function DashboardHome() {
  return (
    <div className="dashboard-home">
      <header className="dashboard-home__head">
        <h1 className="dashboard-home__title">Dashboard</h1>
        <p className="dashboard-home__lead muted">
          Overview and quickstart for your DevSecOps workspace.
        </p>
      </header>
      <TrainingPanel />
    </div>
  );
}
