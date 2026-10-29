/**
 * Qué se guarda en el teléfono de lo que contestó `GET /api/seguridad-higiene/peligros`.
 *
 * Es una decisión y no un `if` suelto en la pantalla porque esa ruta dice **dos
 * cosas a la vez**: el glosario de peligros y, con su 403, que esta persona no
 * puede cargar condiciones. `/cargar` vive fuera del grupo `(app)` y no filtra
 * por módulo —el service worker la sirve para cualquier navegación sin red—, así
 * que el teléfono tiene que anotar el permiso para no mostrarle la tarjeta a
 * quien no lo tiene. Sin eso, esa persona saca la foto, carga, y se come un 403
 * cuando vuelve la señal: la carga queda parada y la foto no se puede repetir.
 *
 * **Sólo dos respuestas cambian lo guardado**, y las dos tienen que venir de la
 * ruta y no de lo que haya en el medio:
 *
 * - un 2xx con la lista y `puedeCargar: true` → se guarda, y la tarjeta se ve;
 * - un 403 **con un `error` en el cuerpo** → se guarda `puedeCargar: false`, y la
 *   tarjeta se esconde. La ruta manda `error` en todos sus 403; un 403 pelado es
 *   de un portal de WiFi o de un cortafuegos y no dice nada sobre el permiso de
 *   nadie (es el mismo criterio que `deLaRuta` en `colaOffline.js`).
 *
 * Cualquier otra cosa —sin señal, un 401 por sesión vencida, un 500, un HTML— no
 * toca nada: **lo guardado sigue valiendo**. Borrar el permiso por una caída de
 * la red habría sido esconderle la tarjeta a quien sí puede cargar justo cuando
 * no hay señal, que es cuando esta pantalla se usa.
 */

import type { TipoDeCarga } from "@/public/cola/colaOffline.js";

export interface PeligroDelCatalogo {
  id: string;
  nombre: string;
}

/** Lo que queda anotado en el teléfono: el glosario y si esta persona puede cargar. */
export interface GlosarioGuardado {
  peligros: PeligroDelCatalogo[];
  puedeCargar: boolean;
}

/** Lo que hay antes de bajar nada: sin permiso anotado, la tarjeta no se muestra. */
export const SIN_GLOSARIO: GlosarioGuardado = { peligros: [], puedeCargar: false };

export type QueHacerConElGlosario =
  | { accion: "guardar"; glosario: GlosarioGuardado }
  | { accion: "dejar" };

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null;
}

function esPeligro(valor: unknown): valor is PeligroDelCatalogo {
  return esObjeto(valor) && typeof valor.id === "string" && typeof valor.nombre === "string";
}

/**
 * @param status El código HTTP, o null si ni se llegó a hablar con el servidor.
 * @param cuerpo El JSON tal cual vino (`unknown`: puede ser `null` o cualquier cosa).
 */
export function queHacerConElGlosario(
  status: number | null,
  cuerpo: unknown,
): QueHacerConElGlosario {
  if (status === null || !esObjeto(cuerpo)) return { accion: "dejar" };

  if (status >= 200 && status < 300) {
    if (!Array.isArray(cuerpo.data) || cuerpo.puedeCargar !== true) return { accion: "dejar" };
    return {
      accion: "guardar",
      glosario: { peligros: cuerpo.data.filter(esPeligro), puedeCargar: true },
    };
  }

  if (status === 403 && typeof cuerpo.error === "string" && cuerpo.error.trim() !== "") {
    return { accion: "guardar", glosario: SIN_GLOSARIO };
  }

  return { accion: "dejar" };
}

/**
 * Qué pestañas ofrece `/cargar`. El aviso y la orden de trabajo se ofrecen
 * siempre —cualquier usuario activo los puede cargar—; la condición insegura
 * sólo si el teléfono tiene anotado que esta persona puede cargarla.
 */
export function tiposQueSeOfrecen(puedeCargarCondiciones: boolean): TipoDeCarga[] {
  return puedeCargarCondiciones ? ["aviso", "orden", "condicion"] : ["aviso", "orden"];
}

/**
 * El formulario que se dibuja: el pedido si se ofrece, y si no el primero que
 * sí. Existe por el permiso que se **retira**: una persona que había elegido la
 * pestaña de condición y a la que le sacan el módulo no puede quedarse con el
 * formulario puesto, porque lo que cargue va a volver con un 403.
 */
export function formularioQueSeVe(
  pedido: TipoDeCarga,
  ofrecidos: readonly TipoDeCarga[],
): TipoDeCarga {
  return ofrecidos.includes(pedido) ? pedido : ofrecidos[0];
}
