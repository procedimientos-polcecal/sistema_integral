"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import InfoTip from "@/components/InfoTip";
import type { Alerta } from "@/lib/tallerVial/tablero";
import type { EquipoTallerVial } from "@/lib/tallerVial/consultas";

/** Las condiciones completas de lo que avisa el panel: el texto vive acá porque lo usan los dos lugares donde aparece (la franja de «Todo en orden» y el encabezado). */
const QUE_AVISA =
  "Aparecen sólo estas situaciones: nadie cargó combustible hace 4 días o más; un equipo lleva 3 días o más fuera de servicio; un equipo pasó más de 3 veces su intervalo habitual entre cargas, con un mínimo de 7 días (no se mira si está fuera de servicio, si no carga hace más de 60 días o si tiene menos de 5 cargas en 180 días; y si nadie cargó hace 4 días no se avisa equipo por equipo); su consumo de los últimos 30 días supera en más de 25 % al de los 150 días anteriores (con 3 y 5 cargas como mínimo, contando sólo las que tienen consumo calculable: con lectura y una lectura anterior que haya subido); o su service de 250 hs está vencido o a 50 hs o menos. Los de 500, 1000 y 2000 hs no avisan acá.";

const CLAVE = "taller-vial:alertas-abierta";
const EVENTO = "taller-vial:alertas-abierta-cambio";

function suscribirse(aviso: () => void) {
  window.addEventListener("storage", aviso);
  window.addEventListener(EVENTO, aviso);
  return () => {
    window.removeEventListener("storage", aviso);
    window.removeEventListener(EVENTO, aviso);
  };
}

function leer(): boolean {
  try { return window.localStorage.getItem(CLAVE) === "1"; } catch { return false; }
}

/**
 * Lo que pide acción hoy, arriba de todo. Si no hay nada lo dice igual: una
 * franja vacía no se distingue de una que no cargó.
 *
 * Arranca **minimizado**: la lista ocupa media pantalla y quien entra todos
 * los días no necesita verla desplegada cada vez (la primera versión arrancaba
 * abierta y había que minimizarla a mano, y se pidió al revés). Nada queda
 * escondido por eso: la línea minimizada sigue diciendo en rojo cuántas son
 * urgentes. Quien lo abre lo deja abierto en su navegador; la preferencia vive
 * en el navegador de cada uno, no en la base.
 */
export default function AlertasDeTaller({ alertas, equipos }: { alertas: Alerta[]; equipos: EquipoTallerVial[] }) {
  const criticas = alertas.filter((a) => a.nivel === "critica").length;
  const abierta = useSyncExternalStore(suscribirse, leer, () => false);
  const minimizada = !abierta;

  if (alertas.length === 0) {
    return (
      <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
        Todo en orden: ningún equipo pide atención hoy. <InfoTip text={QUE_AVISA} />
      </div>
    );
  }

  const nombre = (id: string | null) => {
    const e = equipos.find((x) => x.id === id);
    return e ? `${e.code} - ${e.name}` : null;
  };

  function alternar() {
    try {
      if (minimizada) window.localStorage.setItem(CLAVE, "1");
      else window.localStorage.removeItem(CLAVE);
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
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-slate-900">Para atender hoy</h2>
          <InfoTip text={QUE_AVISA} />
        </div>
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
