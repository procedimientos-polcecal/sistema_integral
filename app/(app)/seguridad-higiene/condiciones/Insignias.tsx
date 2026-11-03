import type { Clasificacion } from "@/lib/seguridadHigiene/riesgo";
import type { Estado, Falta } from "@/lib/seguridadHigiene/condicion";
import { NOMBRE_DE_CLASIFICACION, NOMBRE_DE_FALTA } from "@/lib/seguridadHigiene/gestion";

/**
 * Las marcas de color de la tabla y de la ficha: el estado, lo que falta y la
 * clasificación del riesgo. Están juntas para que la tabla y la ficha no
 * puedan pintar distinto lo mismo.
 */

const BASE = "inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold";

const COLOR_DE_ESTADO: Record<Estado, string> = {
  Pendiente: "bg-slate-100 text-slate-700",
  Vencida: "bg-red-100 text-red-800",
  Cerrada: "bg-emerald-100 text-emerald-800",
};

export function InsigniaDeEstado({ estado }: { estado: Estado }) {
  return <span className={`${BASE} ${COLOR_DE_ESTADO[estado]}`}>{estado}</span>;
}

/**
 * Ámbar y con un texto que dice qué falta: «Sin evaluar» es una acción para
 * alguien, no un adorno. Es lo que la planilla de origen no mostraba.
 */
export function InsigniaDeFalta({ falta }: { falta: Falta }) {
  return <span className={`${BASE} bg-amber-100 text-amber-800`}>{NOMBRE_DE_FALTA[falta]}</span>;
}

const COLOR_DE_CLASIFICACION: Record<Clasificacion, string> = {
  I: "bg-red-600 text-white",
  S: "bg-orange-500 text-white",
  M: "bg-amber-300 text-amber-900",
  PS: "bg-lime-200 text-lime-900",
  NS: "bg-emerald-100 text-emerald-800",
};

/** La sigla sola (I, S, M, PS, NS), o con su nombre completo cuando hay lugar. */
export function InsigniaDeClasificacion({
  clasificacion,
  conNombre = false,
}: {
  clasificacion: Clasificacion;
  conNombre?: boolean;
}) {
  return (
    <span
      className={`${BASE} ${COLOR_DE_CLASIFICACION[clasificacion]}`}
      title={NOMBRE_DE_CLASIFICACION[clasificacion]}
    >
      {conNombre ? `${clasificacion} · ${NOMBRE_DE_CLASIFICACION[clasificacion]}` : clasificacion}
    </span>
  );
}
