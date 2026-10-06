import Link from "next/link";
import type { ProblemaDeCarga, TipoDeProblemaDeCarga } from "@/lib/tallerVial/tablero";

const ETIQUETA: Record<TipoDeProblemaDeCarga, string> = {
  FECHA_DUDOSA: "Fecha imposible",
  SIN_EQUIPO: "Sin equipo",
  LECTURA_MENOR: "Lectura baja",
  LECTURA_MAYOR: "Lectura alta",
};

/** "2026-09-28" → "28/09/2026". La fecha imposible se muestra tal cual: es justo el error. */
function fechaCorta(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

/**
 * Las cargas con un dato que no cuadra, para corregirlas antes de que ensucien
 * los consumos. Se corrigen en la planilla (de ahí vienen): al actualizar, el
 * SdG las trae bien. No se muestra si no hay nada.
 */
export default function CargasParaRevisar({ problemas }: { problemas: ProblemaDeCarga[] }) {
  if (problemas.length === 0) return null;

  const visibles = problemas.slice(0, 5);
  const resto = problemas.slice(5);

  const fila = (p: ProblemaDeCarga) => (
    <li key={`${p.tipo}-${p.cargaId}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2 text-sm">
      <span className="w-24 shrink-0 text-xs font-semibold text-amber-700">{ETIQUETA[p.tipo]}</span>
      <span className="w-24 shrink-0 font-mono text-xs tabular-nums text-slate-500">{fechaCorta(p.fecha)}</span>
      <span className="min-w-0 flex-1 text-slate-700">
        <span className="font-medium">{p.equipoRaw}</span> — {p.detalle}
      </span>
    </li>
  );

  return (
    <section className="card mt-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold text-slate-900">Cargas para revisar ({problemas.length})</h2>
        <Link href="/taller-vial/cargas" className="text-xs text-slate-500 underline">Ver cargas →</Link>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Datos que no cuadran. Se corrigen en la planilla y se ven bien después de &ldquo;Actualizar&rdquo;.
      </p>
      <ul className="mt-2 divide-y divide-slate-100">{visibles.map(fila)}</ul>
      {resto.length > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer text-xs text-slate-500 underline">Ver las otras {resto.length}</summary>
          <ul className="divide-y divide-slate-100">{resto.map(fila)}</ul>
        </details>
      )}
    </section>
  );
}
