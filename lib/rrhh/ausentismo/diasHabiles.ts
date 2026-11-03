import { diaDeLaSemana, rangoDelMes, sumarDias } from "@/lib/core/fechas";

/**
 * Los días hábiles del calendario, para el denominador del ausentismo.
 *
 * La planilla de Google divide por un 145 fijo para todos, todo el año. Acá el
 * denominador son los días hábiles de los meses que ya pasaron, acumulados, y
 * el porcentaje baja. NO se parte al medio, y cuánto baja depende de cuánto del
 * año ya pasó. Medido con los feriados reales de 2026, 141 ausencias sobre 145
 * dan 97,2 %; sobre los 204 hábiles acumulados a octubre dan 69,1 %, y sobre los
 * 245 del año entero, 57,6 %. El numerador es el mismo en las tres cuentas: lo
 * que cambia es sólo el denominador.
 *
 * LOS HÁBILES SALEN DEL CALENDARIO Y DE `feriados`, NO DE `calculos_diarios`.
 * Esa tabla arranca en febrero de 2026: enero no existe en ella, y no puede dar
 * el denominador del primer mes del año. Estas funciones son puras: reciben los
 * feriados como un arreglo de fechas "YYYY-MM-DD" y quien las llama lee la
 * tabla `feriados`.
 *
 * Los meses son "YYYY-MM" y las fechas "YYYY-MM-DD", como en el resto de
 * `lib/core`.
 *
 * QUIEN LLAMA DEBE PASAR UN "YYYY-MM" VÁLIDO. Estas funciones no lo validan, a
 * propósito: la validación es del borde, que es la ruta que las llama. Un mes
 * mal escrito no tira un error claro. `"abc"` revienta más abajo, en
 * `toISOString`, con un mensaje que no dice qué pasó; `"2026-1"` (sin cero)
 * no revienta y da un resultado equivocado en silencio. Para chequearlo antes
 * de llamar, usar `esMesValido` de `lib/core/fechas.ts`.
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
 * No están en `habilesDelMes`: van en su propia función porque el reporte los
 * necesita sin mezclarlos con los hábiles.
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

/**
 * Si el año no tiene ningún feriado cargado. Es la alerta que el reporte debe
 * mostrar, no `mesesSinFeriados`.
 *
 * Por qué no alcanza con mirar los meses: Argentina no tiene feriado nacional
 * en septiembre. Con los 17 feriados reales de 2026, `mesesSinFeriados` da
 * `["2026-09"]`, y ese mes sin feriado es lo normal. Si la alerta saltara por
 * cada mes así, todos aprenderían a ignorarla, y el año que de verdad no tiene
 * feriados cargados (2027, hoy) quedaría escondido entre esos avisos. Esta
 * función responde sólo a eso: si ningún feriado cae en `anio`.
 */
export function anioSinFeriadosCargados(anio: number, feriados: readonly string[]): boolean {
  const prefijo = `${anio}-`;
  return !feriados.some((f) => f.startsWith(prefijo));
}
