import { diaIso, fechaArgentinaDe, formatHHMM } from "./dates";

/**
 * La planilla de marcaciones de un empleado para un período: lo que se baja en
 * .xlsx y lo que se imprime en PDF.
 *
 * Es la misma tabla que muestra la pestaña «Fichadas» de la ficha del
 * empleado, y eso es a propósito: **lo que se ve es lo que se exporta**. Si la
 * pantalla filtra un día, acá tampoco aparece; si la pantalla suma una hora,
 * el archivo suma la misma. Un informe que no coincide con la pantalla que lo
 * generó no se puede usar para discutir un sueldo, que es para lo que sirve.
 *
 * Todo lo de acá es puro —no toca la base ni el DOM— porque es donde están las
 * decisiones que importan: cómo se escribe un turno que cruza la medianoche y
 * qué día cuenta como día con marcación.
 */

export interface FichadaDeLaPlanilla {
  hora_entrada: string;
  hora_salida: string | null;
}

export interface DiaDeLaPlanilla {
  fecha: string;
  tipo_dia: string | null;
  horas_normales: number | string | null;
  horas_extra_50: number | string | null;
  horas_extra_100: number | string | null;
  horas_manual?: boolean | null;
  extras_validadas?: boolean | null;
  tarde?: boolean | null;
  retiro_anticipado?: boolean | null;
  fichadas: FichadaDeLaPlanilla[];
}

/**
 * Los nombres de los días van escritos y no salen de `toLocaleDateString`.
 * Esto corre en el servidor (la ruta del .xlsx) y en el navegador (el PDF), y
 * el ICU del runtime de Vercel no tiene por qué traer `es-AR`: ahí el mismo
 * archivo saldría en inglés según dónde se generó.
 */
const NOMBRE_DEL_DIA = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

