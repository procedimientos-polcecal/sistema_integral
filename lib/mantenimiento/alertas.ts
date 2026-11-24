import { fechaEnArgentina, sumarDias } from "@/lib/core/fechas";
import { fechaParaElCalendario } from "@/lib/agenda/evento";
import { esGutAlto, type NotasGut } from "./gut";

/**
 * Qué órdenes de trabajo están atrasadas.
 *
 * Hay dos maneras de estarlo y las dos cuentan: que la planilla la haya marcado
 * `ATRASADO` a mano, o que se le haya pasado la fecha en que tenía que hacerse.
 * La primera la decide una persona; la segunda, el calendario.
 *
 * **La fecha es la de la ejecución y no `proxima_fecha`.** Esa columna está en
 * null en las 2.531 filas (medido el 19/11/2026; una foto y no un
 * invariante: al cierre de la rama eran 2.532, 19 marcadas y 32 atrasadas): la sincronización la lee de la
 * planilla —es la pareja de `frecuencia` en el master— pero nadie la llena, así
 * que decidir con ella reducía esta función a `estado === "ATRASADO"` y contaba
 * 21 donde las fechas dicen 34 (cifras de esa primera foto). Se sigue sincronizando; sólo se dejó de usar
 * para decidir.
 *
 * El inicio es el que ve el calendario (`fechaParaElCalendario`: la pendiente
 * si hay, si no la de la planilla) y el vencimiento es `fecha_fin` cuando es
 * posterior al inicio: una orden que arrancó ayer y termina mañana está en
 * curso. Una `fecha_fin` anterior al inicio es un dato sucio y vale «dura un
 * día», no adelanta el vencimiento.
 *
 * Lo que **no** cuenta: una orden realizada —aunque se haya hecho tarde, ya no
 * hay nada que hacer con ella— y una cancelada, que no se va a hacer nunca y
 * avisarla todos los días es ruido.
 */

/** Lo mínimo para saber si una orden está atrasada. */
export interface Atrasable {
  estado?: string | null;
  fecha_ejecucion?: string | null;
  fecha_ejecucion_pendiente?: string | null;
  fecha_fin?: string | null;
}

/**
 * Estados en los que la orden ya no espera nada de nadie.
 *
 * Tiene una gemela, `CERRADAS_GUT` en `gut.ts`, con los mismos dos valores y
 * **otro dueño**: aquella espeja la migración de `gut_orden` y ésta no espeja
 * nada, sólo decide qué cuenta como atrasada. No se unifican a propósito. Si un
 * día aparece un estado nuevo, hay que mirar las dos y decidir en cada una.
 * Se exporta para que quien consulta la base arme su `.not("estado", "in", ...)`
 * con la misma lista que usa la decisión.
 */
export const CERRADAS: readonly string[] = ["REALIZADO", "CANCELADA"];

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

/** El día en que la orden arranca para el calendario, recortado a `aaaa-mm-dd`. */
function inicioDe(orden: Atrasable): string {
  const inicio = fechaParaElCalendario({
    fecha_ejecucion: orden.fecha_ejecucion ?? null,
    fecha_ejecucion_pendiente: orden.fecha_ejecucion_pendiente,
  });
  return (inicio ?? "").slice(0, 10);
}

/**
 * El día en que la orden vencía: `fecha_fin` cuando es posterior al inicio y,
 * si no, el inicio mismo. Cadena vacía cuando no tiene ninguna fecha.
 *
 * Está sacado aparte —`estaAtrasada` lo tenía adentro— porque
 * `resumirLaSemana` necesita **la misma** fecha para recortar su ventana de
 * siete días. Escribirla dos veces es cómo se separan dos definiciones de lo
 * mismo: una orden que arrancó hace tres semanas y vencía ayer es de esta
 * semana, y mirando sólo el inicio no lo sería.
 */
function vencimientoDe(orden: Atrasable): string {
  const inicio = inicioDe(orden);
  if (!inicio) return "";

  const fechaFin = String(orden.fecha_fin ?? "").slice(0, 10);
  return fechaFin && fechaFin > inicio ? fechaFin : inicio;
}

