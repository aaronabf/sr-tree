"use client"

import { useCallback, useEffect, useState, type ReactNode } from "react"
import Win95Window from "./Win95Window"

type Options = {
  title?: string
  message: ReactNode
  confirmLabel?: string
  /** Red confirm button for destructive actions. */
  danger?: boolean
}

type Pending = Required<Options> & { resolve: (ok: boolean) => void }

/**
 * A themed replacement for window.confirm. Returns a `confirm` function that
 * resolves to true/false, and the `dialog` element to render somewhere in the
 * tree while a question is open.
 */
export function useConfirm() {
  const [pending, setPending] = useState<Pending | null>(null)

  const confirm = useCallback(
    (opts: Options) =>
      new Promise<boolean>((resolve) => {
        setPending({
          title: opts.title ?? "Are you sure?",
          message: opts.message,
          confirmLabel: opts.confirmLabel ?? "OK",
          danger: opts.danger ?? false,
          resolve,
        })
      }),
    [],
  )

  const dialog = pending ? (
    <ConfirmDialog
      {...pending}
      onResult={(ok) => {
        pending.resolve(ok)
        setPending(null)
      }}
    />
  ) : null

  return { confirm, dialog }
}

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger,
  onResult,
}: Omit<Pending, "resolve"> & { onResult: (ok: boolean) => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onResult(false)
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onResult])

  return (
    <div className="modal-backdrop" onClick={() => onResult(false)}>
      <div
        className="modal"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <Win95Window title={title} icon="⚠️" onClose={() => onResult(false)}>
          <div className="modal-body">{message}</div>
          <div className="row-actions">
            <button
              type="button"
              className={`btn ${danger ? "danger" : "primary"}`}
              autoFocus
              onClick={() => onResult(true)}
            >
              {confirmLabel}
            </button>
            <button type="button" className="btn" onClick={() => onResult(false)}>
              Cancel
            </button>
          </div>
        </Win95Window>
      </div>
    </div>
  )
}
