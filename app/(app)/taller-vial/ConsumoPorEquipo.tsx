import Link from "next/link";
import type { EquipoTallerVial } from "@/lib/tallerVial/consultas";
import { ETIQUETA_UNIDAD, unidadDeUso } from "@/lib/tallerVial/equipos";
import { barraDeConsumo, type NivelDeConsumo } from "@/lib/tallerVial/tablero";

const num1 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });
const num0 = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 });

export interface FilaDeConsumo {
  equipo: EquipoTallerVial;
  cargas: number;
  litrosTotal: number;
  trabajadoTotal: number | null;
  consumoPromedio: number | null;
  /** El promedio de los meses anteriores del mismo equipo. */
  referencia: number | null;
}

const COLOR_BARRA: Record<NivelDeConsumo, string> = { NORMAL: "bg-emerald-500", ATENCION: "bg-amber-500", ALTO: "bg-red-500" };
const COLOR_TEXTO: Record<NivelDeConsumo, string> = { NORMAL: "text-emerald-700", ATENCION: "text-amber-700", ALTO: "text-red-600" };

/**
 * El consumo del mes de cada equipo contra su propio promedio. La barra llena
 * hasta la raya vertical es "como siempre"; pasada la raya, consume de más.
 * Se compara contra uno mismo y no entre equipos: una excavadora (L/hs) y un
 * camión (L/km) no se miden con la misma regla.
 */
export default function ConsumoPorEquipo({ filas }: { filas: FilaDeConsumo[] }) {
  return (
    <section className="card mt-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-slate-900">Consumo del mes, por equipo</h2>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span className="flex items-center gap-1"><span className="inline-block h-3 w-px bg-slate-700" /> Su promedio de meses anteriores</span>
          <Link href="/taller-vial/cargas" className="underline">Ver cargas →</Link>
        </div>
      </div>
      {filas.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400">Todavía no hay cargas este mes.</p>
      ) : (
        <div className="mt-4 space-y-4">
          {filas.map((f) => {
            const unidad = ETIQUETA_UNIDAD[unidadDeUso(f.equipo.code)];
            const barra = barraDeConsumo(f.consumoPromedio, f.referencia);
            return (
              <div key={f.equipo.id}>
                <div className="flex items-center gap-3">
                  <span className="w-40 shrink-0 truncate text-sm font-medium text-slate-700">{f.equipo.code} - {f.equipo.name}</span>
                  <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full ${barra.nivel ? COLOR_BARRA[barra.nivel] : "bg-slate-400"}`}
                      style={{ width: `${barra.anchoPct}%` }}
                    />
                    {barra.marcaPct !== null && (
                      <div className="absolute inset-y-0 w-px bg-slate-700" style={{ left: `${barra.marcaPct}%` }} />
                    )}
                  </div>
                  <span className={`w-28 shrink-0 text-right text-xs font-semibold tabular-nums ${barra.nivel ? COLOR_TEXTO[barra.nivel] : "text-slate-500"}`}>
                    {f.consumoPromedio !== null ? `${num1.format(f.consumoPromedio)} L/${unidad}` : "—"}
                    {barra.desvioPct !== null && barra.desvioPct !== 0 && (
                      <span className="font-normal"> ({barra.desvioPct > 0 ? "+" : ""}{barra.desvioPct}%)</span>
                    )}
                  </span>
                </div>
                <p className="mt-0.5 pl-[172px] text-[11px] text-slate-400">
                  {num0.format(f.litrosTotal)} L en {f.cargas} carga{f.cargas === 1 ? "" : "s"}
                  {f.trabajadoTotal !== null && ` · ${num1.format(f.trabajadoTotal)} ${unidad} trabajadas`}
                  {f.referencia !== null && ` · antes: ${num1.format(f.referencia)} L/${unidad}`}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