/** Si la orden está atrasada al día de hoy. */
export function estaAtrasada(orden: Atrasable, hoy: string): boolean {
  const estado = String(orden.estado ?? "").toUpperCase();
  if (CERRADAS.includes(estado)) return false;

  if (estado === "ATRASADO") return true;

  const fin = vencimientoDe(orden);
  if (!fin) return false;

  // Se comparan los textos: `aaaa-mm-dd` ordena igual que la fecha, y no hay
  // huso horario que pueda correr el día.
  return fin < hoy;
}

/**
 * Hace cuántos días venció, contado desde el inicio efectivo.
 *
 * `null` cuando la marcaron atrasada a mano y no dice desde cuándo: no se
 * sabe, y poner cero la haría parecer recién vencida.
 *
 * **El riesgo asumido**: `fecha_ejecucion` trae errores de carga. La #2726
 * dice 06/02/2026 con la orden cargada el 05/10/2026 —un año mal tipeado— y
 * sale con un atraso enorme. Se acepta: el número grande señala la fila que
 * hay que ir a corregir, que es más útil que un guión.
 */
export function diasDeAtraso(orden: Atrasable, hoy: string): number | null {
  const fecha = inicioDe(orden);
  if (!fecha) return null;

  const dias = Math.round((fechaLocal(hoy) - fechaLocal(fecha)) / 86400000);
  return Math.max(0, dias);
}

/**
 * La misma decisión de `estaAtrasada`, escrita como filtro `.or()` de PostgREST
 * para traer de la base sólo las atrasadas. Verificada contra producción el
 * 19/11/2026: devuelve las mismas 34 órdenes que la versión en TypeScript.
 *
 * Se aplica junto con `.not("estado", "in", ...CERRADAS)`. El caso sucio
 * `fecha_fin <= inicio` no se escribe a propósito: junto con `inicio < hoy` ya
 * implica `fecha_fin < hoy`, y la rama `or(fecha_fin.is.null, fecha_fin.lt.hoy)`
 * lo cubre.
 *
 * **Supone `estado` not null**, y es la última divergencia entre las dos
 * escrituras: `estaAtrasada` trata un estado null como «no cerrada» y sigue a
 * las fechas, pero `.not("estado","in",...)` evalúa `NOT (NULL IN (...))` →
 * NULL y descarta la fila. Hoy no muerde: hay 0 filas con `estado` null
 * (medido el 19/11/2026).
 */
export function condicionDeAtrasada(hoy: string): string {
  const sinVentana = `or(fecha_fin.is.null,fecha_fin.lt.${hoy})`;
  return [
    "estado.eq.ATRASADO",
    `and(fecha_ejecucion_pendiente.not.is.null,fecha_ejecucion_pendiente.lt.${hoy},${sinVentana})`,
    `and(fecha_ejecucion_pendiente.is.null,fecha_ejecucion.lt.${hoy},${sinVentana})`,
  ].join(",");
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
 * **La fecha que recorta la ventana es `vencimientoDe()`, la misma con la que
 * `estaAtrasada` decide**, y no `fecha_ejecucion` cruda. Son dos cosas
 * distintas en dos casos reales: una orden recién postergada tiene su día en
 * `fecha_ejecucion_pendiente` —la planilla tarda de 3 a 53 horas en
 * devolverlo— y una con `fecha_fin` posterior al inicio vence el último día y
 * no el primero. Leer la columna cruda la mandaría a la semana equivocada sin
 * error y sin aviso, y dejaría a esta función diciendo «atrasada esta semana»
 * sobre un día que `estaAtrasada` no mira.
 */
export function resumirLaSemana<T extends DeLaSemana>(ordenes: T[], hoy: string) {
  const atrasadas = ordenes.filter((o) => estaAtrasada(o, hoy));
  const desde = sumarDias(hoy, -(DIAS_DE_LA_SEMANA - 1));

  const deLaSemana = atrasadas.filter((o) => {
    const fecha = vencimientoDe(o);
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
