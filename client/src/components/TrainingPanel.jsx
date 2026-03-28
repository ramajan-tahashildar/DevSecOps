export function TrainingPanel({ className = "" }) {
  return (
    <aside className={`training-panel ${className}`.trim()}>
      <h2 className="training-panel__title">Training · quickstart</h2>
      <pre className="training-panel__ascii">
{`┌── cloud-ops.sh ────────────────────────┐
│ # 1  Create an account or sign in    │
│ # 2  Model environments & connectors │
│ # 3  aws | azure | gcp | git | docker │
│ # 4  Security defaults, encrypted data │
│ # 5  Automate via JWT on /api/*        │
└───────────────────────────────────────┘`}
      </pre>
      <ul className="training-panel__list">
        <li>
          <strong>Auth</strong> — JWT in <code>Authorization: Bearer …</code> after login.
        </li>
        <li>
          <strong>Platform</strong> — Multi-cloud and toolchain connections, built for scale and least-privilege
          hygiene.
        </li>
        <li>
          <strong>Ops & cost</strong> — API-first workflows so you can grow capacity without proportional
          toil; run API on 3000, UI on 5173, set <code>CLIENT_ORIGIN</code> if the dev URL changes.
        </li>
      </ul>
    </aside>
  );
}
