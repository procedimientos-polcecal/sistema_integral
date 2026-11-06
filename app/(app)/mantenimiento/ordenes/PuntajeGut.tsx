import { bandaDeGut, puntajeGut, type NotasGut } from "@/lib/mantenimiento/gut";

/**
 * El recuadro del puntaje GUT: el número, y nada más. Al pasar por encima dice
 * las tres notas (`G4 · U5 · T4`). Una orden sin las tres notas muestra una
 * raya, no un número: no hay nada medido, y esa raya es lo que después alimenta
 * la sugerencia de las pendientes sin puntuar.
 *
 * NO LLEVA PALABRA
 *
 * "Alta", "media" y "baja" ya son la columna `prioridad` de la planilla, que se
 * sigue mostrando en los filtros y en el detalle. Dos escalas con las mismas
 * tres palabras en la misma fila es cómo se lee una y se decide por la otra. El
 * número no se confunde con nada.
 *
 * UN SOLO TONO, EN CINCO INTENSIDADES
 *
 * Violeta, y a propósito: las pastillas de estado de la misma fila ya son rojo
 * (atrasado), azul (en proceso), ámbar (por hacer) y verde (realizado), y el
 * material de origen pinta las bandas con ese mismo semáforo. Un GUT bajo en
 * verde al lado de un verde que quiere decir "terminado" metería la confusión
 * por el color después de haberla cerrado en las palabras. Violeta no es ninguno
 * de los cuatro ni el gris de "Todos", y en esta pantalla no lo usa nadie más.
 * Va de un lavanda casi blanco (banda 1) a un violeta casi negro (banda 5), así
 * que se lee como un volumen y no como un estado. Cambiar el tono es cambiar
 * esta tabla y nada más, pero que no sea ninguno de esos cuatro.
 */
const INTENSIDADES = {
  1: { fondo: "#F5F3FF", texto: "#6D28D9", borde: "#DDD6FE" },
  2: { fondo: "#EDE9FE", texto: "#5B21B6", borde: "#C4B5FD" },
  3: { fondo: "#C4B5FD", texto: "#3B0764", borde: "#A78BFA" },
  4: { fondo: "#7C3AED", texto: "#FFFFFF", borde: "#6D28D9" },
  5: { fondo: "#4C1D95", texto: "#FFFFFF", borde: "#3B0764" },
} as const;

/** `G4 · U5 · T4`, con una raya en la nota que falta. */
function notasEnLetras(orden: NotasGut): string {
  const n = (v: number | null | undefined) => (v == null ? "—" : String(v));
  return `G${n(orden.gut_gravedad)} · U${n(orden.gut_urgencia)} · T${n(orden.gut_tendencia)}`;
}

/**
 * `pista` es lo que pasa al hacer clic, cuando el recuadro es un atajo para
 * puntuar. Va dentro del `title` del propio recuadro y no en el del envoltorio:
 * el `title` más cercano al puntero es el único que se muestra, así que uno
 * puesto afuera nunca se vería.
 */
export default function PuntajeGut({ orden, pista }: { orden: NotasGut; pista?: string }) {
  const puntaje = puntajeGut(orden);
  const conPista = (texto: string) => (pista ? `${texto} · ${pista}` : texto);

  if (puntaje === null) {
    // Con una o dos notas se guardan pero no hay puntaje: se dice cuáles hay.
    const hayAlguna =
      orden.gut_gravedad != null || orden.gut_urgencia != null || orden.gut_tendencia != null;
    return (
      <span
        title={conPista(hayAlguna ? `Incompleto: ${notasEnLetras(orden)}` : "Sin puntaje")}
        aria-label={hayAlguna ? `Puntaje incompleto, ${notasEnLetras(orden)}` : "Sin puntaje"}
        className="inline-flex h-6 min-w-[2rem] shrink-0 items-center justify-center rounded-md border border-slate-200 px-1.5 text-xs font-semibold text-slate-400"
      >
        —
      </span>
    );
  }

  const tono = INTENSIDADES[bandaDeGut(puntaje)];
  return (
    <span
      title={conPista(notasEnLetras(orden))}
      aria-label={`Puntaje ${puntaje}, ${notasEnLetras(orden)}`}
      className="inline-flex h-6 min-w-[2rem] shrink-0 items-center justify-center rounded-md border px-1.5 text-xs font-bold tabular-nums"
      style={{ background: tono.fondo, color: tono.texto, borderColor: tono.borde }}
    >
      {puntaje}
    </span>
  );
}
