import Link from "next/link";
import type { DisponibilidadDelMes } from "@/lib/tallerVial/tablero";

const NOMBRE_MES = new Intl.DateTimeFormat("es-AR", { month: "short", timeZone: "UTC" });

/** Los mismos cortes del informe mensual: 🔴 <70 · 🟡 70–84 · 🟢 ≥85. */
function colorDe(pct: number): string {
  return pct < 70 ? "bg-red-500" : pct < 85 ? "bg-amber-500" : "bg-emerald-500";
}

/**
 * Qué porcentaje de la flota estuvo operativa, mes a mes: dice si el taller
 * mejora o empeora, que es lo que se quiere saber de un vistazo. Es la misma
 * cuenta del informe mensual (días operativo sobre días registrados).
 */
export default function TendenciaDeDisponibilidad({ meses }: { meses: DisponibilidadDelMes[] }) {
  if (meses.length === 0) return null;

  return (
    <section className="card mt-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-slate-900">Disponibilidad de la flota, mes a mes</h2>
        <Link href="/taller-vial/informes" className="text-xs text-slate-500 underline">Informe mensual →</Link>
      </div>
      <div className="mt-4 flex h-36 items-end gap-2">
        {meses.map((m) => (
          <div key={m.mes} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${m.mes}: ${m.dias} días registrados`}>
            {m.pct !== null ? (
              <>
                <span className="text-[11px] font-semibold tabular-nums text-slate-600">{Math.round(m.pct)}%</span>
                <div className={`w-full max-w-10 rounded-t ${colorDe(m.pct)}`} style={{ height: `${Math.max(2, m.pct) * 0.85}%` }} />
              </>
            ) : (
              <span className="text-[11px] text-slate-300">—</span>
            )}
            <span className="text-[11px] capitalize text-slate-500">{NOMBRE_MES.format(new Date(`${m.mes}-01T00:00:00Z`)).replace(".", "")}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-slate-400">
        Días operativos sobre días con estado cargado. Verde desde 85%, ámbar de 70 a 84%, rojo debajo de 70%. El último mes puede estar incompleto.
      </p>
    </section>
  );
}
