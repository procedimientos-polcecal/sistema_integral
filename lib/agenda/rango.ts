import { esFechaIso, sumarDias, diaDeLaSemana } from "@/lib/core/fechas";
import { corteDelHistorial, etiquetaDelDia } from "./vista";

/**
 * Qué se está mirando en la Agenda: la vista, el día y, de ahí, qué días se
 * dibujan y desde cuándo hay que leer eventos. Sin red y sin React.
 *
 * **`leerVista` y `leerDia` nunca tiran: ante un parámetro que no entienden
 * devuelven el valor por defecto.** La URL la escribe cualquiera —un enlace
 * viejo, un typo, alguien probando— y una pantalla de agenda que explota con
 * `?dia=banana` es peor que una que muestra hoy. Además `leerDia` no se
 * conforma con la forma `YYYY-MM-DD`: `2026-02-30` la cumple y no es un día, y
 * dejarlo pasar llegaría hasta el filtro que se arma contra la base.
 *
 * Todo trabaja con textos `YYYY-MM-DD` de pared de Argentina y con la aritmética
 * de `lib/core/fechas.ts`: nada de acá mira el reloj ni el huso de la máquina.
 */

export type VistaDeAgenda = "semana" | "dia" | "lista";

const VISTAS: readonly VistaDeAgenda[] = ["semana", "dia", "lista"];

/** La vista de la URL. Lo que no sea exactamente una de las tres —incluido un parámetro repetido— es la semana. */
export function leerVista(crudo: string | string[] | undefined): VistaDeAgenda {
  return typeof crudo === "string" && (VISTAS as readonly string[]).includes(crudo)
    ? (crudo as VistaDeAgenda)
    : "semana";
}

/** El día de la URL, o `hoy` si falta, no es una fecha o es una fecha que no existe. */
export function leerDia(crudo: string | string[] | undefined, hoy: string): string {
  return typeof crudo === "string" && esFechaIso(crudo) ? crudo : hoy;
}

/**
 * El lunes de la semana que contiene a `dia`. El domingo cierra la semana y no
 * la abre, así que retrocede seis días y no cero.
 */
export function inicioDeLaSemana(dia: string): string {
  const dow = diaDeLaSemana(dia);
  return sumarDias(dia, -(dow === 0 ? 6 : dow - 1));
}

/** Los días que se dibujan como columnas. La lista no tiene grilla. */
export function diasDelRango(vista: VistaDeAgenda, dia: string): string[] {
  if (vista === "dia") return [dia];
  if (vista === "lista") return [];
  const lunes = inicioDeLaSemana(dia);
  return Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i));
}

/**
 * Desde cuándo hay que pedirle eventos al servidor: el menor entre el comienzo
 * de lo que se ve y el corte del historial, así que mirar una semana vieja
 * trae esa semana y mirar el futuro no achica nunca la ventana de siempre.
 *
 * **La Lista ignora el día que se mira**: es «lo que viene y el último mes»
 * (decisión 11 del diseño), así que siempre manda el corte.
 *
 * El comienzo del rango se toma a medianoche **UTC**, que en Argentina son las
 * 21:00 del día anterior: se lee unas horas de más y nunca de menos, que es el
 * lado en que conviene equivocarse. Los dos extremos son `toISOString()`, así
 * que se comparan como texto.
 */
export function desdeParaLeer(vista: VistaDeAgenda, dia: string, ahora: Date = new Date()): string {
  const corte = corteDelHistorial(ahora);
  if (vista === "lista") return corte;
  const primero = diasDelRango(vista, dia)[0];
  const inicio = `${primero}T00:00:00.000Z`;
  return inicio < corte ? inicio : corte;
}

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function mesYAnio(dia: string): { mes: string; anio: string } {
  const [anio, mes] = dia.split("-");
  return { mes: MESES[Number(mes) - 1], anio };
}

/**
 * El título de la cabecera. Una semana dice su mes y su año; si cruza de un mes
 * a otro, los dos, y si además cruza el año, cada mes con el suyo. La lista no
 * tiene un rango que nombrar, así que dice lo que es.
 */
export function tituloDelRango(vista: VistaDeAgenda, dia: string): string {
  if (vista === "dia") return etiquetaDelDia(dia);
  if (vista === "lista") return "Próximos y recientes";
  const dias = diasDelRango("semana", dia);
  const a = mesYAnio(dias[0]);
  const b = mesYAnio(dias[6]);
  if (a.anio !== b.anio) return `${a.mes} ${a.anio} – ${b.mes} ${b.anio}`;
  if (a.mes !== b.mes) return `${a.mes} – ${b.mes} ${a.anio}`;
  return `${a.mes} ${a.anio}`;
}

/**
 * El enlace a una vista y un día de la Agenda: `/agenda?vista=…&dia=…`.
 *
 * **Conserva `historial=1` si estaba puesto.** Las flechas, «Hoy» y el selector
 * de vista son enlaces y no estado, así que lo que no viaja en la URL se pierde:
 * quien pidió «todo el historial» y cambia de vista volvería a los últimos 30
 * días sin que nada se lo diga.
 */
export function hrefDeLaAgenda(vista: VistaDeAgenda, dia: string, historial: boolean): string {
  const partes = new URLSearchParams({ vista, dia });
  if (historial) partes.set("historial", "1");
  return `/agenda?${partes.toString()}`;
}
