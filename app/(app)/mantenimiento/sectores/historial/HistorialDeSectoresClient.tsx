"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import KpiCard from "@/components/KpiCard";
import MultiSelect from "@/components/MultiSelect";
import {
  filtrarCambios, duracionLegible, resumirHistorial, hayFiltrosDelHistorial,
  FILTROS_DEL_HISTORIAL_VACIOS,
  type CambioConPermanencia, type FiltrosDelHistorial,
} from "@/lib/mantenimiento/historialDeSectores";

/**
 * Los mismos tres estados y los mismos colores que las tarjetas del tablero.
 *
 * Van por `style` y no por clases de Tailwind al lado de `.card`/`.btn-*`,
 * que es la regla de `globals.css`: una utilidad de color junto a una de esas
 * clases no gana nunca y se pinta gris sin avisar.
 */
const ESTADO: Record<string, { label: string; color: string; fondo: string; borde: string }> = {
  ACTIVA:        { label: "Activa",        color: "var(--status-op)",  fondo: "#F0FDF4", borde: "#BBF7D0" },
  PARADA:        { label: "Parada",        color: "var(--status-rep)", fondo: "#FEF2F2", borde: "#FECACA" },
  EN_REPARACION: { label: "En reparación", color: "var(--status-st)",  fondo: "#FFFBEB", borde: "#FDE68A" },
};

const OPCIONES_DE_ESTADO: [string, string][] = Object.entries(ESTADO)
  .map(([valor, { label }]) => [valor, label]);

/** Una fecha con su hora, en Argentina, que es donde se paró la planta. */
const cuando = (iso: string) =>
  new Date(iso).toLocaleString("es-AR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
    timeZone: "America/Argentina/Buenos_Aires",
  });

function Chapita({ estado }: { estado: string | null }) {
  if (!estado) return <span className="text-slate-300">—</span>;
  const meta = ESTADO[estado];
  if (!meta) return <span className="text-slate-500">{estado}</span>;
  return (
    <span
      className="inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold"
      style={{ color: meta.color, background: meta.fondo, borderColor: meta.borde }}
    >
      {meta.label}
    </span>
  );
}