/** "2026-10-29" → "29/10/2026". */
export function fechaCorta(fechaIso: string): string {
  const [a, m, d] = fechaIso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

/** "2026-10-29" → "Jueves". */
export function nombreDelDia(fechaIso: string): string {
  const dia = new Date(`${fechaIso.slice(0, 10)}T00:00:00Z`).getUTCDay();
  return NOMBRE_DEL_DIA[dia] ?? "";
}

/**
 * Un par entrada-salida escrito para que lo lea una persona.
 *
 * EL `+1` NO ES DECORACIÓN. El turno de noche entra a las 20 y sale a las 4 del
 * día siguiente, y las dos marcas cuelgan del día de la entrada: sin la marca,
 * «20:00-04:00» se lee como un turno de ocho horas hacia atrás, o como un error
 * de carga. Es exactamente la confusión que tuvo las fichadas de noche rotas
 * hasta el 02/11/2026.
 *
 * Una salida que falta se escribe `?` y no se completa con nada: una fichada
 * abierta es un dato que falta, y rellenarlo acá lo volvería invisible en el
 * único papel donde alguien lo iba a ver.
 */
export function marcacionDeUnaFichada(f: FichadaDeLaPlanilla): string {
  const entrada = new Date(f.hora_entrada);
  if (!f.hora_salida) return `${formatHHMM(entrada)}-?`;

  const salida = new Date(f.hora_salida);
  const cruzaLaMedianoche = diaIso(fechaArgentinaDe(salida)) !== diaIso(fechaArgentinaDe(entrada));
  return `${formatHHMM(entrada)}-${formatHHMM(salida)}${cruzaLaMedianoche ? " +1" : ""}`;
}

/** Todas las marcaciones de un día, en una celda. */
export function marcacionesDelDia(d: DiaDeLaPlanilla): string {
  return d.fichadas.map(marcacionDeUnaFichada).join(" · ");
}

function num(v: number | string | null | undefined): number {
  const n = Number(v ?? 0);
  return isFinite(n) ? n : 0;
}

/**
 * A los dos decimales que la base puede guardar.
 *
 * Las horas salen de dividir milisegundos, así que sumar veintisiete días da
 * `224.51999999999998`. En la pantalla no se ve —muestra un decimal—, pero en
 * el .xlsx la celda **guarda ese número**, y el primero que le haga una resta
 * se encuentra con la cola. `calculos_diarios` es `numeric(5,2)`: dos
 * decimales son todo lo que había para decir.
 */
function redondear(h: number): number {
  return Math.round(h * 100) / 100;
}

/** Normales + extra 50 % + extra 100 %, que es lo que la pantalla llama «Hs. trabajadas». */
export function horasTrabajadas(d: DiaDeLaPlanilla): number {
  return redondear(num(d.horas_normales) + num(d.horas_extra_50) + num(d.horas_extra_100));
}

/**
 * Si el día entra en la planilla.
 *
 * Mismo criterio que la pantalla: un día sin marcaciones y sin horas no se
 * lista. `calculos_diarios` tiene una fila por empleado y por día del período
 * —incluidos los domingos que nadie trabajó—, así que sin este filtro el mes
 * sale con treinta renglones vacíos y los cinco que importan perdidos entre
 * ellos.
 *
 * Un día con marcaciones y cero horas **sí** entra: es una fichada abierta o
 * un turno sin cerrar, que es justo lo que hay que ver.
 */
export function tieneActividad(d: DiaDeLaPlanilla): boolean {
  return d.fichadas.length > 0 || horasTrabajadas(d) > 0;
}

/** Lo que se anota al costado del día: lo que la pantalla muestra como etiqueta. */
export function observacionesDelDia(d: DiaDeLaPlanilla): string {
  const notas: string[] = [];
  if (d.tarde) notas.push("Tardanza");
  if (d.retiro_anticipado) notas.push("Retiro anticipado");
  if (d.horas_manual) notas.push("Horas corregidas a mano");
  if (num(d.horas_extra_50) > 0 || num(d.horas_extra_100) > 0) {
    notas.push(d.extras_validadas ? "Extras validadas" : "Extras sin validar");
  }
  return notas.join(" · ");
}

export const COLUMNAS_DE_MARCACIONES = [
  "Fecha",
  "Día",
  "Marcaciones",
  "Hs. trabajadas",
  "Extra 50%",
  "Extra 100%",
  "Tipo de día",
  "Observaciones",
] as const;

export interface FilaDeMarcaciones {
  fecha: string;
  dia: string;
  marcaciones: string;
  horas: number;
  extra50: number;
  extra100: number;
  tipoDia: string;
  observaciones: string;
}

export interface TotalesDeMarcaciones {
  dias: number;
  horas: number;
  extra50: number;
  extra100: number;
}

/** Los días con actividad, en orden de fecha, ya escritos para leer. */
export function filasDeMarcaciones(dias: DiaDeLaPlanilla[]): FilaDeMarcaciones[] {
  return dias
    .filter(tieneActividad)
    .slice()
    .sort((a, b) => a.fecha.localeCompare(b.fecha))
    .map((d) => ({
      fecha: fechaCorta(d.fecha),
      dia: nombreDelDia(d.fecha),
      marcaciones: marcacionesDelDia(d),
      horas: horasTrabajadas(d),
      extra50: redondear(num(d.horas_extra_50)),
      extra100: redondear(num(d.horas_extra_100)),
      tipoDia: d.tipo_dia ?? "",
      observaciones: observacionesDelDia(d),
    }));
}

/**
 * El pie de la planilla.
 *
 * `dias` cuenta los renglones listados, no los días del período: es «cuántos
 * días vino», que es lo que alguien busca en un resumen mensual.
 */
export function totalesDeMarcaciones(dias: DiaDeLaPlanilla[]): TotalesDeMarcaciones {
  const conActividad = dias.filter(tieneActividad);
  return {
    dias: conActividad.length,
    horas: redondear(conActividad.reduce((a, d) => a + horasTrabajadas(d), 0)),
    extra50: redondear(conActividad.reduce((a, d) => a + num(d.horas_extra_50), 0)),
    extra100: redondear(conActividad.reduce((a, d) => a + num(d.horas_extra_100), 0)),
  };
}

/**
 * La aclaración del `+1`, al pie del .xlsx y del PDF.
 *
 * Está en una constante y no escrita dos veces porque los dos archivos tienen
 * que decir lo mismo: el día que alguien discuta una jornada de noche, el
 * papel y la planilla no pueden explicarla distinto.
 */
export const LEYENDA_TURNO_DE_NOCHE =
  "Una marcación con «+1» termina al día siguiente: es el turno de noche, y sus horas cuentan en el día en que empezó.";

/** Los datos de arriba de la planilla, como pares etiqueta/valor. */
export function encabezadoDeLaPlanilla(
  empleado: { apellido?: string | null; nombre?: string | null; legajo?: string | null; sector?: string | null },
  desde: string,
  hasta: string
): [string, string][] {
  const filas: [string, string][] = [
    ["Empleado", [empleado.apellido, empleado.nombre].filter(Boolean).join(", ")],
    ["Legajo", empleado.legajo ?? "—"],
  ];
  if (empleado.sector) filas.push(["Sector", empleado.sector]);
  filas.push(["Período", `${fechaCorta(desde)} al ${fechaCorta(hasta)}`]);
  return filas;
}

/**
 * El nombre del archivo que se baja.
 *
 * Lleva el apellido y el período porque el destino normal es una carpeta con
 * los de todo el mes: `marcaciones.xlsx` a secas se pisa con el siguiente.
 */
export function nombreDelArchivo(
  apellidoYNombre: string,
  desde: string,
  hasta: string,
  extension: "xlsx" | "pdf"
): string {
  const persona = apellidoYNombre.replace(/[,]/g, "").replace(/\s+/g, "-").toLowerCase();
  return `marcaciones-${persona}-${desde}-a-${hasta}.${extension}`;
}
