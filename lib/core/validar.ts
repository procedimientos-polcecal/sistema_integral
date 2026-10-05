import { NextResponse } from "next/server";
import type { ZodType, infer as Inferido } from "zod";
import type { $ZodIssue } from "zod/v4/core";

/**
 * Validar el cuerpo de un pedido con zod, y decirlo en castellano.
 *
 * POR QUÉ EXISTE
 *
 * De las 224 rutas, **144 leen un cuerpo** y hasta el 05/10/2026 sólo una usaba
 * zod —y para los esquemas de las herramientas del asistente, no para validar
 * un pedido—. El resto parsea a mano, y la mayoría lo hace bien: listas
 * blancas (`if (body.x !== undefined) data.x = body.x`), mensajes propios
 * —"Falta quién lo pidió", "El ajuste no puede ser negativo"— que son mejores
 * que cualquier cosa genérica. **Eso no se toca**: el repo cuida esos mensajes,
 * y cambiarlos por "Invalid input" sería un retroceso.
 *
 * Lo que sí faltaba es el piso. Nueve rutas leían el cuerpo y **no devolvían un
 * solo 400**: lo que entraba iba derecho a Postgres, que rechaza un
 * `fecha_desde: 42` con `invalid input syntax for type date` — un mensaje que
 * llega a la pantalla sin decir qué campo ni qué se esperaba. Esto es para
 * esas.
 *
 * TODO JUNTO Y NO DE A UNO
 *
 * `safeParse` devuelve **todos** los problemas de una, y acá se informan todos.
 * Es la regla REG-T-15 de la Documentación Funcional —"el sistema indica todos
 * los campos faltantes simultáneamente, no de a uno"— y es la diferencia entre
 * corregir un formulario de una pasada o de a cuatro intentos.
 *
 * EL CASTELLANO NO ES COSMÉTICO
 *
 * Todo lo que se ve en pantalla en este sistema está en castellano. Los
 * mensajes que trae zod son en inglés y hablan de tipos (`expected string,
 * received number`), no de lo que la persona tiene que arreglar. Se traducen
 * acá, en un solo lugar y con test, en vez de que cada ruta arme el suyo.
 */

/** Lo que zod devuelve, traducido y listo para mostrar. */
export type Resultado<T> =
  | { ok: true; datos: T }
  | { ok: false; problemas: string[] };

/** El nombre del campo tal como lo nombra quien manda el pedido. */
function campoDe(ruta: readonly (string | number | symbol)[]): string {
  if (ruta.length === 0) return "el cuerpo";
  return ruta.map((p) => String(p)).join(".");
}

/** El valor que vino en esa ruta, para poder distinguir "falta" de "está mal". */
function valorEn(cuerpo: unknown, ruta: readonly (string | number | symbol)[]): unknown {
  let actual: unknown = cuerpo;
  for (const paso of ruta) {
    if (actual === null || actual === undefined || typeof actual !== "object") return undefined;
    actual = (actual as Record<string, unknown>)[String(paso)];
  }
  return actual;
}

const TIPOS: Record<string, string> = {
  string: "un texto",
  number: "un número",
  boolean: "verdadero o falso",
  array: "una lista",
  object: "un objeto",
  date: "una fecha",
};

const FORMATOS: Record<string, string> = {
  date: "una fecha con forma AAAA-MM-DD",
  datetime: "una fecha y hora ISO",
  uuid: "un identificador válido",
  email: "un correo válido",
  url: "una dirección web válida",
};

/**
 * Un problema de zod, dicho en castellano.
 *
 * `invalid_type` **no trae qué llegó**, así que "falta" y "vino con otro tipo"
 * no se distinguen mirando el problema: hay que mirar el cuerpo. Son dos
 * mensajes distintos y el que importa es el primero —casi siempre lo que pasa
 * es que el campo no vino— así que vale la vuelta.
 */
export function problemaEnCastellano(issue: $ZodIssue, cuerpo: unknown): string {
  const campo = campoDe(issue.path);

  switch (issue.code) {
    case "invalid_type": {
      const esperado = TIPOS[String(issue.expected)] ?? String(issue.expected);
      return valorEn(cuerpo, issue.path) === undefined
        ? `Falta ${campo}.`
        : `${campo} tiene que ser ${esperado}.`;
    }
    case "too_small": {
      const n = issue.minimum;
      if (issue.origin === "string") return `${campo} tiene que tener al menos ${n} caracteres.`;
      if (issue.origin === "array") return `${campo} tiene que tener al menos ${n} elementos.`;
      return `${campo} tiene que ser ${n} o más.`;
    }
    case "too_big": {
      const n = issue.maximum;
      if (issue.origin === "string") return `${campo} no puede pasar de ${n} caracteres.`;
      if (issue.origin === "array") return `${campo} no puede tener más de ${n} elementos.`;
      return `${campo} no puede ser mayor que ${n}.`;
    }
    case "invalid_value": {
      const valores = (issue.values ?? []).map((v) => String(v)).join(", ");
      return `${campo} tiene que ser uno de: ${valores}.`;
    }
    case "invalid_format":
      return `${campo} tiene que ser ${FORMATOS[String(issue.format)] ?? "válido"}.`;
    case "unrecognized_keys":
      return `Sobra: ${(issue.keys ?? []).join(", ")}.`;
    default:
      // Un `refine` propio ya trae su mensaje escrito por quien lo puso, que es
      // mejor que cualquier cosa que se pueda inventar acá.
      return issue.message;
  }
}

/**
 * Valida y devuelve los datos tipados, o **todos** los problemas.
 *
 * Pura: no toca el request ni arma una respuesta. Así se puede probar sin
 * levantar nada, que es donde están las decisiones.
 */
export function validar<E extends ZodType>(esquema: E, cuerpo: unknown): Resultado<Inferido<E>> {
  const r = esquema.safeParse(cuerpo);
  if (r.success) return { ok: true, datos: r.data };
  return {
    ok: false,
    problemas: r.error.issues.map((i) => problemaEnCastellano(i, cuerpo)),
  };
}

/**
 * El 400 con los problemas, listo para devolver.
 *
 * `error` lleva todo junto en una sola oración porque las pantallas muestran
 * `body.error` y nada más; `problemas` va aparte por si alguna quiere pintarlos
 * uno por uno.
 */
export function errorDeValidacion(problemas: string[]): NextResponse {
  return NextResponse.json({ error: problemas.join(" "), problemas }, { status: 400 });
}
