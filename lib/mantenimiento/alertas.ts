import { fechaEnArgentina, sumarDias } from "@/lib/core/fechas";
import { esGutAlto, type NotasGut } from "./gut";

/**
 * Qué órdenes de trabajo están atrasadas.
 *
 * Hay dos maneras de estarlo y las dos cuentan: que la planilla la haya marcado
 * `ATRASADO` a mano, o que se le haya pasado la fecha en que tenía que hacerse.
 * La primera la decide una persona; la segunda, el calendario.
 *
 * Lo que **no** cuenta: una orden realizada —aunque se haya hecho tarde, ya no
 * hay nada que hacer con ella— y una cancelada, que no se va a hacer nunca y
 * avisarla todos los días es ruido.
 */

/** Lo mínimo para saber si una orden está atrasada. */
export interface Atrasable {
  estado?: string | null;
  proxima_fecha?: string | null;
  /**
   * El día en que la orden decía que había que hacerla.
   *
   * En una orden **abierta** es la fecha prevista; en una cerrada, cuándo se
   * hizo. Acá sólo llegan abiertas, porque todo pasa antes por
   * `estaAtrasada()`.
   */
  fecha_ejecucion?: string | null;
}

/**
 * Estados en los que la orden ya no espera nada de nadie.
 *
 * Tiene una gemela, `CERRADAS_GUT` en `gut.ts`, con los mismos dos valores y
 * **otro dueño**: aquella espeja la migración de `gut_orden` y ésta no espeja
 * nada, sólo decide qué cuenta como atrasada. No se unifican a propósito. Si un
 * día aparece un estado nuevo, hay que mirar las dos y decidir en cada una.
 */
export const CERRADAS = ["REALIZADO", "CANCELADA"];

/**
 * El día de hoy como `aaaa-mm-dd`, en hora de Argentina.
 *
 * Estaba escrito con getters locales —`getFullYear`, `getMonth`, `getDate`—
 * justamente para escapar de `toISOString()`, que convierte a UTC y corre el
 * día. Pero **no escapaba de nada**: en Vercel la hora local ES la UTC, así que
 * en el servidor daba exactamente lo mismo que la versión que quería reemplazar.
 * Desde las 21:00 de Argentina devolvía mañana, y un mantenimiento de hoy
 * aparecía vencido.
 *
 * Ahora sale del núcleo, que aplica el UTC-3 a mano y da igual en el servidor
 * que en el navegador de quien mira.
 */
export const hoyISO = fechaEnArgentina;

/** Si la orden está atrasada al día de hoy. */
export function estaAtrasada(orden: Atrasable, hoy: string): boolean {
  const estado = String(orden.estado ?? "").toUpperCase();
  if (CERRADAS.includes(estado)) return false;

  if (estado === "ATRASADO") return true;

  const fecha = String(orden.proxima_fecha ?? "").slice(0, 10);
  // Se comparan los textos: `aaaa-mm-dd` ordena igual que la fecha, y no hay
  // huso horario que pueda correr el día.
  return Boolean(fecha) && fecha < hoy;
}

/**
 * El día contra el que se mide el atraso: el vencimiento y, si no hay, el día
 * previsto de ejecución.
 *
 * **La segunda mitad hace casi todo el trabajo.** Medido el 19/11/2026:
 * ninguna de las 61 OT abiertas tiene `proxima_fecha` —las 19 atrasadas están
 * marcadas a mano desde la planilla—, así que sin este respaldo
 * `diasDeAtraso` devolvía `null` en las 19 y el panel del tablero mostraba
 * «—» en todas, con un orden «de la más vieja a la más nueva» que no ordenaba
 * nada. Las 19 sí tienen `fecha_ejecucion`.
 *
 * El vencimiento manda cuando están las dos: lo puso una persona para esa
 * orden, y el día previsto es lo que se esperaba antes.
 *
 * **El riesgo asumido**: `fecha_ejecucion` trae errores de carga. La #2726
 * dice 06/02/2026 con la orden cargada el 05/10/2026 —un año mal tipeado— y
 * va a salir con un atraso enorme. Se acepta: el número grande señala la fila
 * que hay que ir a corregir, que es más útil que un guión.
 */
