"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import type { Alerta } from "@/lib/tallerVial/tablero";
import type { EquipoTallerVial } from "@/lib/tallerVial/consultas";

const CLAVE = "taller-vial:alertas-minimizadas";
const EVENTO = "taller-vial:alertas-minimizadas-cambio";

function suscribirse(aviso: () => void) {
  window.addEventListener("storage", aviso);
  window.addEventListener(EVENTO, aviso);
  return () => {
    window.removeEventListener("storage", aviso);
    window.removeEventListener(EVENTO, aviso);
  };
}

function leer(): string | null {
  try { return window.localStorage.getItem(CLAVE); } catch { return null; }
}

/**
 * Lo que pide acción hoy, arriba de todo. Si no hay nada lo dice igual: una
 * franja vacía no se distingue de una que no cargó.
 *
 * Se puede minimizar, porque ocupa media pantalla todo el tiempo y quien ya
 * lo vio no necesita seguir mirándolo. Pero minimizar no puede esconder lo
 * nuevo: se guarda cuántas alertas había (y cuántas urgentes), y si aparece
 * una más, o una urgente más, se vuelve a abrir sola. El estado vive en el
 * navegador de cada uno, no en la base.
 */
export default function AlertasDeTaller({ alertas, equipos }: { alertas: Alerta[]; equipos: EquipoTallerVial[] }) {
  const criticas = alertas.filter((a) => a.nivel === "critica").length;
  const guardado = useSyncExternalStore(suscribirse, leer, () => null);
  const [n0, c0] = (guardado ?? "").split(":").map(Number);
  const minimizada = guardado !== null && alertas.length <= n0 && criticas <= c0;

  if (alertas.length === 0) {
    return (
      <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
        Todo en orden: ningún equipo pide atención hoy.
      </div>
    );
  }

  const nombre = (id: string | null) => {
    const e = equipos.find((x) => x.id === id);
    return e ? `${e.code} - ${e.name}` : null;
  };

  function alternar() {
    try {
      if (minimizada) window.localStorage.removeItem(CLAVE);
      else window.localStorage.setItem(CLAVE, `${alertas.length}:${criticas}`);
    } catch {
      // Sin almacenamiento (ventana privada, datos bloqueados) no se puede
      // recordar; el panel queda como estaba.
    }
    window.dispatchEvent(new Event(EVENTO));
  }

  const resumen = (
    <span className="text-xs text-slate-500">
      {criticas > 0 && <span className="font-medium text-red-600">{criticas} urgente{criticas > 1 ? "s" : ""}</span>}
      {criticas > 0 && alertas.length > criticas && " · "}
      {alertas.length > criticas && `${alertas.length - criticas} a revisar`}
    </span>
  );

  return (
    <section className={`card mt-4 ${minimizada ? "px-4 py-2" : "p-4"}`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold text-slate-900">Para atender hoy</h2>
        <div className="flex items-center gap-3">
          {resumen}
          <button
            onClick={alternar}
            aria-expanded={!minimizada}
            className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          >
            {minimizada ? "Mostrar ▾" : "Minimizar ▴"}
          </button>
        </div>
      </div>
      {!minimizada && <ul className="mt-3 space-y-2">
        {alertas.map((a, i) => {
          const critica = a.nivel === "critica";
          const enlace = a.tipo === "SERVICE_VENCIDO" || a.tipo === "SERVICE_PROXIMO" ? "/taller-vial/services"
            : a.tipo === "FUERA_DE_SERVICIO" ? "/taller-vial/estados"
            : "/taller-vial/cargas";
          return (
            <li
              key={`${a.tipo}-${a.equipoId ?? "flota"}-${i}`}
              className={`flex items-start gap-3 rounded-lg border-l-4 px-3 py-2 text-sm ${
                critica ? "border-red-500 bg-red-50" : "border-amber-500 bg-amber-50"
              }`}
            >
              <span className="min-w-0 flex-1">
                {nombre(a.equipoId) && <span className="font-semibold text-slate-900">{nombre(a.equipoId)} · </span>}
                <span className={critica ? "text-red-800" : "text-amber-900"}>{a.texto}</span>
              </span>
              <Link href={enlace} className="shrink-0 text-xs text-slate-500 underline">Ver →</Link>
            </li>
          );
        })}
      </ul>}
    </section>
  );
}
