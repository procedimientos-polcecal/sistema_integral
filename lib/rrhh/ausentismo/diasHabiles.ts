import { diaDeLaSemana, rangoDelMes, sumarDias } from "@/lib/core/fechas";

/**
 * Los días hábiles del calendario, para el denominador del ausentismo.
 *
 * La planilla de Google divide por un 145 fijo para todos, todo el año. Acá el
 * denominador son los días hábiles de los meses que ya pasaron, acumulados. Con
 * eso el porcentaje cambia de escala: los hábiles reales andan por 182 por
 * persona, así que cada porcentaje sale a la mitad. Es lo que se quiere.
 *
 * LOS HÁBILES SALEN DEL CALENDARIO Y DE `feriados`, NO DE `calculos_diarios`.
 * Esa tabla arranca en febrero de 2026: enero no existe en ella, y no puede dar
 * el denominador del primer mes del año. Estas funciones son puras: reciben los
 * feriados como un arreglo de fechas "YYYY-MM-DD" y quien las llama lee la
 * tabla `feriados`.
 *
 * Los meses son "YYYY-MM" y las fechas "YYYY-MM-DD", como en el resto de
 * `lib/core`.
 */

/**
 * Lunes a viernes del mes, menos los feriados que caen en día hábil.
 *
 * Un feriado que cae sábado o domingo no resta nada: el día ya no estaba
 * contado. Restarlo igual daría un hábil de menos que no existe.
 */
export function habilesDelMes(mes: string, feriados: readonly string[]): number {
  const { primerDia, ultimoDia } = rangoDelMes(mes);
  const fechasFeriadas = new Set(feriados);
  let habiles = 0;
  for (let dia = primerDia; dia <= ultimoDia; dia = sumarDias(dia, 1)) {
    const dow = diaDeLaSemana(dia);
    const esFinDeSemana = dow === 0 || dow === 6;
    if (!esFinDeSemana && !fechasFeriadas.has(dia)) habiles++;
  }
  return habiles;
}

/**
 * Los sábados del mes. El reporte porcentual los suma aparte.
 *
 * No están en `habilesDelMes`: se cuentan a parte porque el porcentaje del
 * anual los necesita por separado.
 */
export function sabadosDelMes(mes: string): number {
  const { primerDia, ultimoDia } = rangoDelMes(mes);
  let sabados = 0;
  for (let dia = primerDia; dia <= ultimoDia; dia = sumarDias(dia, 1)) {
    if (diaDeLaSemana(dia) === 6) sabados++;
  }
  return sabados;
}

/**
 * Hábiles de enero hasta el mes de `hasta`, inclusive. El denominador del anual.
 *
 * `hasta` es un "YYYY-MM" y el mes que indica cuenta entero, aunque todavía
 * no haya terminado: la función no sabe qué día es hoy, así que no recorta.
 * Quien quiera hasta la fecha de hoy tiene que pedir otra cosa.
 */
export function habilesAcumulados(hasta: string, feriados: readonly string[]): number {
  const anio = hasta.slice(0, 4);
  const mesFinal = Number(hasta.slice(5, 7));
  let total = 0;
  for (let m = 1; m <= mesFinal; m++) {
    total += habilesDelMes(`${anio}-${String(m).padStart(2, "0")}`, feriados);
  }
  return total;
}

/**
 * Los meses de `anio` que no tienen ningún feriado cargado.
 *
 * `feriados` tiene sólo las filas que alguien cargó, y hoy todas son de 2026.
 * Un mes sin feriados cargados tiene más hábiles de los que tiene de verdad, y
 * el porcentaje sale más bajo sin que nada avise. Esta función es la forma en
 * que el reporte lo dice en vez de callarlo.
 */
export function mesesSinFeriados(anio: number, feriados: readonly string[]): string[] {
  const conFeriado = new Set(feriados.map((f) => f.slice(0, 7)));
  const sinFeriado: string[] = [];
  for (let m = 1; m <= 12; m++) {
    const mes = `${anio}-${String(m).padStart(2, "0")}`;
    if (!conFeriado.has(mes)) sinFeriado.push(mes);
  }
  return sinFeriado;
}
