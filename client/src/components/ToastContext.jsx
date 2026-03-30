import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

/**
 * @typedef {"info" | "warning" | "error" | "success"} ToastVariant
 * @typedef {{ duration?: number }} ToastOptions
 */

const ToastContext = createContext(null);

let idSeq = 0;
function nextId() {
  idSeq += 1;
  return `toast-${idSeq}`;
}

/**
 * @param {{ children: import("react").ReactNode }} props
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState(
    /** @type {{ id: string; variant: ToastVariant; message: string }[]} */ ([]),
  );

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    /**
     * @param {ToastVariant} variant
     * @param {string} message
     * @param {number} [durationMs]
     */
    (variant, message, durationMs = 5000) => {
      const id = nextId();
      setToasts((prev) => [...prev, { id, variant, message }]);
      if (durationMs > 0) {
        window.setTimeout(() => dismiss(id), durationMs);
      }
      return id;
    },
    [dismiss],
  );

  const value = useMemo(
    () => ({
      /** @param {string} message @param {ToastOptions} [opts] */
      info: (message, opts) => push("info", message, opts?.duration ?? 5000),
      /** @param {string} message @param {ToastOptions} [opts] */
      warning: (message, opts) => push("warning", message, opts?.duration ?? 5500),
      /** @param {string} message @param {ToastOptions} [opts] */
      error: (message, opts) => push("error", message, opts?.duration ?? 6500),
      /** @param {string} message @param {ToastOptions} [opts] */
      success: (message, opts) => push("success", message, opts?.duration ?? 4500),
      dismiss,
    }),
    [push, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

/**
 * @returns {{
 *   info: (message: string, opts?: ToastOptions) => string;
 *   warning: (message: string, opts?: ToastOptions) => string;
 *   error: (message: string, opts?: ToastOptions) => string;
 *   success: (message: string, opts?: ToastOptions) => string;
 *   dismiss: (id: string) => void;
 * }}
 */
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return ctx;
}

/**
 * @param {{
 *   toasts: { id: string; variant: ToastVariant; message: string }[];
 *   onDismiss: (id: string) => void;
 * }} props
 */
function ToastViewport({ toasts, onDismiss }) {
  if (!toasts.length) return null;
  return (
    <div className="toast-viewport" aria-live="polite" aria-relevant="additions text">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
}

/** @param {{ toast: { id: string; variant: ToastVariant; message: string }; onDismiss: () => void }} props */
function ToastItem({ toast, onDismiss }) {
  const { variant, message } = toast;
  const role = variant === "error" ? "alert" : "status";

  return (
    <div className={`toast toast--${variant}`} role={role}>
      <span className="toast__icon" aria-hidden>
        {variant === "info" ? <IconInfo /> : null}
        {variant === "warning" ? <IconWarning /> : null}
        {variant === "error" ? <IconError /> : null}
        {variant === "success" ? <IconSuccess /> : null}
      </span>
      <p className="toast__message">{message}</p>
      <button type="button" className="toast__close" onClick={onDismiss} aria-label="Dismiss notification">
        ×
      </button>
    </div>
  );
}

function IconInfo() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.75" />
      <path d="M12 10v6M12 7h.01" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

function IconWarning() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M12 3L2.5 20h19L12 3z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        fill="none"
      />
      <path d="M12 9v5M12 17h.01" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

function IconError() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.75" />
      <path d="M15 9l-6 6M9 9l6 6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

function IconSuccess() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.75" />
      <path d="M8 12l2.5 2.5L16 9" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
