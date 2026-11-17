import { z } from "zod";
import type { TipoDeEntidad } from "@/lib/core/mensajes";
import { TIPOS_DE_ENTIDAD } from "./entidades";
import { MAXIMO_DE_MENCIONES, MAXIMO_DEL_TEXTO } from "./limites";

/**
 * Lo que entra a las rutas de la mensajería, validado con zod y dicho en
 * castellano por `validar()` de `lib/core/validar.ts`.
 *
 * Vive en `lib/` y no adentro de las rutas porque las rutas no tienen tests en
 * este repo y `lib/` sí.
 */

// Los dos topes viven en `limites.ts` para que la pantalla los lea sin llevarse
// este archivo —y los permisos del servidor que importa— al navegador.
export { MAXIMO_DE_MENCIONES, MAXIMO_DEL_TEXTO };

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
