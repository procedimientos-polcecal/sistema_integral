"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

interface Notificacion {
  id: string;
  titulo: string;
  cantidad: number;
  href: string;
}

export function NotificationsBell() {
  const [notificaciones, setNotificaciones] = useState<Notificacion[] | null>(null);
  const [abierto, setAbierto] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/home/resumen")
      .then((r) => r.json())
      .then((data) => setNotificaciones(data.notificaciones ?? []))
      .catch(() => setNotificaciones([]));
  }, []);

  useEffect(() => {
    function onClickFuera(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setAbierto(false);
    }
    document.addEventListener("mousedown", onClickFuera);
    return () => document.removeEventListener("mousedown", onClickFuera);
  }, []);

  const total = (notificaciones ?? []).reduce((acc, n) => acc + n.cantidad, 0);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        title="Notificaciones"
        className="relative flex h-8 w-8 items-center justify-center rounded-lg transition hover:bg-white/10"
        style={{ color: "var(--sidebar-text)", background: "none", border: "none", cursor: "pointer" }}
      >
        <IconBell />
        {total > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold"
            style={{ background: "var(--primary-tint)", color: "var(--sidebar-bg)" }}
          >
            {total}
          </span>
        )}
      </button>

      {abierto && (
        <div
          className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-lg border bg-white shadow-lg"
          style={{ borderColor: "var(--border)" }}
        >
          <div className="section-title px-4 pt-3 pb-2">Notificaciones</div>
          {!notificaciones || notificaciones.length === 0 ? (
            <div className="px-4 pb-4 text-sm text-gray-400">
              {notificaciones === null ? "Cargando..." : "Sin novedades por ahora."}
            </div>
          ) : (
            <div className="pb-1">
              {notificaciones.map((n) => (
                <Link
                  key={n.id}
                  href={n.href}
                  onClick={() => setAbierto(false)}
                  className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-gray-50"
                >
                  <span className="text-gray-700">{n.titulo}</span>
                  <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: "var(--accent-light)", color: "var(--accent-dark)" }}>
                    {n.cantidad}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function IconBell() {
  return (
    <svg width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
      <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.73 21a2 2 0 01-3.46 0" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
