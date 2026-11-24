import { norm } from "@/lib/core/texto";

/**
 * El color de cada especialidad en el calendario de órdenes.
 *
 * Van por `style` y no por una clase de utilidad, que es lo que ya hacen los
 * badges de Mantenimiento: una utilidad de color al lado de `.card` o `.btn-*`
 * pierde contra la regla sin capa de `globals.css`, y nada avisa.
 *
 * Son cuatro colores y un gris. INSTRUMENTACIÓN y OTRO no tienen color propio y
 * caen en el gris, igual que una celda vacía: pintarlas con el color del que se
 * les parece sería decir una especialidad que la orden no dice.
 *
 * **Ojo con lo que dicen los datos:** de las 21 órdenes abiertas de noviembre,
 * veinte son MECÁNICO y una es CIVIL, así que el mes sale casi de un solo color.
 * Lo que distingue un día de otro es *cuántas* órdenes tiene y no de qué
 * especialidad: por eso el calendario muestra la cuenta aparte y no depende del
 * tono para contarla.
 */
export const COLORES_DE_ESPECIALIDAD = {
  MECANICO: "#d97706",
  ELECTRICO: "#2563eb",
  CIVIL: "#16a34a",
  LUBRICACION: "#9333ea",
} as const;

/**
 * El color del texto que va **sobre** el relleno de cada especialidad.
 *
 * El relleno no se toca —son los cuatro que se eligieron—, pero blanco sobre
 * ámbar da ~3,2:1 y sobre verde ~3,3:1, y el número de OT a 10 px es el contenido
 * de la ficha, no un adorno. Oscuro sobre ámbar y verde, blanco sobre azul y
 * violeta y sobre el gris: las seis combinaciones quedan por encima de 5:1.
 * El ámbar importa más que ninguno: es el color de veinte de las 21 órdenes
 * abiertas.
 */
export const TEXTO_SOBRE_EL_COLOR: Record<string, string> = {
  [COLORES_DE_ESPECIALIDAD.MECANICO]: "#0f172a",
  [COLORES_DE_ESPECIALIDAD.CIVIL]: "#0f172a",
  [COLORES_DE_ESPECIALIDAD.ELECTRICO]: "#ffffff",
  [COLORES_DE_ESPECIALIDAD.LUBRICACION]: "#ffffff",
};

/** El gris de una especialidad vacía o que no tiene color propio. */
export const COLOR_SIN_ESPECIALIDAD = "#6b7280";

/**
 * El rojo de una orden atrasada, y el texto que va sobre él.
 *
 * **Va de relleno y no de franja encima del color de la especialidad**, y no es
 * una preferencia: medido, este rojo contra los cinco rellenos da de 1,20:1 a
 * 2,03:1 (el ámbar es el más cercano), por debajo del 3:1 que WCAG pide para
 * algo que no es texto: una franja o un borde rojo encima no se distingue. De relleno con texto blanco da 6,47:1. La especialidad queda en el borde.
 *
 * No está en `LEYENDA_DE_ESPECIALIDADES` a propósito: esa lista es de
 * especialidades —un test exige que todo color sea un relleno de especialidad o
 * el gris— y «atrasada» es un estado, no una especialidad. La pantalla dibuja su
 * propio recuadro al lado.
 */
export const COLOR_ATRASADA = "#b91c1c";
export const TEXTO_SOBRE_ATRASADA = "#ffffff";

/**
 * El color de una especialidad, comparada sin tilde ni mayúsculas porque la
 * celda de la planilla trae `Lubricacion` tanto como `LUBRICACIÓN`.
 */
export function colorDeEspecialidad(especialidad: string | null | undefined): string {
  const clave = norm(especialidad) as keyof typeof COLORES_DE_ESPECIALIDAD;
  return COLORES_DE_ESPECIALIDAD[clave] ?? COLOR_SIN_ESPECIALIDAD;
}

/** El texto legible sobre el relleno de esa especialidad (el blanco de siempre sobre el gris). */
export function textoSobreLaEspecialidad(especialidad: string | null | undefined): string {
  return TEXTO_SOBRE_EL_COLOR[colorDeEspecialidad(especialidad)] ?? "#ffffff";
}

