"use client";

import { useState } from "react";
import { COLUMNAS, type FilaDelPlan, type PlanDeImportacion } from "@/lib/ventas/crm/importarClientes";

/**
 * Importar un Excel de clientes, en dos pasos: ver qué pasaría y recién después
 * confirmarlo.
 *
 * ── EL FORMATO SE MUESTRA ANTES DE PEDIR EL ARCHIVO ─────────
 *
 * La tabla de columnas está arriba del selector y no escondida en un documento,
 * porque el momento en que alguien necesita saber qué columnas van es
 * exactamente el momento en que está por elegir el archivo. Sale de `COLUMNAS`,
 * el mismo arreglo contra el que el importador reconoce los encabezados y con
 * el que se arma la plantilla: los tres no pueden discrepar.
 *
 * ── LA PREVISUALIZACIÓN ES LA DEFENSA, NO UN LUJO ───────────
 *
 * La ruta que previsualiza no escribe nada. Lo que se ve acá —cuántas entran,
 * cuántas ya están, cuáles tienen un problema— es lo que se confirma, y se
 * manda tal cual: no se vuelve a interpretar el archivo, porque entre mirar y
 * confirmar la interpretación podría dar otra cosa.
 *
 * ── DESPUÉS DE IMPORTAR SE RECARGA LA PÁGINA ENTERA ─────────
 *
 * A propósito, y no por comodidad: la lista, el semáforo y los conteos del
 * tablero salen del servidor, y meter trescientos clientes nuevos en el estado
 * local dejaría la pantalla diciendo números que no salieron de la base. Es una
 * operación que se hace una vez cada mucho; una recarga es barata y es la única
 * forma de que lo que se ve sea lo que quedó.
 */

interface Props {
  onCerrar: () => void;
}

const COLOR: Record<FilaDelPlan["estado"], { nombre: string; color: string }> = {
  nueva: { nombre: "Entra", color: "#15803D" },
  ya_existe: { nombre: "Ya está", color: "#64748B" },
  repetida: { nombre: "Repetida", color: "#B45309" },
  con_problema: { nombre: "Problema", color: "#B91C1C" },
};

