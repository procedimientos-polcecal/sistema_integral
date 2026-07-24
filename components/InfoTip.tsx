"use client";

import { useState } from "react";

// Ícono de información (i) con un texto explicativo.
// Funciona con hover (desktop) y con clic (móvil).
export default function InfoTip({ text, className = "" }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <span
      className={`relative inline-flex align-middle ${className}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label="Más información"
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setOpen((v) => !v); }}
        className="inline-flex items-center justify-center rounded-full transition-colors"
        style={{
          width: 16, height: 16, fontSize: 11, lineHeight: 1,
          fontStyle: "italic", fontFamily: "Georgia, serif", fontWeight: 700,
          color: "#64748B", background: "#F1F5F9", border: "1px solid #CBD5E1",
          cursor: "help",
        }}
      >
        i
      </button>

      {open && (
        <>
          <span
            onClick={(e) => { e.stopPropagation(); setOpen(false); }}
            style={{ position: "fixed", inset: 0, zIndex: 49 }}
          />
          <span
            role="tooltip"
            style={{
              position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 50,
              width: "max-content", maxWidth: 260,
              background: "#0F172A", color: "#F1F5F9",
              fontSize: 12, lineHeight: 1.45, fontStyle: "normal", fontWeight: 400,
              padding: "8px 10px", borderRadius: 8,
              boxShadow: "0 8px 24px rgba(0,0,0,.18)",
              whiteSpace: "normal",
            }}
          >
            {text}
          </span>
        </>
      )}
    </span>
  );
}
