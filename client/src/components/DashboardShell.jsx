import { Link, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../AuthContext";

function accountInitials(user) {
  if (!user) return "?";
  const a = (user.firstName || "").trim()[0] || "";
  const b = (user.lastName || "").trim()[0] || "";
  if (a || b) return `${a}${b}`.toUpperCase();
  const e = (user.email || "?").trim();
  return e[0].toUpperCase();
}

function accountDisplayName(user) {
  if (!user) return "";
  const parts = [user.firstName, user.lastName].filter(Boolean).map((s) => String(s).trim());
  const full = parts.join(" ");
  return full || user.email || "";
}

export function DashboardShell() {
  const { user, signOut } = useAuth();
  const { pathname } = useLocation();

  const dashboardActive = pathname === "/dashboard";
  const secretsActive = pathname.startsWith("/dashboard/secrets");
  const scannerActive = pathname.startsWith("/dashboard/scanners");

  return (
    <div className="dashboard">
      <div className="dashboard__frame">
        <header className="dashboard__topbar">
          <div className="dashboard__topbar-left">
            <span className="dashboard__topbar-brand">DevSecOps</span>
            <span className="dashboard__topbar-divider" aria-hidden />
            <span className="dashboard__topbar-tagline muted">Security console</span>
          </div>
          <div className="dashboard__topbar-right">
            <section className="dashboard__account" aria-labelledby="dashboard-account-heading">
              <p id="dashboard-account-heading" className="dashboard__account-heading muted">
                My account
              </p>
              <div className="dashboard__account-row">
                <div className="dashboard__account-text">
                  <span className="dashboard__account-display" title={accountDisplayName(user)}>
                    {accountDisplayName(user)}
                  </span>
                  <span className="dashboard__account-email mono" title={user?.email}>
                    {user?.email}
                  </span>
                </div>
                <div className="dashboard__account-avatar" aria-hidden>
                  {accountInitials(user)}
                </div>
                <button
                  type="button"
                  className="btn btn--ghost btn--small dashboard__topbar-signout"
                  onClick={signOut}
                >
                  Sign out
                </button>
              </div>
            </section>
          </div>
        </header>

        <div className="dashboard__layout">
          <aside className="dashboard__sidebar" aria-label="Main navigation">
            <Link to="/dashboard" className="dashboard__sidebar-brand brand">
              <span className="brand__mark" aria-hidden />
              <span className="brand__text">DevSecOps</span>
            </Link>

            <p className="dashboard__nav-label muted">Menu</p>
            <nav className="dashboard__sidebar-nav">
              <Link
                to="/dashboard"
                className={`sidebar-nav__link${dashboardActive ? " sidebar-nav__link--active" : ""}`}
              >
                Dashboard
              </Link>
              <Link
                to="/dashboard/secrets"
                className={`sidebar-nav__link${secretsActive ? " sidebar-nav__link--active" : ""}`}
              >
                Secrets
              </Link>
              <Link
                to="/dashboard/scanners"
                className={`sidebar-nav__link${scannerActive ? " sidebar-nav__link--active" : ""}`}
              >
                Scanner
              </Link>
            </nav>

            <div className="dashboard__sidebar-spacer" aria-hidden />
          </aside>

          <div className="dashboard__main-shell">
            <main className="dashboard__main">
              <Outlet />
            </main>
          </div>
        </div>
      </div>
    </div>
  );
}