/** Lo que decide cómo se pinta una ficha del calendario. */
export interface FichaDelCalendario {
  especialidad: string | null;
  /** Si la orden está atrasada: lo decide `estaAtrasada` de `lib/mantenimiento/alertas.ts`. */
  atrasada: boolean;
  /** Si este día es parte de la ventana de la orden y no su inicio. */
  arrastre: boolean;
}

/** Los tres colores de una ficha, tal como van al `style` del elemento. */
export interface EstiloDeFicha {
  background: string;
  color: string;
  border: string;
}

/**
 * Cómo se pinta una ficha, en las cuatro combinaciones de (atrasada, arrastre).
 *
 * **Está acá y no adentro del JSX a propósito.** Era un ternario anidado de
 * cuatro ramas en `CalendarioDeOT.tsx`, y ahí no lo miraba nadie: el calendario
 * es un componente de cliente que trae sus datos en un `useEffect`, así que
 * renderizarlo en un test da el estado vacío y ni una ficha. O sea que el rojo
 * —que es todo el punto de la función— no tenía forma de comprobarse sin un
 * navegador, y detrás del login no hay navegador. Sacada acá es una función
 * pura y se prueba como todo lo demás de esta casa.
 *
 * Las reglas, con su porqué medido en `COLOR_ATRASADA` y en
 * `TEXTO_SOBRE_EL_COLOR`:
 *
 * - **Atrasada manda sobre la especialidad**, y va de relleno: encima del
 *   relleno de especialidad el rojo no se distingue (de 1,20:1 a 2,03:1, bajo
 *   el 3:1 de WCAG). La especialidad se corre al borde, que es lo que hace que
 *   no se pierda.
 * - **El arrastre va hueco** —fondo blanco y borde punteado—, porque un día
 *   que la orden sólo ocupa no es el día en que arranca.
 * - **Atrasada y arrastre a la vez**: hueca, pero el rojo pasa al borde y al
 *   número. Ahí la especialidad sí se pierde, y es la única de las cuatro donde
 *   pasa: entre decir «esta orden está atrasada» y decir de qué especialidad
 *   es, en un día de arrastre gana lo primero.
 * - **Normal**: relleno de especialidad, con el texto que `TEXTO_SOBRE_EL_COLOR`
 *   elige para que el número se lea a 10 px.
 */
export function estiloDeLaFicha(o: FichaDelCalendario): EstiloDeFicha {
  const color = colorDeEspecialidad(o.especialidad);

  if (o.atrasada && o.arrastre) {
    return {
      background: "#ffffff",
      color: COLOR_ATRASADA,
      border: `1.5px dashed ${COLOR_ATRASADA}`,
    };
  }
  if (o.atrasada) {
    return {
      background: COLOR_ATRASADA,
      color: TEXTO_SOBRE_ATRASADA,
      border: `1.5px solid ${color}`,
    };
  }
  if (o.arrastre) {
    // El número va oscuro y no del color: el ámbar y el verde sobre blanco no
    // se leen a 10 px.
    return { background: "#ffffff", color: "#0f172a", border: `1.5px dashed ${color}` };
  }
  return {
    background: color,
    color: textoSobreLaEspecialidad(o.especialidad),
    border: `1.5px solid ${color}`,
  };
}

/** Para la leyenda: nombre como se lee y su color. */
export const LEYENDA_DE_ESPECIALIDADES: { nombre: string; color: string }[] = [
  { nombre: "Mecánico", color: COLORES_DE_ESPECIALIDAD.MECANICO },
  { nombre: "Eléctrico", color: COLORES_DE_ESPECIALIDAD.ELECTRICO },
  { nombre: "Civil", color: COLORES_DE_ESPECIALIDAD.CIVIL },
  { nombre: "Lubricación", color: COLORES_DE_ESPECIALIDAD.LUBRICACION },
  { nombre: "Otra o vacía", color: COLOR_SIN_ESPECIALIDAD },
];
