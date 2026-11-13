"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Select from "@/components/Select";
import { comoSeLee } from "@/lib/core/fechas";
import { caraDeLaVuelta } from "@/lib/mantenimiento/cicloDeOT";

export interface CicloDeLaFicha {
  id: string;
  repeticiones: number;
  desde: string | null;
  vuelta_desde: number | null;
  tareaMadre: string;
  tareaHija: string;
  componente: string;
  periodoDias: number | null;
  /** La OT del ciclo que está esperando, si hay una. */
  viva: { ot_number: number; ciclo_vuelta: number; fecha_ejecucion: string | null } | null;
}

/**
 * El ciclo de órdenes encadenadas de este equipo.
 *
 * ── POR QUÉ DICE TANTO ──────────────────────────────────────────────────────
 *
 * Porque lo que esta pantalla tiene que poder contestar no es «¿hay un ciclo?»
 * sino **«¿por qué el sistema cree lo que cree?»**. Quien pidió esto nombró
 * como su única razón para dejar de confiar «que genere OT sobre martillos que
 * ya se cambiaron», y la defensa contra eso no es un mecanismo invisible: es
 * que la vuelta, la cara y la fecha del último trabajo estén escritas donde
 * alguien que está parado frente a la máquina las pueda desmentir.
 *
 * Por lo mismo, un ciclo sin arrancar lo dice con todas las letras y ofrece
 * cargarlo: uno activo que no hace nada y no explica por qué es indistinguible
 * de uno roto.
 */
export default function CicloDeOT({
  ciclo, puedeEditar,
}: { ciclo: CicloDeLaFicha; puedeEditar: boolean }) {
  const router = useRouter();
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [desde, setDesde] = useState("");
  const [vuelta, setVuelta] = useState("0");

  const arrancado = ciclo.desde !== null && ciclo.vuelta_desde !== null;

  async function pedir(url: string, init: RequestInit) {
    setGuardando(true);
    setError(null);
    const res = await fetch(url, init);
    const body = await res.json().catch(() => ({}));
    setGuardando(false);
    if (!res.ok) { setError(body.error ?? "No se pudo."); return false; }
    router.refresh();
    return true;
  }

  const arrancar = () =>
    pedir(`/api/mantenimiento/ciclos/${ciclo.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ desde, vuelta_desde: Number(vuelta) }),
    });

  const reiniciar = () => {
    const queDice = ciclo.viva && ciclo.viva.ciclo_vuelta > 0
      ? `Se va a suspender la OT ${ciclo.viva.ot_number}, que ya no correspondería. `
      : "";
    if (!confirm(`${queDice}¿Confirmás que ${ciclo.componente.toLowerCase()} se cambiaron hoy?`)) return;
    pedir(`/api/mantenimiento/ciclos/${ciclo.id}/reiniciar`, { method: "POST" });
  };

  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-slate-700">
        Ciclo de órdenes
        <span className="ml-2 text-xs font-normal text-slate-400">
          {ciclo.tareaHija} × {ciclo.repeticiones}, y después {ciclo.tareaMadre.toLowerCase()}
        </span>
      </h2>

      <div className="card space-y-3 px-4 py-3">
        {!arrancado ? (
          <>
            <p className="text-sm text-slate-700">
              Este ciclo <strong>no arrancó</strong>, así que no está generando ninguna orden.
              Para que arranque hace falta saber cuándo fue el último trabajo y en qué
              vuelta quedó — eso no se puede sacar del historial sin adivinar.
            </p>

            {puedeEditar && (
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-44">
                  <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="ciclo-desde">
                    Fecha del último trabajo
                  </label>
                  <input
                    id="ciclo-desde" type="date" value={desde}
                    onChange={(e) => setDesde(e.target.value)} className="input"
                  />
                </div>
                <div className="w-56">
                  <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="ciclo-vuelta">
                    Y qué se hizo
                  </label>
                  <Select
                    id="ciclo-vuelta" value={vuelta}
                    onChange={(e) => setVuelta(e.target.value)} className="input"
                  >
                    <option value="0">{ciclo.tareaMadre}</option>
                    {Array.from({ length: ciclo.repeticiones }, (_, i) => i + 1).map((v) => (
                      <option key={v} value={String(v)}>
                        {ciclo.tareaHija} — a {caraDeLaVuelta(v)} cara ({v} de {ciclo.repeticiones})
                      </option>
                    ))}
                  </Select>
                </div>
                <button onClick={arrancar} disabled={guardando || !desde} className="btn-primary">
                  Arrancar el ciclo
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <dt className="text-xs text-slate-500">Último trabajo</dt>
                <dd className="text-sm font-medium text-slate-800">
                  {ciclo.vuelta_desde === 0
                    ? ciclo.tareaMadre
                    : `${ciclo.tareaHija} — a ${caraDeLaVuelta(ciclo.vuelta_desde!)} cara`}
                </dd>
                <dd className="text-xs text-slate-500">el {comoSeLee(ciclo.desde!)}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Vuelta</dt>
                <dd className="text-sm font-medium text-slate-800">
                  {ciclo.vuelta_desde} de {ciclo.repeticiones}
                </dd>
                <dd className="text-xs text-slate-500">
                  {ciclo.periodoDias ? `una cada ${ciclo.periodoDias} días` : "sin período cargado"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Orden esperando</dt>
                {ciclo.viva ? (
                  <>
                    <dd className="text-sm font-medium text-slate-800">OT {ciclo.viva.ot_number}</dd>
                    <dd className="text-xs text-slate-500">
                      {ciclo.viva.fecha_ejecucion
                        ? `para el ${comoSeLee(ciclo.viva.fecha_ejecucion)}`
                        : "sin fecha"}
                    </dd>
                  </>
                ) : (
                  <dd className="text-sm text-slate-500">Ninguna todavía</dd>
                )}
              </div>
            </dl>

            {!ciclo.periodoDias && (
              <p className="text-xs text-amber-700">
                La tarea «{ciclo.tareaHija}» no dice cada cuántos días, así que el ciclo no
                puede calcular la fecha de la orden siguiente y está detenido.
              </p>
            )}

            {puedeEditar && (
              <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3">
                <button onClick={reiniciar} disabled={guardando} className="btn-secondary">
                  Se cambiaron {ciclo.componente.toLowerCase()}
                </button>
                <span className="text-xs text-slate-500">
                  Si se cambiaron antes de tiempo, esto reinicia el ciclo al día de hoy.
                </span>
              </div>
            )}
          </>
        )}

        {error && <p className="text-xs text-red-700">{error}</p>}
      </div>
    </section>
  );
}
