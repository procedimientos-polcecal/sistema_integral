import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

/**
 * Los ajustes del módulo Compras. Hoy hay uno solo: el umbral de monto alto.
 *
 * Vive en una tabla de una fila y no en una constante del código porque es un
 * número que envejece: con la inflación de acá, un `1500000` escrito a mano
 * deja de separar nada en unos meses. Se edita en `/compras/configuracion`.
 *
 * El valor de arranque, 1.500.000, cae en el percentil 91 de lo comprado
 * —medido el 19/10/2026: la mediana es 75.504 y el p99 es 13.661.437—, así que
 * separa bien sin marcar media lista.
 */

/** Lo que vale si la tabla no se puede leer. Ver el porqué en `umbralDeMontoAlto`. */
export const UMBRAL_POR_DEFECTO = 1_500_000;

/**
 * El umbral a partir del cual un requerimiento se considera de monto alto.
 *
 * Ante un error de lectura devuelve el valor por defecto en vez de fallar: que
 * no se pueda leer un ajuste no es razón para que el listado de requerimientos
 * no abra. La consecuencia de equivocarse acá es que algunas filas se vean
 * marcadas de más o de menos, no que se pierda un dato.
 */
export async function umbralDeMontoAlto(supabase: SupabaseClient): Promise<number> {
  const { data } = await supabase
    .from("compras_ajustes")
    .select("umbral_monto_alto")
    .maybeSingle();

  const valor = Number(data?.umbral_monto_alto);
  return Number.isFinite(valor) && valor > 0 ? valor : UMBRAL_POR_DEFECTO;
}

/**
 * Lo que acepta la ruta que guarda el umbral.
 *
 * Entero y positivo: un umbral de 0 marcaría todos los requerimientos con
 * monto como altos, y uno negativo también —el filtro compara con `>=`—, así
 * que los dos serían una marca que no separa nada y enseña a ignorarla. El
 * tope no es un límite de negocio sino un freno contra un cero de más al
 * tipear: mil millones de pesos ya no separaría nada en esta empresa.
 *
 * Vive acá y no en la ruta para poder probarlo, que es donde están las
 * decisiones.
 */
export const CuerpoDelUmbral = z.object({
  umbral_monto_alto: z
    .number()
    .min(1)
    .max(1_000_000_000)
    .refine(Number.isInteger, "umbral_monto_alto tiene que ser un número entero de pesos."),
});
