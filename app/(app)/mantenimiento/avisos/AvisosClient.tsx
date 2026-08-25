"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { fecha } from "@/lib/compras/constants";
import type { Aviso } from "@/lib/mantenimiento/types";

/**
 * Los avisos: lo que alguien reportó que necesita mantenimiento.
 *
 * La planilla manda — acá es un espejo — así que la pantalla es de consulta y
 * un botón para volver a traerla. Lo que se hace con un aviso es generarle una
 * orden de trabajo, que viene después.
 */
export default function AvisosClient({
  avisos, puedeEditar,
}: {
  avisos: Aviso[];
  puedeEditar: boolean;
}) {
  const router = useRouter();
  const [busqueda, setBusqueda] = useState("");
  const [urgencia, setUrgencia] = useState("");
  const [soloSinOt, setSoloSinOt] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [error, setError] = useState("");
  const [resultado, setResultado] = useState<string | null>(null);

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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Avisos</h1>
          <p className="text-sm text-slate-500">
            {visibles.length === avisos.length
              ? `${avisos.length} aviso${avisos.length === 1 ? "" : "s"}`
              : `${visibles.length} de ${avisos.length}`}
            {" · "}
            {avisos.filter((a) => !tieneOt(a)).length} sin orden de trabajo
          </p>
        </div>

        {puedeEditar && (
          <button
            onClick={sincronizar}
            disabled={sincronizando}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {sincronizando ? "Trayendo…" : "Traer de la planilla"}
          </button>
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
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
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
                      <span className="text-xs text-slate-500">{a.ot_asignada ?? "sí"}</span>
                    ) : (
                      <span className="text-xs text-amber-700">pendiente</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