function laFechaQueVencio(orden: Atrasable): string {
  return (
    String(orden.proxima_fecha ?? "").slice(0, 10) ||
    String(orden.fecha_ejecucion ?? "").slice(0, 10)
  );
}

/**
 * Hace cuántos días venció.
 *
 * `null` cuando la marcaron atrasada a mano y no dice desde cuándo por
 * ninguna de las dos vías: no se sabe, y poner cero la haría parecer recién
 * vencida.
 */
export function diasDeAtraso(orden: Atrasable, hoy: string): number | null {
  const fecha = laFechaQueVencio(orden);
  if (!fecha) return null;

  const dias = Math.round((fechaLocal(hoy) - fechaLocal(fecha)) / 86400000);
  return Math.max(0, dias);
}

/** Una fecha `aaaa-mm-dd` en milisegundos, sin que el huso corra el día. */
function fechaLocal(iso: string): number {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(a, m - 1, d).getTime();
}

/**
 * Las atrasadas, de la más vieja a la más nueva.
 *
 * Las que no dicen desde cuándo van al final: no se sabe qué tan urgentes son,
 * y primero conviene mirar lo que sí se puede medir.
 */
export function ordenarPorAtraso<T extends Atrasable>(ordenes: T[], hoy: string): T[] {
  return [...ordenes].sort((a, b) => {
    const da = diasDeAtraso(a, hoy);
    const db = diasDeAtraso(b, hoy);

    if (da === null && db === null) return 0;
    if (da === null) return 1;
    if (db === null) return -1;
    return db - da;
  });
}

interface ParaResumir extends Atrasable, NotasGut {
  ot_number?: number | null;
  sector_raw?: string | null;
}

/**
 * El estado de las atrasadas, para el aviso.
 *
 * Se agrupa por sector porque es como se decide a quién mandar: las cuatro
 * atrasadas de Calcinación son un problema de Calcinación, no cuatro problemas
 * sueltos.
 *
 * `urgentes` son las atrasadas de **puntaje GUT alto** (65 o más), y no las de
 * `prioridad` "alta". Esa comparación —`prioridad.toUpperCase() === "ALTA"`—
 * **nunca coincidió**: la planilla guarda "🟠 Alta", con el emoji y el espacio,
 * así que el tablero decía "0 de prioridad alta" desde el primer día. No se
 * restaura: la prioridad de la planilla ya no decide nada, sólo se muestra.
 */
export function resumirAtrasadas<T extends ParaResumir>(ordenes: T[], hoy: string) {
  const atrasadas = ordenarPorAtraso(ordenes.filter((o) => estaAtrasada(o, hoy)), hoy);

  const porSector = new Map<string, number>();
  for (const o of atrasadas) {
    const sector = o.sector_raw ?? "Sin sector";
    porSector.set(sector, (porSector.get(sector) ?? 0) + 1);
  }

  return {
    total: atrasadas.length,
    urgentes: atrasadas.filter(esGutAlto).length,
    masVieja: atrasadas[0] ?? null,
    atrasadas,
    porSector: [...porSector.entries()]
      .map(([sector, cuantas]) => ({ sector, cuantas }))
      .sort((a, b) => b.cuantas - a.cuantas),
  };
}

// ── LAS ATRASADAS DE ESTA SEMANA ────────────────────────────────────────────

/**
 * Cuántos días hacia atrás mira «esta semana», **contando hoy**.
 *
 * Siete días: `[hoy − 6, hoy]`. Hoy entra porque una orden que vencía hoy y ya
 * está marcada atrasada es de esta semana; terminar ayer la dejaría afuera el
 * día que más se la mira.
 */
