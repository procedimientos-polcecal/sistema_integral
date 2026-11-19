/**
 * El análisis semanal de las OT: los seis números de la hoja `Analisis de OT` y
 * las listas que los desglosan.
 *
 * Es la aritmética de la hoja `Analisis de OT` de la planilla
 * `1aCMQlLnigQnO32p-IxDGjsFLu-5hv8pnD8_-zTML8Jo`, puesta acá para poder
 * probarla: la ruta y la pantalla no tienen lógica propia.
 *
 * ── LOS NÚMEROS DEL SPEC SON MUESTRA DE FORMA, NO UNA META ──────────────────
 *
 * El diseño se escribió contra la semana 45 (02/11 al 08/11/2026) y anotó
 * 55/45/10/47/9. Medida de nuevo el 19/11/2026, la MISMA semana dio
 * 61/51/10/53/9: la planilla sigue recibiendo cierres de semanas pasadas, así
 * que esos números se mueven solos. Lo que se reproduce es la forma. Por eso
 * **ningún test de este módulo afirma un número leído de producción**: el
 * fixture está congelado en el archivo de test, o nacería en rojo.
 *
 * ── TRES COSAS QUE CAMBIAN RESPECTO DE LA HOJA, Y POR QUÉ ───────────────────
 *
 * 1. **«OTs Programadas» se llama acá «con inicio en la semana».** El
 *    `COUNTIFS` de la hoja cuenta todo lo que arranca esa semana y NO filtra
 *    por `tipo = PROGRAMADO`; el nombre hacía creer lo contrario y la gente
 *    leía el número como si fuera sólo el mantenimiento programado. Se cambia
 *    el nombre, no el conteo.
 *
 * 2. **Las que no cerraron en su semana se abren en las tres cosas distintas
 *    que son**: siguen abiertas, cerraron después del domingo y cerraron antes
 *    del lunes. En la hoja el «10» de arriba queda peleado con el «2» de la
 *    lista de abajo, y son dos preguntas distintas: 10 es incumplimiento de
 *    programación, 2 es trabajo que todavía está sin hacer. **Las tres partes
 *    suman exactamente `noCerraron`** — ver abajo cómo se consigue, porque es
 *    lo que hace que la pantalla no se contradiga sola.
 *
 * 3. **Las listas no filtran por tipo ni por estado.** Dos de los cuatro
 *    `FILTER` de la hoja sí lo hacen: «requieren reprogramación» pide además
 *    `tipo = PROGRAMADO` y estado distinto de Realizado, y «cerradas fuera de
 *    fecha» pide `tipo = PROGRAMADO` y estado Realizado. Acá se sacan los dos
 *    por la misma razón que arregla el 10 contra el 2: **las listas son el
 *    desglose de los números de arriba, así que tienen que sumar lo que ellos
 *    dicen.** Con el filtro de tipo puesto, el desglose de las 10 no da 10.
 *    Es la departida más grande respecto de la hoja y es deliberada.
 *
 * ── CÓMO SE CONSIGUE QUE LAS TRES PARTES SUMEN EXACTO ──────────────────────
 *
 * El conjunto a repartir es «arrancó en la semana y no cerró dentro». Se
 * reparte en este orden, y el orden importa:
 *
 *   1. si la orden sigue ABIERTA → `siguenAbiertas`, mire lo que mire la
 *      fecha de cierre. «Abierta» es `estado` fuera de `CERRADAS_PARA_REPROGRAMAR`
 *      y **nunca** `fecha_cierre is null`: medido el 17/11/2026, 220 de 2.489
 *      órdenes están `REALIZADO` sin fecha de cierre (una de cada diez), así
 *      que la fecha falta justo en trabajo terminado.
 *   2. si no, cerró: `fecha_cierre` anterior al lunes → `cerraronAntes`.
 *   3. todo lo demás → `cerraronDespues`. Es el **resto**, y ahí caen dos
 *      cosas: la que cerró después del domingo y la cerrada SIN fecha de
 *      cierre, que no se puede ubicar en el calendario. Va a «después» y no a
 *      «antes» porque de la cerrada sin fecha lo único que consta es que no
 *      cerró en su semana, y cerrar antes de arrancar es la rareza —dos casos
 *      en la semana 45— mientras que cerrar tarde es lo que pasa siempre.
 *      Hacer de `cerraronDespues` el resto es lo que vuelve imposible que
 *      alguna orden se caiga del desglose.
 *
 * **El valor `ATRASADO` del estado no se usa nunca.** Lo calcula la planilla
 * con un `ARRAYFORMULA` contra el `TODAY()` de su último recálculo, así que
 * envejece solo: de 29 órdenes abiertas con fecha vencida, sólo 17 lo decían.
 * El campo `estado` sí se usa —dice si la orden sigue viva—; el que no se usa
 * es ese valor suyo.
 *
 * Las listas van ordenadas por N° de OT, como las de la hoja. Esto es puro: no
 * habla con la base ni con Google.
 */

import { semanaDe } from "@/lib/core/fechas";
import { CERRADAS_PARA_REPROGRAMAR } from "@/lib/mantenimiento/reprogramacionesDeLaPlanilla";

