import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext";
import * as api from "../api";

export function Signup() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    age: "",
    password: "",
    middleName: "",
    phone: "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function setField(key) {
    return (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const payload = {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        age: Number(form.age),
        password: form.password,
      };
      if (form.middleName.trim()) payload.middleName = form.middleName.trim();
      if (form.phone.trim()) payload.phone = form.phone.trim();

      const data = await api.signup(payload);
      signIn(data.token, data.user);
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err.message || "Signup failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <Link to="/" className="auth-page__back muted">
        ← Home
      </Link>
      <div className="auth-card auth-card--wide">
        <header className="auth-card__header">
          <h1 className="auth-card__title">Create account</h1>
        </header>
        <form className="form form--grid" onSubmit={onSubmit}>
          <label className="field">
            <span>First name</span>
            <input value={form.firstName} onChange={setField("firstName")} required />
          </label>
          <label className="field">
            <span>Last name</span>
            <input value={form.lastName} onChange={setField("lastName")} required />
          </label>
          <label className="field field--full">
            <span>Middle name (optional)</span>
            <input value={form.middleName} onChange={setField("middleName")} />
          </label>
          <label className="field field--full">
            <span>Email</span>
            <input type="email" autoComplete="email" value={form.email} onChange={setField("email")} required />
          </label>
          <label className="field">
            <span>Age</span>
            <input
              type="number"
              min={13}
              max={120}
              value={form.age}
              onChange={setField("age")}
              required
            />
          </label>
          <label className="field">
            <span>Phone (optional)</span>
            <input type="tel" value={form.phone} onChange={setField("phone")} />
          </label>
          <label className="field field--full">
            <span>Password (min 8 characters)</span>
            <input
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={setField("password")}
              minLength={8}
              required
            />
          </label>
          {error ? <p className="form-error field--full">{error}</p> : null}
          <button type="submit" className="btn btn--primary btn--block field--full" disabled={busy}>
            {busy ? "Creating…" : "Create account"}
          </button>
        </form>
        <p className="auth-card__footer muted">
          Already registered? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
