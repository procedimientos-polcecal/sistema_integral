"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { fecha } from "@/lib/compras/constants";
import UltimaSincronizacion from "@/components/UltimaSincronizacion";
import type { UltimaSync } from "@/lib/core/sincronizaciones";
import { prioridadDeUrgencia } from "@/lib/mantenimiento/avisos";
import type { Aviso } from "@/lib/mantenimiento/types";
import NuevoAvisoModal from "./NuevoAvisoModal";

/**
 * Los avisos: lo que alguien reportó que necesita mantenimiento.
 *
 * Es el primer eslabón del módulo. De acá salen las órdenes de trabajo, y por
 * eso lo que importa de la pantalla son los avisos que todavía no tienen una:
 * cada uno es algo que alguien vio y nadie tomó.
 */
export default function AvisosClient({
  avisos, puedeEditar, sync
}: {
  avisos: Aviso[];
  puedeEditar: boolean;
  /** Cuándo se trajo por última vez lo de la planilla. */
  sync: UltimaSync | null;
}) {
  const router = useRouter();
  const [busqueda, setBusqueda] = useState("");
  const [urgencia, setUrgencia] = useState("");
  const [soloSinOt, setSoloSinOt] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [error, setError] = useState("");
  const [resultado, setResultado] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);
  const [generando, setGenerando] = useState<string | null>(null);

  /** Un aviso tiene OT si la app la generó o si la planilla dice que sí. */
  const tieneOt = (a: Aviso) => Boolean(a.work_order_id) || Boolean(a.ot_asignada);

  // La urgencia viene con emoji desde la planilla —"🔴 Alta"—, así que las
  // opciones salen de los datos y no de una lista fija que quedaría corta.
  const urgencias = useMemo(
    () => [...new Set(avisos.map((a) => a.urgencia).filter((u): u is string => Boolean(u)))].sort(),
    [avisos]
  );

  const visibles = useMemo(() => {
    const q = busqueda.toLowerCase().trim();
    return avisos.filter((a) => {
      if (urgencia && a.urgencia !== urgencia) return false;
      if (soloSinOt && tieneOt(a)) return false;
      if (!q) return true;
      return [a.oa_number, a.descripcion, a.equipo_raw, a.sector_raw, a.quien_aviso]
        .some((v) => v?.toLowerCase().includes(q));
    });
  }, [avisos, busqueda, urgencia, soloSinOt]);

  async function sincronizar() {
    setSincronizando(true);
    setError("");
    setResultado(null);

    const res = await fetch("/api/mantenimiento/avisos/sync", { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setSincronizando(false);

    if (!res.ok) {
      setError(body.error ?? "No se pudo sincronizar.");
      return;
    }
    setResultado(
      `Se leyeron ${body.leidas} filas y se guardaron ${body.guardados} avisos.` +
      (body.sin_equipo > 0
        ? ` ${body.sin_equipo} no se pudieron enlazar a un equipo del sistema.`
        : "")
    );
    router.refresh();
  }

  /**
   * De un aviso sale una orden de trabajo.
   *
   * La OT nace correctiva —alguien reportó una falla, no es un preventivo
   * programado— y con la prioridad que le corresponde a la urgencia del aviso.
   * El aviso queda apuntando a ella para que nadie genere una segunda.
   */
  async function generarOT(aviso: Aviso) {
    setGenerando(aviso.id);
    setError("");
    setResultado(null);

    const res = await fetch("/api/mantenimiento/ordenes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        aviso_id: aviso.id,
        equipment_id: aviso.equipment_id,
        sector_id: aviso.sector_id,
        sector_raw: aviso.sector_raw,
        equipo_raw: aviso.equipo_raw,
        equipo_code: aviso.equipo_code,
        descripcion: aviso.descripcion ?? `Aviso ${aviso.oa_number}`,
        repuesto: aviso.repuesto,
        tipo: "CORRECTIVO",
        estado: "POR_HACER",
        prioridad: prioridadDeUrgencia(aviso.urgencia),
      }),
    });
    const body = await res.json().catch(() => ({}));
    setGenerando(null);

    if (!res.ok) { setError(body.error ?? "No se pudo generar la OT."); return; }

    setResultado(
      [
        `Se generó la OT #${body.ot_number} y el aviso ${aviso.oa_number} quedó marcado.`,
        body.planilla_error && `Ojo: no se pudo escribir en la planilla de OT (${body.planilla_error}).`,
        body.aviso_error && `Ojo: no se pudo marcar el aviso en su planilla (${body.aviso_error}).`,
      ].filter(Boolean).join(" ")
    );
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-baseline gap-x-3">
            <h1 className="text-xl font-bold text-slate-900">Avisos</h1>
            <UltimaSincronizacion
              cuando={sync?.created_at}
              ok={sync?.ok ?? true}
              error={sync?.error}
            />
          </div>
          <p className="text-sm text-slate-500">
            {visibles.length === avisos.length
              ? `${avisos.length} aviso${avisos.length === 1 ? "" : "s"}`
              : `${visibles.length} de ${avisos.length}`}
            {" · "}
            {avisos.filter((a) => !tieneOt(a)).length} sin orden de trabajo
          </p>
        </div>

        {puedeEditar && (
          <div className="flex gap-2">
            <button
              onClick={sincronizar}
              disabled={sincronizando}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {sincronizando ? "Trayendo…" : "Traer de la planilla"}
            </button>
            <button
              onClick={() => setCreando(true)}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Nuevo aviso
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      {resultado && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          {resultado}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por equipo, sector, descripción…"
          className="min-w-56 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <select
          value={urgencia}
          onChange={(e) => setUrgencia(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">Cualquier urgencia</option>
          {urgencias.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
        <label className="flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={soloSinOt}
            onChange={(e) => setSoloSinOt(e.target.checked)}
          />
          Sin orden de trabajo
        </label>
      </div>

      {avisos.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-400">
          Todavía no hay avisos. {puedeEditar && "Traelos de la planilla con el botón de arriba."}
        </p>
      ) : (
        <>
        {/* En un teléfono, tarjetas. Esta es la pantalla que se abre parado
            frente a la máquina, así que el equipo va primero y grande: es el
            dato con el que la persona reconoce si el aviso es el suyo. */}
        <div className="space-y-2 md:hidden">
          {visibles.map((a) => (
            <article key={a.id} className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="mb-1 flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm font-semibold text-slate-900">
                  {a.equipos?.name ?? a.equipo_raw ?? "Sin equipo"}
                </span>
                <span className="font-mono text-[11px] text-slate-400">
                  {a.oa_number ? `OA ${a.oa_number}` : "sin N°"}
                </span>
              </div>

              <p className="text-sm leading-snug text-slate-700">{a.descripcion ?? "—"}</p>

              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
                <span>{a.sectores?.nombre ?? a.sector_raw ?? "Sin sector"}</span>
                {!a.equipment_id && a.equipo_raw && (
                  <span className="text-amber-700">· sin enlazar</span>
                )}
                {a.urgencia && <span>· {a.urgencia}</span>}
                <span>· {fecha(a.fecha)}</span>
                {a.quien_aviso && <span>· avisó {a.quien_aviso}</span>}
              </div>

              <div className="mt-2.5 border-t border-slate-100 pt-2.5">
                {tieneOt(a) ? (
                  <span className="text-xs text-slate-500">
                    {a.ot_asignada ? `OT #${a.ot_asignada}` : "Ya tiene OT"}
                  </span>
                ) : puedeEditar ? (
                  <button
                    onClick={() => generarOT(a)}
                    disabled={generando !== null}
                    className="w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 disabled:opacity-50"
                  >
                    {generando === a.id ? "Generando…" : "Generar OT"}
                  </button>
                ) : (
                  <span className="text-xs text-amber-700">Pendiente de OT</span>
                )}
              </div>
            </article>
          ))}
        </div>

        <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white md:block">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">N° OA</th>
                <th className="px-3 py-2 text-left">Fecha</th>
                <th className="px-3 py-2 text-left">Equipo</th>
                <th className="px-3 py-2 text-left">Qué pasa</th>
                <th className="px-3 py-2 text-left">Urgencia</th>
                <th className="px-3 py-2 text-left">Avisó</th>
                <th className="px-3 py-2 text-left">OT</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibles.map((a) => (
                <tr key={a.id}>
                  <td className="px-3 py-2 font-mono text-xs">{a.oa_number ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-600">{fecha(a.fecha)}</td>
                  <td className="px-3 py-2">
                    <div>{a.equipos?.name ?? a.equipo_raw ?? "—"}</div>
                    <div className="text-xs text-slate-400">
                      {a.sectores?.nombre ?? a.sector_raw ?? ""}
                      {/* Sin equipo enlazado no se puede cruzar con su historial. */}
                      {!a.equipment_id && a.equipo_raw && " · sin enlazar"}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-slate-700">{a.descripcion ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-600">{a.urgencia ?? "—"}</td>
                  <td className="px-3 py-2 text-slate-600">{a.quien_aviso ?? "—"}</td>
                  <td className="px-3 py-2">
                    {tieneOt(a) ? (
                      <span className="text-xs text-slate-500">
                        {a.ot_asignada ? `OT #${a.ot_asignada}` : "sí"}
                      </span>
                    ) : puedeEditar ? (
                      <button
                        onClick={() => generarOT(a)}
                        disabled={generando !== null}
                        className="rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                      >
                        {generando === a.id ? "Generando…" : "Generar OT"}
                      </button>
                    ) : (
                      <span className="text-xs text-amber-700">pendiente</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}

      {creando && (
        <NuevoAvisoModal
          onCerrar={() => setCreando(false)}
          onCreado={(oa) => {
            setCreando(false);
            setResultado(`Se cargó el aviso ${oa}.`);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
