/**
 * Un número tal como lo tipea una persona en la pantalla del cuaderno.
 *
 * **El punto no significa lo mismo en horas que en plata.** En horas «1.5» es
 * uno y medio; en un precio «920.000» es novecientos veinte mil, y mandarlo
 * crudo a la ruta —`Number("920.000")`— guardaría 920 sin dar error. Es el
 * error del otro lado de la misma trampa que tienen las planillas con las
 * fechas (d/m contra m/d): no rompe nada, y el número queda mal.
 *
 * Por eso la pantalla lo lee acá, con la regla de cada campo, y a la ruta le
 * llega ya un número. Lo que no se puede leer con certeza **no se adivina**:
 * se rechaza con el motivo.
 */

export type NumeroLeido =
  | { tipo: "vacio" }
  | { tipo: "numero"; valor: number }
  | { tipo: "invalido"; motivo: string };

export function leerNumeroDelCampo(texto: string, esDinero: boolean): NumeroLeido {
  const limpio = texto.replace(/[$\s]/g, "");
  if (limpio === "") return { tipo: "vacio" };

  const queEs = esDinero ? "El precio" : "Las horas";

  if (esDinero) {
    // 920.000 · 1.234.567,50 · 920000 · 920000,5 · 1234.50
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(limpio)) {
      return { tipo: "numero", valor: Number(limpio.replace(/\./g, "").replace(",", ".")) };
    }
    if (/^\d+(,\d+)?$/.test(limpio)) return { tipo: "numero", valor: Number(limpio.replace(",", ".")) };
    if (/^\d+\.\d{1,2}$/.test(limpio)) return { tipo: "numero", valor: Number(limpio) };
    return { tipo: "invalido", motivo: `${queEs} tiene que ser un número, como 920000 o 920.000.` };
  }

  if (/^\d+([.,]\d+)?$/.test(limpio)) return { tipo: "numero", valor: Number(limpio.replace(",", ".")) };
  return { tipo: "invalido", motivo: `${queEs} tienen que ser un número, como 8 o 2,5.` };
}

/** Cómo se muestra un número de horas en el campo: coma decimal, sin miles. */
export function horasParaElCampo(n: number | null | undefined): string {
  return n === null || n === undefined ? "" : String(n).replace(".", ",");
}

/** Cómo se muestra un precio en el campo: con puntos de miles, que es como se escribe. */
export function costoParaElCampo(n: number | null | undefined): string {
  if (n === null || n === undefined) return "";
  return new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(n);
}
