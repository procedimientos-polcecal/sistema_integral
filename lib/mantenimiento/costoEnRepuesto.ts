/**
 * El costo de una OT del cuaderno, como se escribe en `REPUESTO UTILIZADO`.
 *
 * ── POR QUÉ EL COSTO VIAJA POR ESA COLUMNA ──────────────────────────────────
 *
 * La planilla no tiene una columna de costo, y es de donde lee quien no entra
 * al sistema. Se eligió la I (`REPUESTO UTILIZADO`) **porque es donde ya
 * está**: de las 380 OT de PIPARO, 62 tienen algo en `repuesto` y 58 de ésas
 * son un monto, escrito a mano así (medido el 01/11/2026):
 *
 *     "$190,000"
 *     "Empalme ($680000)"
 *     "2 parches de 200 (vulcanizado $240000)"
 *
 * Las 58 tienen las horas vacías, que es la forma del renglón con precio del
 * cuaderno. O sea que la práctica ya existía; esto sólo le da una columna
 * estructurada en la base (`ordenes_trabajo.costo`) sin cambiar lo que ve quien
 * mira la planilla.
 *
 * **Se suma al texto, no lo pisa**: `repuesto` también lleva repuestos de
 * verdad («Paño de zaranda según especificaciones (RI 230)»), y pisarlo
 * borraría lo que alguien escribió.
 *
 * Ojo: el monto vive entonces en dos lugares —la columna numérica y este
 * texto— y nada los ata. Es el precio de usar una columna que ya existía, y
 * está dicho en el spec como riesgo asumido.
 */

const redondear = (n: number) => Math.round(n * 100) / 100;

/**
 * 920000 → «920.000»; 1234,5 → «1.234,5».
 *
 * A mano y no con `Intl`: los locales `es` no agrupan los números de cuatro
 * cifras («1000»), y una columna de montos que mezcla «1000» con «10.000» se
 * lee como dos formatos. Acá el punto va siempre.
 *
 * **Es el único formateador de plata del cuaderno**: la pantalla
 * (`costoParaElCampo`) usa éste y no `Intl`, para decir lo mismo que va a quedar
 * escrito en la planilla. En Node con ICU completo `es-AR` sí agrupa los de
 * cuatro cifras, pero depende de los datos de locale del navegador de cada uno,
 * y esto no.
 */
export function conMiles(n: number): string {
  const [entero, decimales] = String(redondear(n)).split(".");
  const conPuntos = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return decimales ? `${conPuntos},${decimales}` : conPuntos;
}

const monto = (costo: number) => `$${conMiles(costo)}`;

/** Un costo de cero, negativo o que no es número no es un precio. */
function esPrecio(costo: number | null | undefined): costo is number {
  return typeof costo === "number" && Number.isFinite(costo) && costo > 0;
}

const limpio = (t: string | null | undefined): string | null => {
  const s = String(t ?? "").trim();
  return s === "" ? null : s;
};

/**
 * Lo que va en `REPUESTO UTILIZADO` para una OT con este costo y este repuesto.
 *
 * - Sin costo → lo que había (o null).
 * - Sin repuesto → el monto solo: `$920.000`.
 * - Con los dos → el texto y el monto entre paréntesis: `2 parches de 200 ($240.000)`.
 *
 * El separador de miles es el punto, que es el castellano: lo medido está
 * escrito de tres maneras y ninguna es un formato que valga la pena copiar.
 */
export function textoDeRepuesto(costo: number | null, repuesto: string | null): string | null {
  const texto = limpio(repuesto);
  if (!esPrecio(costo)) return texto;
  return texto ? `${texto} (${monto(costo)})` : monto(costo);
}

/**
 * El inverso de `textoDeRepuesto`: el repuesto sin el monto que se le sumó.
 *
 * Hace falta cuando una orden que ya tiene su costo en el texto cambia de
 * costo —se le sumó un renglón con precio—: sin sacar el viejo, el texto
 * quedaría `Empalme ($240.000) ($500.000)`.
 *
 * **Sólo saca el monto si el texto termina exactamente como lo dejó
 * `textoDeRepuesto`.** Si alguien lo editó a mano en la planilla, no se adivina
 * qué quiso decir y se devuelve igual: lo peor que pasa es que el monto nuevo
 * se agregue al final, y eso se ve.
 */
export function repuestoSinElCosto(costoAnterior: number | null, repuesto: string | null): string | null {
  const texto = limpio(repuesto);
  if (!esPrecio(costoAnterior) || !texto) return texto;

  const m = monto(costoAnterior);
  if (texto === m) return null;
  const cola = ` (${m})`;
  return texto.endsWith(cola) ? limpio(texto.slice(0, -cola.length)) : texto;
}