/** La proyección de una OT que hace falta para el análisis. Es chica a propósito. */
export interface OrdenParaAnalisis {
  id: string;
  ot_number: number;
  sector_raw: string | null;
  equipo_raw: string | null;
  tipo: string | null;
  descripcion: string | null;
  /** La fecha de inicio vigente. */
  fecha_ejecucion: string | null;
  fecha_cierre: string | null;
  estado: string | null;
  /** Nació en el sistema: es la que tiene botón de Postergar. */
  app_created: boolean;
  reprogramada_veces: number;
}

export interface AnalisisDeLaSemana {
  lunes: string;
  domingo: string;
  /** OT cuya fecha de inicio cae en la semana, de cualquier tipo y estado. */
  conInicio: number;
  /** De ésas, las que además cerraron dentro de la misma semana. */
  cerradasDentro: number;
  /**
   * `cerradasDentro / conInicio`, de 0 a 1 — la división de las dos, como la
   * hace la hoja. `null` si no hay ninguna con inicio en la semana: la pantalla
   * imprime «—». Quien lo muestre lo formatea como porcentaje.
   */
  cumplimiento: number | null;
  /** La resta: las que arrancaron en la semana y no cerraron dentro. */
  noCerraron: number;
  /** Cerraron en la semana, hayan arrancado cuando sea. */
  cerradasEnLaSemana: number;
  /** De esas cerradas en la semana, las de tipo correctivo. */
  correctivasCerradas: number;
  /** El cuadro de tipo de mantenimiento cerrado. Los porcentajes suman 100. */
  porTipo: { tipo: string; cantidad: number; porcentaje: number }[];
  /** La frase de una línea que arma la hoja, en castellano. */
  diagnostico: string;
  /** El desglose de `noCerraron`. Las tres partes suman exactamente ese número. */
  lasDiez: { siguenAbiertas: number; cerraronDespues: number; cerraronAntes: number };
  listas: {
    conInicio: OrdenParaAnalisis[];
    sinCerrar: OrdenParaAnalisis[];
    cerradasFueraDeFecha: OrdenParaAnalisis[];
    cerradasEnLaSemana: OrdenParaAnalisis[];
  };
}

/** Los tipos que el cuadro nombra. Todo lo demás —incluido el null— va a «Otros». */
const PROGRAMADO = "PROGRAMADO";
const CORRECTIVO = "CORRECTIVO";
const OTROS = "Otros";

function estaAbierta(o: OrdenParaAnalisis): boolean {
  return !CERRADAS_PARA_REPROGRAMAR.includes((o.estado ?? "").trim().toUpperCase());
}

function tipoDelCuadro(o: OrdenParaAnalisis): string {
  const t = (o.tipo ?? "").trim().toUpperCase();
  return t === PROGRAMADO || t === CORRECTIVO ? t : OTROS;
}

/** Una fecha "YYYY-MM-DD" dentro del rango, inclusive. Las ISO se comparan como texto. */
function entre(fecha: string | null, desde: string, hasta: string): boolean {
  return fecha !== null && fecha !== "" && fecha >= desde && fecha <= hasta;
}

function porNumero(a: OrdenParaAnalisis, b: OrdenParaAnalisis): number {
  return a.ot_number - b.ot_number;
}

/**
 * Los porcentajes de un cuadro, con un decimal y sumando exactamente 100.
 *
 * Redondear cada uno por su cuenta deja cuadros que dicen 99,9 % o 100,1 % —un
 * tercio y un tercio y un tercio dan 99,9— y un total que no es 100 al pie de
 * un desglose es justo lo que hace dudar del resto de la pantalla. Se reparte
 * por resto mayor: se toma la parte entera de cada décimo y los décimos que
 * sobran se le dan a las filas con el resto más grande.
 */
function porcentajesQueSuman100(cantidades: readonly number[], total: number): number[] {
  if (total <= 0) return cantidades.map(() => 0);
  const enDecimos = cantidades.map((c) => (c / total) * 1000);
  const pisos = enDecimos.map((d) => Math.floor(d));
  let sobran = 1000 - pisos.reduce((t, d) => t + d, 0);
  const porRestoMayor = enDecimos
    .map((d, i) => ({ i, resto: d - Math.floor(d) }))
    .sort((a, b) => b.resto - a.resto);
  for (const { i } of porRestoMayor) {
    if (sobran <= 0) break;
    pisos[i] += 1;
    sobran -= 1;
  }
  return pisos.map((d) => d / 10);
}

/**
 * La frase que arma la hoja en su celda «Diagnóstico Semanal», en castellano y
 * sin el emoji —la pantalla pone su propio ícono—.
 *
 * La hoja sólo tiene dos ramas y la de «balance positivo» se queda con el caso
 * en que no cerró nada, donde dice «predominó la ejecución programada (0 OT)
 * sobre imprevistos (0)». Acá esa semana tiene su propia frase: decir «balance
 * positivo» sobre una semana sin un solo cierre es lo contrario de informar.
 */
