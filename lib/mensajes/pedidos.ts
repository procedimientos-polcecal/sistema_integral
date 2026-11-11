import { z } from "zod";
import type { TipoDeEntidad } from "@/lib/core/mensajes";
import { TIPOS_DE_ENTIDAD } from "./entidades";

/**
 * Lo que entra a las rutas de la mensajería, validado con zod y dicho en
 * castellano por `validar()` de `lib/core/validar.ts`.
 *
 * Vive en `lib/` y no adentro de las rutas porque las rutas no tienen tests en
 * este repo y `lib/` sí.
 */

/**
 * Cuántas personas se pueden mencionar en un mensaje.
 *
 * El padrón activo son 14, así que 20 no recorta a nadie hoy. Existe para que
 * un pedido armado a mano no dispare cientos de consultas de permisos ni
 * cientos de correos: cada mención cuesta una consulta y, si le corresponde,
 * un llamado al Apps Script.
 */
export const MAXIMO_DE_MENCIONES = 20;

/**
 * Cuánto puede medir un mensaje.
 *
 * El texto viaja entero en el cuerpo del correo y en el asunto sólo entra un
 * recorte (`paraUnAsunto`), así que no hay un límite técnico cerca: es el
 * tamaño de una conversación y no el de un informe. Se escribe una vez y vale
 * para la pantalla también.
 */
export const MAXIMO_DEL_TEXTO = 4000;

/** El `tipo` y el `id` del hilo, de la URL de un GET o de un cuerpo. */
const hilo = {
  tipo: z.enum(TIPOS_DE_ENTIDAD as [TipoDeEntidad, ...TipoDeEntidad[]]),
  // `guid` y no `uuid`: el segundo exige los bits de versión de la RFC y
  // rechazaría un id válido para Postgres que no los tenga.
  id: z.guid(),
};

export const esquemaDelHilo = z.object(hilo);

/** Sólo el tipo: la lista de a quién mencionar no depende de un registro en particular. */
export const esquemaDelTipo = z.object({ tipo: hilo.tipo });

export const esquemaDelMensaje = z.object({
  ...hilo,
  // `refine` y no `min(1)`: el mensaje de `min` es el genérico de longitud
  // («tiene que tener al menos 1 caracteres») y éste lo ve una persona.
  texto: z
    .string()
    .trim()
    .max(MAXIMO_DEL_TEXTO)
    .refine((t) => t.length > 0, "Escribí el mensaje."),
  // Omitirlo es lo mismo que no mencionar a nadie: el mensaje queda como nota
  // del registro.
  menciones: z.array(z.guid()).max(MAXIMO_DE_MENCIONES).default([]),
});

/**
 * Los parámetros de la URL de un GET, listos para validar.
 *
 * `URLSearchParams.get()` devuelve `null` para lo que falta, y `validar()`
 * distingue «falta» de «está mal» mirando `undefined`: con `null` diría que el
 * campo «tiene que ser un texto» en vez de que falta.
 */
export function parametrosDeLaUrl(url: string, claves: string[]): Record<string, string | undefined> {
  const buscados = new URL(url).searchParams;
  return Object.fromEntries(claves.map((c) => [c, buscados.get(c) ?? undefined]));
}
