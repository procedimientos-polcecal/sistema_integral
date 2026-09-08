"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { comoSeLee, sumarDias } from "@/lib/core/fechas";
import {
  ETIQUETA_DE_ESTADO,
  ETIQUETA_DE_HORARIO,
  comoSeLeenLosMinutos,
  minutosEnCurso,
  proximoHorario,
} from "@/lib/despacho/orden";
import type { EstadoDeOrden, RemitoDeOdoo } from "@/lib/despacho/types";
import type { FilaDeCola } from "./page";
import NuevaOrden from "./NuevaOrden";

/**
 * La cola del día, en la PC de la balanza.
 *
 * DOS DECISIONES QUE SON LA PANTALLA
 *
 * **Un solo botón por fila: el del próximo horario que falta.** Con un camión
 * esperando, cuatro botones son cuatro oportunidades de marcar el equivocado, y
 * un horario marcado mal no se arregla sin mirar la planilla. El encargado no
 * elige qué marcar: marca lo que acaba de pasar.
 *
 * **El reloj del tramo en curso corre.** Es lo único que se calcula en el
 * cliente, porque avanza mientras la pantalla está abierta, y es la mitad del
 * valor del módulo: "cargando hace 42 min" es exactamente lo que la planilla del
 * día siguiente no puede decir.
 *
 * El reloj arranca en null y se llena después de montar. Calcularlo en el
 * servidor daría un texto y el cliente otro un segundo más tarde, que es un
 * error de hidratación — y encima se congelaría hasta el próximo refresh.
 */

const COLOR_DE_ESTADO: Record<EstadoDeOrden, string> = {
  esperando: "bg-slate-100 text-slate-600",
  en_predio: "bg-amber-100 text-amber-700",
  cargando: "bg-blue-100 text-blue-700",
  cargado: "bg-indigo-100 text-indigo-700",
  cerrada: "bg-emerald-100 text-emerald-700",
};

