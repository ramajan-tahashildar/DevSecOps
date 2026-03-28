import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./AuthContext";
import { ConfirmDialogProvider } from "./components/ConfirmDialog";
import { DashboardShell } from "./components/DashboardShell";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { Landing } from "./pages/Landing";
import { Login } from "./pages/Login";
import { DashboardHome } from "./pages/DashboardHome";
import { SecretEditor } from "./pages/SecretEditor";
import { ScannerEditor } from "./pages/ScannerEditor";
import { ScannerReports } from "./pages/ScannerReports";
import { ScannersList } from "./pages/ScannersList";
import { SecretsList } from "./pages/SecretsList";
import { Signup } from "./pages/Signup";

function GuestOnly({ children }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="shell shell--center">
        <p className="muted">Loading…</p>
      </div>
    );
  }
  if (user) return <Navigate to="/dashboard" replace />;
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route
        path="/login"
        element={
          <GuestOnly>
            <Login />
          </GuestOnly>
        }
      />
      <Route
        path="/signup"
        element={
          <GuestOnly>
            <Signup />
          </GuestOnly>
        }
      />
      <Route element={<ProtectedRoute />}>
        <Route path="/dashboard" element={<DashboardShell />}>
          <Route index element={<DashboardHome />} />
          <Route path="secrets" element={<SecretsList />} />
          <Route path="secrets/new" element={<SecretEditor />} />
          <Route path="secrets/:id" element={<SecretEditor />} />
          <Route path="scanners" element={<ScannersList />} />
          <Route path="scanners/new" element={<ScannerEditor />} />
          <Route path="scanners/:id/edit" element={<ScannerEditor />} />
          <Route path="scanners/:id" element={<ScannerReports />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ConfirmDialogProvider>
          <div className="app-root">
            <AppRoutes />
          </div>
        </ConfirmDialogProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
