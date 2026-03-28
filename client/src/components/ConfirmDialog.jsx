import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

const ConfirmDialogContext = createContext(null);

/**
 * @typedef {object} ConfirmOptions
 * @property {string} [title]
 * @property {string} message
 * @property {string} [confirmLabel]
 * @property {string} [cancelLabel]
 * @property {"danger" | "default"} [variant]
 */

export function ConfirmDialogProvider({ children }) {
  const [dialog, setDialog] = useState(null);
  const resolveRef = useRef(null);

  const requestConfirm = useCallback(
    /** @param {ConfirmOptions} options */ (options) => {
      const {
        title = "Confirm",
        message,
        confirmLabel = "Confirm",
        cancelLabel = "Cancel",
        variant = "danger",
      } = options;
      return new Promise((resolve) => {
        resolveRef.current = resolve;
        setDialog({ title, message, confirmLabel, cancelLabel, variant });
      });
    },
    [],
  );

  const finish = useCallback((value) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    setDialog(null);
    if (resolve) resolve(value);
  }, []);

  return (
    <ConfirmDialogContext.Provider value={requestConfirm}>
      {children}
      {dialog ? <ConfirmModal dialog={dialog} onResolve={finish} /> : null}
    </ConfirmDialogContext.Provider>
  );
}

/**
 * @returns {(options: ConfirmOptions) => Promise<boolean>}
 */
export function useConfirm() {
  const request = useContext(ConfirmDialogContext);
  if (!request) {
    throw new Error("useConfirm must be used within ConfirmDialogProvider");
  }
  return request;
}

function ConfirmModal({ dialog, onResolve }) {
  const { title, message, confirmLabel, cancelLabel, variant } = dialog;

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e) {
      if (e.key === "Escape") onResolve(false);
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [onResolve]);

  return (
    <div
      className="confirm-dialog-backdrop"
      role="presentation"
      onClick={() => onResolve(false)}
    >
      <div
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-desc"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-dialog-title" className="confirm-dialog__title">
          {title}
        </h2>
        <p id="confirm-dialog-desc" className="confirm-dialog__message">
          {message}
        </p>
        <div className="confirm-dialog__actions">
          <button type="button" className="btn btn--ghost" onClick={() => onResolve(false)}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={variant === "danger" ? "btn btn--danger" : "btn btn--primary"}
            onClick={() => onResolve(true)}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