function diagnosticoDeLaSemana(programadas: number, correctivas: number, total: number): string {
  if (total === 0) return "No se cerró ninguna OT en la semana.";
  if (correctivas > programadas) {
    return (
      `Alta carga correctiva (${correctivas} OT contra ${programadas} programadas): ` +
      "redujo la capacidad de cumplir lo planificado."
    );
  }
  return (
    `Balance positivo: predominó la ejecución programada (${programadas} OT) ` +
    `sobre los imprevistos (${correctivas}).`
  );
}

/**
 * Los seis números de la semana que contiene a `unDiaDeLaSemana` y sus cuatro
 * listas. La semana es de lunes a domingo, tome el día que tome.
 */
export function analizarLaSemana(
  ordenes: readonly OrdenParaAnalisis[],
  unDiaDeLaSemana: string,
): AnalisisDeLaSemana {
  const dias = semanaDe(unDiaDeLaSemana);
  const lunes = dias[0];
  const domingo = dias[6];

  const conInicio = ordenes.filter((o) => entre(o.fecha_ejecucion, lunes, domingo));
  const cerradasEnLaSemana = ordenes.filter((o) => entre(o.fecha_cierre, lunes, domingo));

  // Las que arrancaron en la semana y no cerraron dentro, repartidas en tres
  // partes que no se pisan y no dejan a nadie afuera: el orden es el que está
  // explicado en el encabezado.
  const sinCerrar: OrdenParaAnalisis[] = [];
  const cerradasFueraDeFecha: OrdenParaAnalisis[] = [];
  const cerraronAntes: OrdenParaAnalisis[] = [];
  for (const o of conInicio) {
    if (entre(o.fecha_cierre, lunes, domingo)) continue;
    if (estaAbierta(o)) sinCerrar.push(o);
    else if (o.fecha_cierre !== null && o.fecha_cierre !== "" && o.fecha_cierre < lunes) {
      cerraronAntes.push(o);
    } else cerradasFueraDeFecha.push(o);
  }

  const cantidadPorTipo = (tipo: string) =>
    cerradasEnLaSemana.filter((o) => tipoDelCuadro(o) === tipo).length;
  const cantidades = [
    cantidadPorTipo(PROGRAMADO),
    cantidadPorTipo(CORRECTIVO),
    cantidadPorTipo(OTROS),
  ];
  const porcentajes = porcentajesQueSuman100(cantidades, cerradasEnLaSemana.length);
  const porTipo = [PROGRAMADO, CORRECTIVO, OTROS].map((tipo, i) => ({
    tipo,
    cantidad: cantidades[i],
    porcentaje: porcentajes[i],
  }));

  // `cerradasDentro` se calcula como el complemento de las tres partes y no
  // como un cuarto conteo propio: así «las tres suman noCerraron» no es algo
  // que haya que acordarse de mantener, sino lo único que puede pasar. Quedan
  // adentro, como en la hoja, las que tienen fecha de cierre en la semana,
  // miren lo que miren su tipo y su estado.
  const cerradasDentro =
    conInicio.length - sinCerrar.length - cerradasFueraDeFecha.length - cerraronAntes.length;

  return {
    lunes,
    domingo,
    conInicio: conInicio.length,
    cerradasDentro,
    cumplimiento: conInicio.length === 0 ? null : cerradasDentro / conInicio.length,
    noCerraron: conInicio.length - cerradasDentro,
    cerradasEnLaSemana: cerradasEnLaSemana.length,
    correctivasCerradas: cantidades[1],
    porTipo,
    diagnostico: diagnosticoDeLaSemana(cantidades[0], cantidades[1], cerradasEnLaSemana.length),
    lasDiez: {
      siguenAbiertas: sinCerrar.length,
      cerraronDespues: cerradasFueraDeFecha.length,
      cerraronAntes: cerraronAntes.length,
    },
    listas: {
      conInicio: [...conInicio].sort(porNumero),
      sinCerrar: sinCerrar.sort(porNumero),
      cerradasFueraDeFecha: cerradasFueraDeFecha.sort(porNumero),
      cerradasEnLaSemana: [...cerradasEnLaSemana].sort(porNumero),
    },
  };
}

/**
 * Las órdenes abiertas cuya fecha de inicio ya pasó, la más vencida primero.
 *
 * Es contra **hoy** y no contra la semana que se está mirando: una orden
 * vencida lo está ahora, no en noviembre pasado. Por eso la pestaña que la
 * muestra no se mueve con las flechas y lo dice en su rótulo.
 *
 * Una orden cuya fecha de inicio es hoy todavía no está vencida: el día
 * empezó. Y una sin fecha de inicio no se puede decir vencida de nada.
 */
export function lasQueNecesitanReprogramarse(
  ordenes: readonly OrdenParaAnalisis[],
  hoy: string,
): OrdenParaAnalisis[] {
  return ordenes
    .filter(
      (o) =>
        estaAbierta(o) &&
        o.fecha_ejecucion !== null &&
        o.fecha_ejecucion !== "" &&
        o.fecha_ejecucion < hoy,
    )
    .sort(
      (a, b) =>
        (a.fecha_ejecucion ?? "").localeCompare(b.fecha_ejecucion ?? "") ||
        a.ot_number - b.ot_number,
    );
}
