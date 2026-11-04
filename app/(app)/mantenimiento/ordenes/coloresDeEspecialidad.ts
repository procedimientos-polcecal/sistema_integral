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

/** El gris de una especialidad vacía o que no tiene color propio. */
export const COLOR_SIN_ESPECIALIDAD = "#6b7280";

/**
 * El color de una especialidad, comparada sin tilde ni mayúsculas porque la
 * celda de la planilla trae `Lubricacion` tanto como `LUBRICACIÓN`.
 */
export function colorDeEspecialidad(especialidad: string | null | undefined): string {
  const clave = norm(especialidad) as keyof typeof COLORES_DE_ESPECIALIDAD;
  return COLORES_DE_ESPECIALIDAD[clave] ?? COLOR_SIN_ESPECIALIDAD;
}

/** Para la leyenda: nombre como se lee y su color. */
export const LEYENDA_DE_ESPECIALIDADES: { nombre: string; color: string }[] = [
  { nombre: "Mecánico", color: COLORES_DE_ESPECIALIDAD.MECANICO },
  { nombre: "Eléctrico", color: COLORES_DE_ESPECIALIDAD.ELECTRICO },
  { nombre: "Civil", color: COLORES_DE_ESPECIALIDAD.CIVIL },
  { nombre: "Lubricación", color: COLORES_DE_ESPECIALIDAD.LUBRICACION },
  { nombre: "Otra o vacía", color: COLOR_SIN_ESPECIALIDAD },
];