export default function ColaClient({
  fecha,
  hoy,
  filas,
  empresas,
  puedeEditar,
}: {
  fecha: string;
  hoy: string;
  filas: FilaDeCola[];
  empresas: { id: string; nombre: string }[];
  puedeEditar: boolean;
}) {
  const router = useRouter();
  const [ahora, setAhora] = useState<Date | null>(null);
  const [marcando, setMarcando] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [avisoPlanilla, setAvisoPlanilla] = useState("");
  const [creando, setCreando] = useState(false);
  const [remitos, setRemitos] = useState<(RemitoDeOdoo & { yaTieneOrden: boolean })[] | null>(null);
  const [errorRemitos, setErrorRemitos] = useState("");
  const [trayendoRemitos, setTrayendoRemitos] = useState(false);

  // Medio minuto: el dato se lee en minutos, así que refrescar más seguido es
  // gastar renders para mostrar el mismo número.
  useEffect(() => {
    setAhora(new Date());
    const t = setInterval(() => setAhora(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  async function traerRemitos() {
    setTrayendoRemitos(true);
    setErrorRemitos("");
    const res = await fetch(`/api/despacho/remitos?fecha=${fecha}`);
    const json = await res.json().catch(() => ({}));
    setTrayendoRemitos(false);
    if (!res.ok) {
      setErrorRemitos(json.error ?? "No se pudieron traer los remitos de Odoo.");
      setRemitos([]);
      return;
    }
    setRemitos(json.remitos ?? []);
  }

  function abrirAlta() {
    setCreando(true);
    // Odoo tarda, así que se pide al abrir el alta y no en cada tecla. Si ya se
    // trajeron, se reusan: el botón de refrescar está adentro del formulario.
    if (remitos === null) void traerRemitos();
  }

  async function marcar(id: string, horario: string) {
    setError("");
    setAvisoPlanilla("");
    setMarcando(id);
    const res = await fetch(`/api/despacho/ordenes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ horario }),
    });
    const json = await res.json().catch(() => ({}));
    setMarcando(null);

    if (!res.ok) {
      setError(json.error ?? "No se pudo marcar el horario.");
      return;
    }
    // Un fallo de escritura en la planilla no es un warning en la consola: se le
    // dice a quien hizo la acción. La orden quedó guardada igual.
    if (json.planilla_error) setAvisoPlanilla(json.planilla_error);
    router.refresh();
  }

  const abiertas = filas.filter((f) => f.estado !== "cerrada").length;

  return (
    <div className="mx-auto max-w-6xl space-y-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Despacho — la cola del día</h1>
          <p className="text-sm text-slate-500">
            {comoSeLee(fecha)} · {filas.length} {filas.length === 1 ? "orden" : "órdenes"}
            {abiertas > 0 && ` · ${abiertas} sin cerrar`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/despacho?fecha=${sumarDias(fecha, -1)}`}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            ← Día anterior
          </Link>
          {fecha !== hoy && (
            <Link
              href="/despacho"
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              Hoy
            </Link>
          )}
          {puedeEditar && (
            <button
              onClick={abrirAlta}
              className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)]"
            >
              + Nueva orden de carga
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {avisoPlanilla && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <strong>La orden se guardó, pero no llegó a la planilla.</strong> Google
          dijo: {avisoPlanilla}
        </div>
      )}

      {creando && (
        <NuevaOrden
          fecha={fecha}
          remitos={remitos}
          trayendo={trayendoRemitos}
          error={errorRemitos}
          empresas={empresas}
          onRefrescar={traerRemitos}
          onCerrar={() => setCreando(false)}
          onCreada={(aviso) => {
            setCreando(false);
            if (aviso) setAvisoPlanilla(aviso);
            void traerRemitos();
            router.refresh();
          }}
        />
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Nº</th>
                <th className="px-3 py-2 text-left">Cliente</th>
                <th className="px-3 py-2 text-left">Material</th>
                <th className="px-3 py-2 text-right">Cantidad</th>
                <th className="px-3 py-2 text-left">Estado</th>
                <th className="px-3 py-2 text-right">Carga</th>
                <th className="px-3 py-2 text-right">En predio</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filas.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-10 text-center text-slate-400">
                    Ninguna orden de carga este día.
                  </td>
                </tr>
              ) : (
                filas.map((f) => {
                  const siguiente = proximoHorario(f.orden);
                  const enCurso = ahora ? minutosEnCurso(f.orden, ahora) : null;
                  return (
                    <tr key={f.orden.id} className="align-top hover:bg-slate-50">
                      <td className="px-3 py-3 font-medium text-slate-900">
                        {f.orden.numero}
                        {f.atrasada && (
                          <span
                            className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs font-normal text-red-700"
                            title="Quedó abierta de un día anterior y todavía no llegó a la planilla"
                          >
                            {comoSeLee(f.orden.fecha)}
                          </span>
                        )}
                        <div className="text-xs font-normal text-slate-400">
                          {f.orden.odoo_picking_name ?? (
                            <span
                              className="text-amber-600"
                              title="Se cargó sin elegir un remito de Odoo. No se engancha uno parecido: queda vacío y se ve."
                            >
                              sin remito
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-slate-700">{f.orden.cliente_raw ?? "—"}</td>
                      <td className="px-3 py-3 text-slate-700">
                        {f.producto}
                        {f.sinClasificar && (
                          <div
                            className="text-xs text-amber-600"
                            title="El producto no está en el mapeo de Despacho: la planilla recibe el nombre crudo de Odoo"
                          >
                            sin clasificar
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right text-slate-600">
                        {f.orden.cantidad !== null
                          ? `${f.orden.cantidad} ${f.orden.unidad ?? ""}`.trim()
                          : "—"}
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`rounded px-2 py-0.5 text-xs font-medium ${COLOR_DE_ESTADO[f.estado]}`}
                        >
                          {ETIQUETA_DE_ESTADO[f.estado]}
                        </span>
                        {enCurso !== null && (
                          <div className="mt-1 text-xs text-slate-500">
                            hace {comoSeLeenLosMinutos(enCurso)}
                          </div>
                        )}
                        {f.salteados.length > 0 && (
                          <div
                            className="mt-1 text-xs text-red-600"
                            title="Sin ese horario no se puede calcular el tiempo, y la planilla recibe la celda vacía"
                          >
                            falta {f.salteados.map((h) => ETIQUETA_DE_HORARIO[h]).join(" y ")}
                          </div>
                        )}
                      </td>
                      <td
                        className={`px-3 py-3 text-right ${
                          (f.minutosDeCarga ?? 0) < 0 ? "font-semibold text-red-600" : "text-slate-600"
                        }`}
                      >
                        {comoSeLeenLosMinutos(f.minutosDeCarga)}
                      </td>
                      <td
                        className={`px-3 py-3 text-right ${
                          (f.minutosEnPredio ?? 0) < 0 ? "font-semibold text-red-600" : "text-slate-600"
                        }`}
                      >
                        {comoSeLeenLosMinutos(f.minutosEnPredio)}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {puedeEditar && siguiente && (
                          <button
                            onClick={() => marcar(f.orden.id, siguiente)}
                            disabled={marcando === f.orden.id}
                            className="rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-white hover:bg-[var(--primary-dark)] disabled:opacity-50"
                          >
                            {marcando === f.orden.id ? "…" : ETIQUETA_DE_HORARIO[siguiente]}
                          </button>
                        )}
                        {f.orden.sheets_pendiente && (
                          <div
                            className="mt-1 text-xs text-amber-600"
                            title={f.orden.sheets_pendiente}
                          >
                            sin llegar a la planilla
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-slate-400">
        Los horarios los pone el servidor al apretar el botón, no se tipean. La
        planilla se escribe cuando la orden se cierra.
      </p>
    </div>
  );
}
