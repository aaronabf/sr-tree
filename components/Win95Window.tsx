"use client"

import type { CSSProperties, ReactNode } from "react"

type Props = {
  title: string
  icon?: string
  children: ReactNode
  className?: string
  style?: CSSProperties
  onClose?: () => void
  onMinimize?: () => void
  minimized?: boolean
}

/** Bevelled Windows 95 style window chrome. */
export default function Win95Window({
  title,
  icon,
  children,
  className,
  style,
  onClose,
  onMinimize,
  minimized = false,
}: Props) {
  return (
    <section className={`win ${className ?? ""}`} style={style} aria-label={title}>
      <header className="win-title">
        {icon ? (
          <span className="icon" aria-hidden>
            {icon}
          </span>
        ) : null}
        <span>{title}</span>
        <span className="spacer" />
        {onMinimize ? (
          <button
            type="button"
            className="win-btn"
            onClick={onMinimize}
            aria-label={minimized ? "Restore" : "Minimize"}
            title={minimized ? "Restore" : "Minimize"}
          >
            {minimized ? "□" : "_"}
          </button>
        ) : null}
        {onClose ? (
          <button type="button" className="win-btn" onClick={onClose} aria-label="Close" title="Close">
            ×
          </button>
        ) : null}
      </header>
      {minimized ? null : <div className="win-body">{children}</div>}
    </section>
  )
}