export const DIAS_DE_LA_SEMANA = 7;

/** Lo que hace falta para agrupar una atrasada. */
export interface DeLaSemana extends Atrasable {
  ot_number?: number | null;
  sector_id?: string | null;
  sector_raw?: string | null;
  equipment_id?: string | null;
  equipo_raw?: string | null;
}

export interface GrupoDeLaSemana {
  /** El id cuando lo hay; si no, el texto, que es como se lo nombra. */
  clave: string;
  nombre: string;
  /** `null` cuando no hay id al que enlazar. */
  id: string | null;
  cuantas: number;
}

/** Agrupa por id si lo hay y por texto si no, de mayor a menor. */
function agrupar(
  ordenes: DeLaSemana[],
  id: (o: DeLaSemana) => string | null | undefined,
  texto: (o: DeLaSemana) => string | null | undefined,
  sinNombre: string
): GrupoDeLaSemana[] {
  const grupos = new Map<string, GrupoDeLaSemana>();

  for (const o of ordenes) {
    const suId = id(o) ?? null;
    const nombre = texto(o) ?? sinNombre;
    // La clave es el id cuando lo hay: dos órdenes del mismo equipo escrito de
    // dos maneras son el mismo equipo, y dos equipos sin id que se llaman
    // igual no se pueden distinguir de todos modos.
    const clave = suId ?? nombre;

    const grupo = grupos.get(clave);
    if (grupo) grupo.cuantas += 1;
    else grupos.set(clave, { clave, nombre, id: suId, cuantas: 1 });
  }

  return [...grupos.values()].sort(
    (a, b) => b.cuantas - a.cuantas || a.nombre.localeCompare(b.nombre)
  );
}

/**
 * Las atrasadas que tenían que hacerse esta semana, por equipo y por sector.
 *
 * Es el recorte reciente del panel de atrasadas, no otra cosa: pasa por
 * `estaAtrasada()` igual que él, así que una realizada o una cancelada no
 * entran. La diferencia es la ventana, y que acá se agrupa también por equipo.
 *
 * **Por qué por equipo**: el panel de atrasadas agrupa por sector porque es a
 * quién se le reclama. Esto agrupa además por equipo porque lo reciente se
 * mira para otra cosa — una máquina con dos órdenes vencidas en la misma
 * semana es una máquina que está pidiendo algo, y eso no se ve en el total
 * del sector.
 *
 * La fecha que decide es `fecha_ejecucion` y no `proxima_fecha`: ninguna de
 * las abiertas tiene vencimiento cargado. El porqué medido está en
 * `laFechaQueVencio`.
 */
export function resumirLaSemana<T extends DeLaSemana>(ordenes: T[], hoy: string) {
  const atrasadas = ordenes.filter((o) => estaAtrasada(o, hoy));
  const desde = sumarDias(hoy, -(DIAS_DE_LA_SEMANA - 1));

  const deLaSemana = atrasadas.filter((o) => {
    const fecha = String(o.fecha_ejecucion ?? "").slice(0, 10);
    // Lo del futuro queda afuera: hay órdenes con el año mal tipeado, y una
    // fecha que todavía no llegó no se pasó esta semana.
    return Boolean(fecha) && fecha >= desde && fecha <= hoy;
  });

  return {
    /** Las de la semana. */
    total: deLaSemana.length,
    /** Todas las atrasadas, para poder decir «8 de 19». */
    deTodas: atrasadas.length,
    /** El primer día de la ventana, para escribirlo en pantalla. */
    desde,
    ordenes: ordenarPorAtraso(deLaSemana, hoy),
    porEquipo: agrupar(deLaSemana, (o) => o.equipment_id, (o) => o.equipo_raw, "Sin equipo"),
    porSector: agrupar(deLaSemana, (o) => o.sector_id, (o) => o.sector_raw, "Sin sector"),
  };
}