export default function ImportarClientesModal({ onCerrar }: Props) {
  const [plan, setPlan] = useState<PlanDeImportacion | null>(null);
  const [nombreDelArchivo, setNombreDelArchivo] = useState<string | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [importando, setImportando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{
    creados: number;
    rechazados: { razon_social: string; motivo: string }[];
  } | null>(null);

  async function previsualizar(archivo: File) {
    setError(null);
    setPlan(null);
    setResultado(null);
    setNombreDelArchivo(archivo.name);
    setLeyendo(true);

    try {
      const cuerpo = new FormData();
      cuerpo.append("archivo", archivo);
      const r = await fetch("/api/ventas/clientes/importar", { method: "POST", body: cuerpo });
      const respuesta = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(respuesta.error ?? `El servidor contestó ${r.status}`);
      setPlan(respuesta.plan);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLeyendo(false);
    }
  }

  async function confirmar() {
    if (!plan) return;
    const nuevos = plan.filas.filter((f) => f.estado === "nueva").map((f) => f.cliente!);
    if (nuevos.length === 0) return;

    setError(null);
    setImportando(true);
    try {
      const r = await fetch("/api/ventas/clientes/importar/confirmar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientes: nuevos }),
      });
      const respuesta = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(respuesta.error ?? `El servidor contestó ${r.status}`);
      setResultado(respuesta);
      setPlan(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setImportando(false);
    }
  }

  const nuevas = plan?.resumen.nuevas ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="card my-8 w-full max-w-3xl space-y-4 p-5" style={{ background: "var(--surface, #fff)" }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Importar clientes desde Excel</h2>
            <p className="text-sm text-slate-500">
              Primero se muestra qué pasaría. Nada se guarda hasta que lo confirmes.
            </p>
          </div>
          <button type="button" onClick={onCerrar} className="btn-ghost text-sm">
            Cerrar
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {/* ── Lo que terminó pasando ── */}
        {resultado && (
          <div className="space-y-3">
            <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
              Se cargaron <strong>{resultado.creados}</strong>{" "}
              {resultado.creados === 1 ? "cliente" : "clientes"}.
            </div>
            {resultado.rechazados.length > 0 && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-semibold">
                  {resultado.rechazados.length} no entraron, y éstos son:
                </p>
                <ul className="mt-1 list-disc pl-5">
                  {resultado.rechazados.map((r, i) => (
                    <li key={i}>
                      {r.razon_social} — {r.motivo}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="btn-primary text-sm"
              >
                Ver la lista
              </button>
            </div>
          </div>
        )}

        {/* ── El formato, antes de pedir el archivo ── */}
        {!plan && !resultado && (
          <>
            <div className="space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-600">
                  Las columnas
                </h3>
                <a href="/api/ventas/clientes/importar/plantilla" className="text-sm text-sky-700 hover:underline">
                  Bajar la plantilla
                </a>
              </div>
              <p className="text-sm text-slate-500">
                Se buscan <strong>por el nombre del encabezado</strong>, así que el orden no
                importa y las columnas de más se ignoran. La primera fila es el encabezado.
              </p>
              {/* `overflow-x-auto`: la tabla no entra en 343 px y sin esto la
                  pantalla entera scrollea de costado. */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="py-1.5 pr-3">Columna</th>
                      <th className="py-1.5 pr-3">Qué acepta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {COLUMNAS.map((c) => (
                      <tr key={c.campo} className="border-b border-slate-100 align-top">
                        <td className="whitespace-nowrap py-1.5 pr-3 font-medium text-slate-900">
                          {c.nombre}
                          {c.obligatoria && (
                            <span className="ml-1 text-xs font-semibold" style={{ color: "#B91C1C" }}>
                              obligatoria
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 pr-3 text-slate-600">{c.acepta}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="border-t border-slate-200 pt-3">
              <label htmlFor="archivo" className="mb-1 block text-xs font-medium text-slate-600">
                El archivo (.xlsx)
              </label>
              <input
                id="archivo"
                type="file"
                accept=".xlsx"
                disabled={leyendo}
                onChange={(e) => {
                  const archivo = e.target.files?.[0];
                  if (archivo) void previsualizar(archivo);
                }}
                className="input"
              />
              {leyendo && <p className="mt-2 text-sm text-slate-500">Leyendo {nombreDelArchivo}…</p>}
            </div>
          </>
        )}

        {/* ── El plan ── */}
        {plan && (
          <div className="space-y-3">
            {plan.columnas.faltan.length > 0 ? (
              <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
                <p className="font-semibold">
                  No se encontró la columna {plan.columnas.faltan.join(", ")}.
                </p>
                <p className="mt-1">
                  Es lo único obligatorio. Revisá que la primera fila del Excel sea el encabezado y
                  que esa columna esté escrita con ese nombre.
                </p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {(Object.keys(COLOR) as FilaDelPlan["estado"][]).map((estado) => {
                    const cuantas = plan.filas.filter((f) => f.estado === estado).length;
                    return (
                      <div key={estado} className="rounded-lg border border-slate-200 p-2">
                        <div className="text-lg font-bold" style={{ color: COLOR[estado].color }}>
                          {cuantas}
                        </div>
                        <div className="text-xs text-slate-500">{COLOR[estado].nombre}</div>
                      </div>
                    );
                  })}
                </div>

                {plan.columnas.ignoradas.length > 0 && (
                  <p className="text-xs text-slate-500">
                    Columnas que el archivo trae y no se usan:{" "}
                    {plan.columnas.ignoradas.join(", ")}.
                  </p>
                )}

                {/* `overflow-auto` y no sólo `overflow-y-auto`: tres columnas
                    con los motivos de cada fila no entran en los 343 px de un
                    teléfono, y sin el scroll horizontal la tabla se sale de la
                    tarjeta. El `sticky` del encabezado sigue funcionando. */}
                <div className="max-h-80 overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-white">
                      <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                        <th className="py-1.5 pr-2">Fila</th>
                        <th className="py-1.5 pr-2">Cliente</th>
                        <th className="py-1.5 pr-2">Qué pasa</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.filas.map((f) => (
                        <tr key={f.fila} className="border-b border-slate-100 align-top">
                          <td className="py-1.5 pr-2 text-slate-400">{f.fila}</td>
                          <td className="py-1.5 pr-2">
                            <span className="font-medium text-slate-900">
                              {f.cliente?.razon_social ?? "—"}
                            </span>
                            {f.cliente?.cuit && (
                              <span className="text-slate-500"> · {f.cliente.cuit}</span>
                            )}
                          </td>
                          <td className="py-1.5 pr-2">
                            <span
                              className="font-semibold"
                              style={{ color: COLOR[f.estado].color }}
                            >
                              {COLOR[f.estado].nombre}
                            </span>
                            {[...f.problemas, ...f.avisos].map((t, i) => (
                              <span key={i} className="block text-xs text-slate-500">
                                {t}
                              </span>
                            ))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-3">
              <button
                type="button"
                onClick={() => {
                  setPlan(null);
                  setNombreDelArchivo(null);
                }}
                className="btn-secondary text-sm"
              >
                Elegir otro archivo
              </button>
              <button
                type="button"
                onClick={() => void confirmar()}
                disabled={importando || nuevas === 0}
                className="btn-primary text-sm"
              >
                {importando
                  ? "Importando…"
                  : nuevas === 0
                    ? "No hay nada para importar"
                    : `Importar ${nuevas} ${nuevas === 1 ? "cliente" : "clientes"}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
