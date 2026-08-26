"use client";

import { useEffect, useState } from "react";
import { URGENCIAS } from "@/lib/mantenimiento/avisos";

/**
 * Cargar un aviso: alguien vio que algo anda mal.
 *
 * Es el primer eslabón del módulo y hasta ahora sólo se podía hacer abriendo la
 * planilla. El número se lo pone el sistema leyendo el último de la planilla.
 */
export default function NuevoAvisoModal({
  onCerrar, onCreado,
}: {
  onCerrar: () => void;
  onCreado: (oaNumber: string) => void;
}) {
  const [equipos, setEquipos] = useState<{ id: string; code: string | null; name: string; sector_id: string | null }[]>([]);
  const [sectores, setSectores] = useState<{ id: string; nombre: string; codigo: string | null }[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const [campos, setCampos] = useState({
    equipo_raw: "",
    sector_raw: "",
    sector_id: "",
    descripcion: "",
    urgencia: URGENCIAS[1] as string,
    quien_aviso: "",
    observaciones: "",
  });

  const set = (clave: string, valor: string) => setCampos((c) => ({ ...c, [clave]: valor }));

  useEffect(() => {
    // Las mismas listas que usa el resto del módulo: elegir la máquina de un
    // desplegable es lo que hace que el aviso quede enlazada a ella.
    fetch("/api/mantenimiento/equipos-y-sectores")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) { setEquipos(d.equipos ?? []); setSectores(d.sectores ?? []); } })
      .catch(() => {});
  }, []);

  /** Al elegir el equipo se completa el sector: la máquina sabe dónde está. */
  function elegirEquipo(id: string) {
    const equipo = equipos.find((e) => e.id === id);
    if (!equipo) { set("equipo_raw", ""); return; }

    setCampos((c) => ({
      ...c,
      equipo_raw: `${equipo.code ?? ""} ${equipo.name}`.trim(),
      sector_id: equipo.sector_id ?? c.sector_id,
      sector_raw: sectores.find((s) => s.id === equipo.sector_id)?.nombre ?? c.sector_raw,
    }));
  }

  async function crear() {
    if (!campos.descripcion.trim()) { setError("Contá qué pasa."); return; }
    setGuardando(true);
    setError("");

    const res = await fetch("/api/mantenimiento/avisos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...campos, sector_id: campos.sector_id || null }),
    });
    const body = await res.json().catch(() => ({}));
    setGuardando(false);

    if (!res.ok) { setError(body.error ?? "No se pudo cargar el aviso."); return; }
    onCreado(body.oa_number);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 md:items-center" onClick={onCerrar}>
      <div
        className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 className="text-base font-bold text-slate-900">Nuevo aviso</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            El número se lo pone el sistema, siguiendo el último de la planilla.
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
        )}

        <label className="block space-y-1">
          <span className="block text-xs font-medium text-slate-600">Qué pasa</span>
          <textarea
            value={campos.descripcion}
            onChange={(e) => set("descripcion", e.target.value)}
            rows={2}
            placeholder="Pierde aceite por el retén del reductor"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="block text-xs font-medium text-slate-600">Equipo</span>
            <select
              onChange={(e) => elegirEquipo(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Sin equipo</option>
              {equipos.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.code ? `${e.code} — ` : ""}{e.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1">
            <span className="block text-xs font-medium text-slate-600">Sector</span>
            <select
              value={campos.sector_id}
              onChange={(e) => {
                set("sector_id", e.target.value);
                set("sector_raw", sectores.find((s) => s.id === e.target.value)?.nombre ?? "");
              }}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Sin sector</option>
              {sectores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.codigo ? `${s.codigo} — ` : ""}{s.nombre}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1">
            <span className="block text-xs font-medium text-slate-600">Urgencia</span>
            <select
              value={campos.urgencia}
              onChange={(e) => set("urgencia", e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {URGENCIAS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </label>

          <label className="block space-y-1">
            <span className="block text-xs font-medium text-slate-600">Quién avisa</span>
            <input
              value={campos.quien_aviso}
              onChange={(e) => set("quien_aviso", e.target.value)}
              placeholder="Tu nombre"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </label>
        </div>

        <label className="block space-y-1">
          <span className="block text-xs font-medium text-slate-600">Observaciones</span>
          <input
            value={campos.observaciones}
            onChange={(e) => set("observaciones", e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </label>

        <p className="text-xs text-slate-500">
          Se escribe primero en la planilla de avisos, que es la base, y después acá.
        </p>

        <div className="flex gap-2 pt-1">
          <button
            onClick={crear}
            disabled={guardando}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {guardando ? "Cargando…" : "Cargar el aviso"}
          </button>
          <button
            onClick={onCerrar}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
