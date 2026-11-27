import { partesDeLaCadena } from "@/lib/mantenimiento/reprogramaciones";

/**
 * Todas las fechas que tuvo una orden: las que se corrieron, tachadas, y la que
 * rige hoy, entera y con el año.
 *
 * Las tachadas van en UN solo `<span>` y no una por fecha, para que el tachado
 * se lea como una línea continua.
 *
 * NO lleva `white-space: nowrap` ni recorte, a propósito: con seis fechas o más
 * el renglón se parte en dos y se siguen viendo todas. Una cadena que esconde
 * una fecha es peor que una que ocupa dos renglones.
 */
export default function CadenaDeFechas({ fechas }: { fechas: string[] }) {
  const partes = partesDeLaCadena(fechas);
  if (!partes) return null;
  return (
    <p className="text-xs text-slate-500">
      <span className="font-medium text-slate-400">Reprogramada</span>{" "}
      <span className="line-through text-slate-400">{partes.tachadas.join(" → ")}</span>
      {" → "}
      <span className="font-semibold text-slate-700">{partes.vigente}</span>
    </p>
  );
}