export default function HistorialDeSectoresClient({ cambios, sectores }: {
  cambios: CambioConPermanencia[];
  sectores: { id: string; nombre: string }[];
}) {
  const [f, setF] = useState<FiltrosDelHistorial>(FILTROS_DEL_HISTORIAL_VACIOS);
  const campo = <K extends keyof FiltrosDelHistorial>(k: K, v: FiltrosDelHistorial[K]) =>
    setF((previo) => ({ ...previo, [k]: v }));

  // De la más nueva a la más vieja: la pregunta de todos los días es «qué pasó
  // recién». `conPermanencia` devuelve agrupado por sector, así que el orden
  // de la pantalla se pone acá y no se hereda.
  const visibles = useMemo(
    () =>
      filtrarCambios(cambios, f)
        .sort((a, b) => Date.parse(b.changed_at) - Date.parse(a.changed_at)),
    [cambios, f]
  );

  const resumen = useMemo(() => resumirHistorial(visibles), [visibles]);
  const hayFiltros = hayFiltrosDelHistorial(f);

  const opcionesDeSector: [string, string][] = useMemo(
    () => sectores.map((s) => [s.id, s.nombre]),
    [sectores]
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Historial de sectores</h1>
          <p className="text-sm text-slate-500">
            Cada vez que alguien cambió el estado de un sector: cuándo, de qué estado a
            cuál, por qué y quién.
          </p>
        </div>
        <Link href="/mantenimiento" className="text-sm text-[var(--primary)] hover:underline">
          ← Volver al tablero
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Cambios" value={resumen.cambios} />
        <KpiCard
          label="Paradas"
          value={resumen.paradas}
          color={resumen.paradas > 0 ? "var(--status-rep)" : "var(--status-op)"}
          sub="Pasadas a Parada o En reparación"
        />
        <KpiCard
          label="Fuera de servicio"
          value={resumen.fueraDeServicioMs > 0 ? duracionLegible(resumen.fueraDeServicioMs) : "—"}
          color="var(--status-mant)"
          sub="Sumando lo que sigue abierto"
        />
        <KpiCard label="Sectores" value={resumen.sectores} />
      </div>

      <div className="card space-y-3 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Sector</label>
            <MultiSelect
              valores={f.sectores}
              onCambio={(v) => campo("sectores", v)}
              vacio="Todos los sectores"
              plural="sectores"
              opciones={opcionesDeSector}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Pasó a</label>
            <MultiSelect
              valores={f.estados}
              onCambio={(v) => campo("estados", v)}
              vacio="Cualquier estado"
              plural="estados"
              opciones={OPCIONES_DE_ESTADO}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Desde</label>
            <input type="date" className="input" value={f.desde}
              onChange={(e) => campo("desde", e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Hasta</label>
            <input type="date" className="input" value={f.hasta}
              onChange={(e) => campo("hasta", e.target.value)} />
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <label className="mb-1 block text-xs font-medium text-slate-600">Buscar</label>
            <input
              type="text" className="input"
              placeholder="Motivo, sector o quién lo hizo..."
              value={f.texto}
              onChange={(e) => campo("texto", e.target.value)}
            />
          </div>
          {hayFiltros && (
            <button className="btn-secondary" onClick={() => setF(FILTROS_DEL_HISTORIAL_VACIOS)}>
              Limpiar
            </button>
          )}
        </div>
      </div>

      {visibles.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-400">
          {cambios.length === 0
            ? "Todavía no se cambió el estado de ningún sector. Se registra solo cuando alguien usa «Cambiar estado» en el tablero."
            : hayFiltros
              ? "Ningún cambio con esos filtros."
              : "Ningún cambio."}
        </p>
      ) : (
        /* El contenedor con scroll no es decorativo: sin él la tabla no entra
           en los 343 px útiles de un teléfono, que es desde donde se mira
           media planta. */
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Cuándo</th>
                <th className="px-4 py-2 font-medium">Sector</th>
                <th className="px-4 py-2 font-medium">De</th>
                <th className="px-4 py-2 font-medium">A</th>
                <th className="px-4 py-2 font-medium">Duró</th>
                <th className="px-4 py-2 font-medium">Motivo</th>
                <th className="px-4 py-2 font-medium">Quién</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((c, i) => (
                <tr key={c.id} className={i < visibles.length - 1 ? "border-b border-slate-100" : ""}>
                  <td className="whitespace-nowrap px-4 py-2 text-slate-700">{cuando(c.changed_at)}</td>
                  {/* Que el sector ya no esté lo dice `sector_id` en null y no
                      el nombre, que sigue estando: lo guardó el trigger el día
                      del cambio. Por eso el nombre se muestra igual y lo que se
                      agrega es la aclaración. */}
                  <td className="px-4 py-2 font-medium text-slate-900">
                    {c.sector ?? <span className="italic text-slate-400">sin nombre</span>}
                    {c.sector_id === null && (
                      <span
                        className="ml-1.5 whitespace-nowrap text-xs font-normal italic text-slate-400"
                        title="El sector se borró o se unificó. El nombre es el que tenía el día del cambio."
                      >
                        (dado de baja)
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2"><Chapita estado={c.old_status} /></td>
                  <td className="px-4 py-2"><Chapita estado={c.new_status} /></td>
                  {/* Un estado abierto no «duró»: lleva. Decir «duró 3 días» de
                      algo que sigue pasando lo da por terminado. */}
                  <td className="whitespace-nowrap px-4 py-2 text-slate-600">
                    {c.hasta === null
                      ? <span title="Sigue en este estado">hace {duracionLegible(c.duracionMs)}</span>
                      : duracionLegible(c.duracionMs)}
                  </td>
                  <td className="px-4 py-2 text-slate-600">
                    {c.reason?.trim()
                      ? <span className="italic">“{c.reason}”</span>
                      : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-slate-500">{c.autor ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
