import { z } from "zod";
import { esquemaDeCondicion } from "./cuerpoDeCondicion";

/**
 * Lo que acepta el PATCH de una condición insegura, y quién puede mandar qué.
 *
 * **Dos permisos en la misma ruta, porque la spec los separó.** `edicion` corrige
 * la primera etapa (lugar, descripción, peligro, acción, prioridad); `admin`
 * además evalúa, asigna, cierra y reabre. La base ya lo hace cumplir con el
 * trigger `syh_condiciones_proteger_gestion`, que rechaza con 42501 a un
 * `edicion` que toca un campo de gestión. Esta lista existe para que la ruta
 * conteste **antes**, con el nombre del campo, y no con el texto seco del
 * trigger. Tiene que decir lo mismo que el trigger: si se suma una columna de
 * gestión, va en los dos lados.
 *
 * Las escalas de los cinco puntajes no se vuelven a escribir: se toman del
 * esquema del alta, que ya es el que dice 3/2/1, 3/2/1, 5/3/1, 9/7/3 y 5/3/1.
 */

const PRIMERA_ETAPA = esquemaDeCondicion
  .pick({
    sector_id: true,
    equipo_id: true,
    descripcion: true,
    peligro_id: true,
    accion_propuesta: true,
    prioridad: true,
  })
  .partial();

const PUNTAJES = esquemaDeCondicion
  .pick({
    frecuencia: true,
    antecedentes: true,
    controles: true,
    magnitud_dano: true,
    legislacion: true,
  })
  .partial();

/**
 * Todo es opcional: el PATCH manda sólo lo que cambió. `null` es un valor que
 * significa algo —vaciar un puntaje lo devuelve a «sin evaluar»; una
 * `fecha_ejecucion` en null **reabre** la condición—.
 */
export const esquemaDeCambio = PRIMERA_ETAPA.extend(PUNTAJES.shape).extend({
  responsable_id: z.guid().nullish(),
  fecha_maxima: z.iso.date().nullish(),
  requiere_inversion: z.boolean().nullish(),
  observaciones: z.string().trim().nullish(),
  fecha_ejecucion: z.iso.date().nullish(),
});

export type CambioDeCondicion = z.infer<typeof esquemaDeCambio>;

/** Los campos que sólo toca un `admin`, con cómo se nombran en pantalla. */
export const CAMPOS_DE_ADMIN = {
  frecuencia: "frecuencia",
  antecedentes: "antecedentes",
  controles: "controles",
  magnitud_dano: "magnitud del daño",
  legislacion: "legislación",
  responsable_id: "responsable",
  fecha_maxima: "fecha máxima",
  requiere_inversion: "requiere inversión",
  observaciones: "observaciones",
  fecha_ejecucion: "fecha de ejecución",
} as const;

export type CampoDeAdmin = keyof typeof CAMPOS_DE_ADMIN;

/**
 * Cuáles de los campos de admin vinieron en el cuerpo, con su nombre de pantalla.
 *
 * Se mira el cuerpo **crudo** y no el validado: un campo mandado cuenta aunque
 * traiga un valor inválido, porque el 403 va antes que el 400 — a quien no
 * puede tocar un campo no se le explica cómo mandarlo bien.
 */
export function camposDeAdminEnviados(cuerpo: unknown): string[] {
  if (typeof cuerpo !== "object" || cuerpo === null) return [];
  return (Object.keys(CAMPOS_DE_ADMIN) as CampoDeAdmin[])
    .filter((campo) => campo in cuerpo)
    .map((campo) => CAMPOS_DE_ADMIN[campo]);
}

/**
 * El lugar que queda **después** del cambio. Para mover una condición de un
 * equipo a un sector hay que mandar los dos campos (`sector_id` con el nuevo y
 * `equipo_id: null`): mandar sólo el sector la dejaría en los dos, y no se
 * adivina cuál de los dos lugares es el que se quiere. La tabla también rechaza
 * los dos juntos, pero con un error de Postgres que no dice nada.
 *
 * Devuelve el problema en castellano, o null si el lugar que queda es válido.
 * Sólo habla si el cambio toca el lugar: una condición migrada sin lugar sigue
 * pudiendo corregirse en lo demás.
 */
export function problemaDelLugarResultante(
  actual: { sector_id: string | null; equipo_id: string | null },
  cambio: { sector_id?: string | null; equipo_id?: string | null }
): string | null {
  const tocaElLugar = "sector_id" in cambio || "equipo_id" in cambio;
  if (!tocaElLugar) return null;

  const sector = "sector_id" in cambio ? (cambio.sector_id ?? null) : actual.sector_id;
  const equipo = "equipo_id" in cambio ? (cambio.equipo_id ?? null) : actual.equipo_id;

  if (sector && equipo) {
    return "Una condición está en un sector o en un equipo, no en los dos.";
  }
  if (!sector && !equipo) {
    return "Falta decir en qué sector o equipo es.";
  }
  return null;
}
