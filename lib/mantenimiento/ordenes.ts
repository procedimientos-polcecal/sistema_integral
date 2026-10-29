/**
 * Órdenes de trabajo: leer la planilla donde viven.
 *
 * Se lee por posición de columna, como en el origen y verificado contra la
 * planilla "ORDEN DE TRABAJO", pestaña OT:
 *
 *   A N° OT · B fecha · C sector · D equipo · E especialidad · F tipo ·
 *   G quién lo realiza · H descripción · I repuesto · J ejecución · K cierre ·
 *   L (calculada, se saltea) · M estado · N contratista · O horas ·
 *   P/Q/R operarios · S prioridad · T frecuencia · U próxima fecha ·
 *   V fotos · W observaciones · X observación previa
 *
 * La L se llama "Column 19" y trae un "Atrasado / al día" calculado. **No es el
 * estado**: el estado está en M, y confundirlas daría por atrasada media
 * planilla.
 *
 * La W y la X son dos cosas distintas y se confunden por el nombre: la W es lo
 * que se **encontró al hacer** el trabajo, y la X por qué **todavía no se
 * hizo**. Una la escribe el registro de la ejecución y la otra las notas de
 * `lib/mantenimiento/notas.ts`.
 */

import { texto, fechaDeSheets, codigoDeEquipo } from "@/lib/mantenimiento/planilla";
import { letraDeColumna } from "@/lib/core/columnaDeSheets";
import { textoParaLaCelda } from "@/lib/core/sheets";

/**
 * Las especialidades que usa la planilla, verificadas contra ella.
 *
 * Es vocabulario cerrado: si aparece una nueva hay que sumarla acá para poder
 * filtrar por ella — las OT igual se guardan con lo que diga la celda.
 *
 * **INSTRUMENTACIÓN y OTRO se sumaron el 21/10/2026 y no salen de la planilla:
 * salen de dos formularios que las ofrecían por su cuenta.** `NuevaOTModal` y
 * `FormularioOTOffline` tenían cada uno su copia de esta lista, con esas dos de
 * más y sin LUBRICACIÓN. O sea que desde esas pantallas se podía crear una OT
 * con una especialidad que el filtro del listado no conocía —no aparecía al
 * filtrar, igual que las prioridades del 16/10— y no se podía crear ninguna de
 * lubricación, de las que hay 7.
 *
 * Se decidió sumarlas en vez de sacarlas de las pantallas, a pedido: las dos
 * tienen 0 usos en 2.224 OT, pero son oficios que existen y el formulario los
 * ofrecía por algo. Lo que cuesta, dicho: ahora esos dos valores **pueden
 * viajar a la columna E de la planilla**, que nunca los tuvo.
 */
export const ESPECIALIDADES = [
  "MECÁNICO", "ELÉCTRICO", "INSTRUMENTACIÓN", "CIVIL", "LUBRICACIÓN", "OTRO",
] as const;

/** Columna de cada dato, contando desde A = 0. */
const COL = {
  otNumber: 0,
  fecha: 1,
  sector: 2,
  equipo: 3,
  especialidad: 4,
  tipo: 5,
  quien: 6,
  descripcion: 7,
  repuesto: 8,
  fechaEjecucion: 9,
  fechaCierre: 10,
  estado: 12,
  contratista: 13,
  horas: 14,
  operario1: 15,
  operario2: 16,
  operario3: 17,
  prioridad: 18,
  frecuencia: 19,
  proximaFecha: 20,
  fotos: 21,
  observaciones: 22,
  observacionPrevia: 23,
} as const;

/**
 * La columna de la observación previa, para quien la escribe desde afuera.
 *
 * Se exporta desde acá y no se repite en `notas.ts` porque el mapa de columnas
 * de esta planilla tiene que ser uno solo: una segunda copia es cómo dos
 * campos terminan escribiendo la misma celda.
 */
export const COLUMNA_OBSERVACION_PREVIA: number = COL.observacionPrevia;

/**
 * Las columnas del master que son **derrame** de los `IMPORTRANGE`, y la que
 * calcula la propia planilla.
 *
 * ── POR QUÉ ESTO ESTÁ ACÁ Y NO EN UNA PANTALLA ──────────────────────────────
 *
 * Las columnas A a J y la S de la pestaña `OT` no tienen valor propio: son el
 * derrame de cuatro `QUERY(IMPORTRANGE())` del libro de respuestas. Medido el
 * 26/10/2026 sobre las filas de las OT 2896 y 2897: **ninguna de sus celdas de
 * la A a la S tiene `userEnteredValue`**, o sea que no hay nada escrito ahí.
 *
 * Y eso tiene una consecuencia que no avisa: **escribir una corrección a mano
 * en esas columnas no se guarda.** O bloquea el derrame con un `#REF!`, o el
 * derrame la pisa al recalcular. Si entre las dos cosas pasa una
 * sincronización, el sistema toma el valor nuevo y la siguiente lo devuelve al
 * viejo — una fecha que se corrige y se descorrige sola, que es lo que se
 * reportó ese día con la fecha de ejecución de la 2896 y la 2897.
 *
 * La L es otra cosa y por eso va aparte: no es derrame sino la fórmula de
 * atrasado/al día del propio master. Tampoco se escribe, pero por otro motivo.
 *
 * El reparto vive **junto al mapa de columnas** a propósito. Una lista de
 * «campos que no se pueden corregir» escrita en una pantalla se despega de la
 * planilla el día que alguien mueve una columna, y lo haría en silencio: hay un
 * test que exige que cada columna de `COL` esté en exactamente uno de los tres
 * grupos, así que una columna nueva no puede quedarse sin clasificar.
 */
export const COLUMNAS_DE_DERRAME: readonly number[] = [
  COL.otNumber, COL.fecha, COL.sector, COL.equipo, COL.especialidad,
  COL.tipo, COL.quien, COL.descripcion, COL.repuesto, COL.fechaEjecucion,
  COL.prioridad,
];

/** La que calcula la planilla sola. No se escribe, pero no es derrame. */
export const COLUMNA_CALCULADA = 11;

/** Las que sí son literales del master y el sistema puede escribir. */
export const COLUMNAS_ESCRIBIBLES: readonly number[] = [
  COL.fechaCierre, COL.estado, COL.contratista, COL.horas,
  COL.operario1, COL.operario2, COL.operario3,
  COL.frecuencia, COL.proximaFecha, COL.fotos,
  COL.observaciones, COL.observacionPrevia,
];

/** Todas las columnas del mapa, para que el test pueda recorrerlas. */
export const TODAS_LAS_COLUMNAS: readonly number[] = Object.values(COL);

/**
 * Cómo se nombran, para decírselo a quien mira la orden.
 *
 * El N° de OT no está: nadie va a querer corregirlo y nombrarlo sólo alarga la
 * frase. Lo que importa es que estén los que una persona sí corrige.
 */
export const LO_QUE_NO_SE_CORRIGE_EN_EL_MASTER: readonly string[] = [
  "la fecha de la orden", "el sector", "el equipo", "la especialidad",
  "el tipo", "quién lo realiza", "la descripción", "el repuesto",
  "la fecha de ejecución", "la prioridad",
];

/**
 * El estado de la planilla, en el vocabulario del sistema.
 *
 * Lo que no se reconoce queda como "por hacer": es el estado del que se parte,
 * no un dato faltante. Una OT sin clasificar es una OT que falta hacer.
 */
export function estadoDeTexto(valor: unknown): string {
  const v = String(valor ?? "").trim().toUpperCase();

  if (v === "REALIZADO") return "REALIZADO";
  if (v.includes("PROCESO")) return "EN_PROCESO";
  if (v === "ATRASADO") return "ATRASADO";
  if (v === "SUSPENDIDA") return "SUSPENDIDA";
  return "POR_HACER";
}

/**
 * Un campo de texto de la planilla.
 *
 * El guión suelto es como se escribe "acá no va nada" en una planilla: no es un
 * contratista llamado "-".
 */
const campo = (v: unknown): string | null => {
  const s = texto(v);
  return s === null || s === "-" ? null : s;
};

const numero = (v: unknown): number | null => {
  const s = texto(v);
  if (s === null) return null;
  const n = Number(s.replace(",", "."));
  return isFinite(n) ? n : null;
};

export interface OrdenLeida {
  ot_number: number;
  fecha: string | null;
  sector_raw: string | null;
  equipo_raw: string | null;
  equipo_code: string | null;
  especialidad: string | null;
  tipo: string | null;
  quien: string | null;
  descripcion: string | null;
  repuesto: string | null;
  fecha_ejecucion: string | null;
  fecha_cierre: string | null;
  estado: string;
  /**
   * La celda del estado **tal cual**, sin interpretar.
   *
   * `estado` pasa por `estadoDeTexto`, que a lo que no reconoce le pone «por
   * hacer» — y eso incluye la celda vacía. Es lo correcto para importar: una
   * orden sin clasificar es una orden que falta hacer. Pero borra la
   * diferencia entre «la planilla dice Por hacer» y «la planilla no dice
   * nada», y ésa es justamente la que hizo falta el 29/10/2026: ocho órdenes
   * con el ESTADO en blanco que el contraste no podía ver, porque las leía
   * como «por hacer» y el sistema también decía «por hacer».
   */
  estado_raw: string | null;
  contratista: string | null;
  horas: number | null;
  operario_1: string | null;
  operario_2: string | null;
  operario_3: string | null;
  prioridad: string | null;
  frecuencia: string | null;
  proxima_fecha: string | null;
  sheets_row: number;
}

/** Una fila de la planilla como orden de trabajo. `null` si no lo es. */
export function filaDeOrden(fila: unknown[], numeroFila: number): OrdenLeida | null {
  const nro = Number(fila[COL.otNumber]);
  if (!nro || isNaN(nro)) return null;

  const equipoRaw = campo(fila[COL.equipo]);

  return {
    ot_number: nro,
    fecha: fechaDeSheets(fila[COL.fecha]),
    sector_raw: campo(fila[COL.sector]),
    equipo_raw: equipoRaw,
    equipo_code: codigoDeEquipo(equipoRaw),
    especialidad: campo(fila[COL.especialidad]),
    tipo: campo(fila[COL.tipo]),
    quien: campo(fila[COL.quien]),
    descripcion: campo(fila[COL.descripcion]),
    repuesto: campo(fila[COL.repuesto]),
    fecha_ejecucion: fechaDeSheets(fila[COL.fechaEjecucion]),
    fecha_cierre: fechaDeSheets(fila[COL.fechaCierre]),
    estado: estadoDeTexto(fila[COL.estado]),
    estado_raw: campo(fila[COL.estado]),
    contratista: campo(fila[COL.contratista]),
    horas: numero(fila[COL.horas]),
    operario_1: campo(fila[COL.operario1]),
    operario_2: campo(fila[COL.operario2]),
    operario_3: campo(fila[COL.operario3]),
    prioridad: campo(fila[COL.prioridad]),
    frecuencia: campo(fila[COL.frecuencia]),
    proxima_fecha: fechaDeSheets(fila[COL.proximaFecha]),
    sheets_row: numeroFila,
  };
}

/**
 * El texto del estado tal como lo escribe la planilla.
 *
 * La app guarda `EN_PROCESO`; la planilla dice "En proceso". Escribirle el
 * vocabulario de la app la dejaría con dos formas del mismo estado.
 */
const EN_LA_PLANILLA: Record<string, string> = {
  REALIZADO: "Realizado",
  EN_PROCESO: "En proceso",
  ATRASADO: "Atrasado",
  POR_HACER: "Por hacer",
  SUSPENDIDA: "Suspendida",
};

/**
 * La letra de una columna: 0 → A. Esta planilla llega hasta la W, así que la
 * cuenta simple alcanzaría; se usa la del núcleo igual, para que quede una sola
 * en todo el sistema y no haya que acordarse de cuál es el tope de cada una.
 */
const letra = letraDeColumna;

export interface RegistroDeOT {
  estado?: string | null;
  fecha_cierre?: string | null;
  horas?: number | null;
  contratista?: string | null;
  operario_1?: string | null;
  operario_2?: string | null;
  operario_3?: string | null;
  observaciones?: string | null;
  foto_url?: string | null;
}

/**
 * Repartir lo que llega al registrar el trabajo: qué va a la tabla y qué a la
 * planilla.
 *
 * No es lo mismo. `ordenes_trabajo` tiene columna para el estado, el cierre,
 * las horas, el contratista y los tres operarios. **Las observaciones y la foto
 * no**: en el sistema viven en la ejecución —que es donde se registra qué se
 * hizo y qué se encontró— y en la planilla tienen su columna, la W y la V.
 *
 * Estaba escrito en línea en la ruta y las observaciones se colaron en el
 * update de la tabla: el PATCH fallaba entero con "Could not find the
 * 'observaciones' column", justo después de que la ejecución ya se había
 * guardado. El trabajo quedaba registrado y la OT sin cerrar. Vive acá para
 * poder probarlo.
 *
 * Es lista blanca: lo que no está nombrado no llega a la base, así que un body
 * con campos de más no puede escribir columnas arbitrarias.
 */
export const ESTADOS_DE_OT = [
  "REALIZADO", "EN_PROCESO", "ATRASADO", "POR_HACER", "SUSPENDIDA",
] as const;

export type EstadoDeOT = (typeof ESTADOS_DE_OT)[number];

/**
 * Si un texto es uno de los estados que el sistema conoce.
 *
 * Existe porque la lista de arriba era **código muerto**: estaba exportada y no
 * la importaba nadie, y la ruta de órdenes tenía su propia copia —`VALID_ESTADOS`—
 * que sólo usaba el PATCH. El POST no validaba nada: escribía `estado || "POR_HACER"`
 * tal cual, así que cualquier texto entraba a la base y de ahí a la planilla vía
 * `EN_LA_PLANILLA[v] ?? v`. Dos listas del mismo vocabulario y una sola en uso es
 * exactamente cómo se separan.
 */
export function esEstadoDeOT(valor: unknown): valor is EstadoDeOT {
  return typeof valor === "string" && (ESTADOS_DE_OT as readonly string[]).includes(valor);
}

/** Los que tienen columna propia en `ordenes_trabajo` y también en la planilla. */
const EN_LOS_DOS_LADOS = ["contratista", "operario_1", "operario_2", "operario_3"] as const;

/**
 * Los que tienen columna en la tabla y **no** en la planilla.
 *
 * La falla del equipo no se exporta —riesgo asumido y escrito, igual que el
 * GUT: el libro está por darse vuelta—, así que si se colaran en `registro` la
 * ruta intentaría escribir celdas que esa planilla no tiene.
 */
const SOLO_EN_LA_TABLA = ["falla_modo", "falla_causa", "falla_detalle"] as const;

export function repartirRegistroDeOT(body: Record<string, unknown>): {
  update: Record<string, unknown>;
  registro: RegistroDeOT;
} {
  const update: Record<string, unknown> = {};
  const registro: RegistroDeOT = {};
  const texto = (v: unknown) => String(v ?? "").trim() || null;

  if (body.estado !== undefined) {
    update.estado = body.estado;
    registro.estado = body.estado as string;
  }

  for (const campo of EN_LOS_DOS_LADOS) {
    if (body[campo] !== undefined) {
      update[campo] = texto(body[campo]);
      registro[campo] = update[campo] as string | null;
    }
  }

  for (const campo of SOLO_EN_LA_TABLA) {
    if (body[campo] !== undefined) update[campo] = texto(body[campo]);
  }

  if (body.horas !== undefined) {
    const n = Number(body.horas);
    const valor =
      body.horas === null || body.horas === "" || Number.isNaN(n) ? null : n;
    update.horas = valor;
    registro.horas = valor;
  }

  if (body.fecha_cierre !== undefined) {
    update.fecha_cierre = body.fecha_cierre || null;
    registro.fecha_cierre = update.fecha_cierre as string | null;
  }

  // Sólo a la planilla: no tienen columna en la tabla.
  if (body.observaciones !== undefined) registro.observaciones = texto(body.observaciones);
  if (body.foto_url !== undefined) registro.foto_url = texto(body.foto_url);

  return { update, registro };
}

/**
 * El valor de una celda. Puede depender de en qué fila va a caer.
 *
 * Existe por la columna del estado: lo que se escribe para una orden «por
 * hacer» es una fórmula que nombra a su propia fila —`=IF(J2276="","",L2276)`—
 * y esa fila no se conoce acá, sino recién cuando `escribirEnLaFilaDeLaOT`
 * busca la OT en el master. Una función es la forma de decir «esto lo completa
 * quien sepa la fila» sin que `celdasParaRegistrar` tenga que recibirla.
 */
export type ValorDeCelda = string | ((fila: number) => string);

/**
 * Qué va en la columna **M (ESTADO)** para un estado del sistema.
 *
 * ── POR QUÉ «POR HACER» ES UNA FÓRMULA Y NO UNA PALABRA ─────────────────────
 *
 * Hasta el 29/10/2026 el sistema **no escribía nada** cuando la orden estaba
 * por hacer, y el motivo que dejó escrito el código era que «la M trae
 * `=IF(J="","",L)` y escribirla la reemplazaría por un literal». **Ese motivo
 * era falso**, y medirlo lo dejó claro: la M no tiene fórmula de columna —de
 * sus 2.299 celdas, 2.291 son literales («Realizado») y sólo cinco sueltas
 * (M1266, M1269, M1368, M1682, M1770) llevan ese `=IF(...)`, puestas a mano de
 * a una—. La que sí es una fórmula de verdad es la **L**: una sola
 * `ARRAYFORMULA` en L3 que llena la columna entera.
 *
 * O sea que no escribir nada no dejaba la celda «calculándose»: la dejaba **en
 * blanco**. Al 29/10/2026 había ocho órdenes así —2838, 2843, 2896, 2897,
 * 2898, 2914, 2915 y 2928—, y dos de ellas ya mostraban «Atrasado» en la L con
 * el ESTADO vacío al lado. Para quien mira la planilla, una orden sin estado.
 *
 * La fórmula arregla las dos puntas: la celda dice lo que la L calcula y **se
 * actualiza sola** el día que la fecha se pasa, que es justo lo que el literal
 * no hace. Y tiene una ventaja que el literal tampoco tiene: como nombra a su
 * **propia** fila, sigue estando bien aunque el master se reordene —y se
 * reordena, por N° de OT desde el 16/10/2026—, porque lo que lee es el J y el
 * L que tenga al lado, sea de la orden que sea.
 *
 * Los demás estados van como palabra: «En proceso» y «Realizado» no se deducen
 * de una fecha, así que ahí la L no sabe nada y la fórmula mentiría.
 */
export function celdaDeEstado(estado: string | null | undefined, fila: number): string {
  if (!estado) return "";
  if (estado === "POR_HACER") return `=IF(J${fila}="","",L${fila})`;
  return EN_LA_PLANILLA[estado] ?? estado;
}

/**
 * Qué celdas hay que escribir en la planilla al registrar el trabajo.
 *
 * Sólo las que se pasaron: la planilla es la fuente y no se toca lo que nadie
 * cambió. Pasar un campo en `null` **sí** lo vacía —es "sacá lo que había"—,
 * que es distinto de no pasarlo.
 *
 * La columna L no se escribe nunca: es la fórmula que calcula atrasado/al día.
 *
 * Los cinco campos que tipea una persona —el contratista, los tres operarios y
 * las observaciones— van por `textoParaLaCelda`. El estado sale de un
 * vocabulario cerrado, la fecha y las horas son número: ésos no se tocan,
 * porque prefijarlos los convertiría en texto y la planilla dejaría de poder
 * sumarlos. **Y el estado además puede ser una fórmula** —ver `celdaDeEstado`—,
 * que es otra razón para que no lo toque `textoParaLaCelda`: le pondría el
 * apóstrofo delante y la escribiría como texto.
 */
export function celdasParaRegistrar(
  registro: RegistroDeOT
): { letra: string; columna: number; valor: ValorDeCelda }[] {
  const celdas: { letra: string; columna: number; valor: ValorDeCelda }[] = [];

  const sumar = (columna: number, valor: ValorDeCelda) =>
    celdas.push({ letra: letra(columna), columna, valor });

  if (registro.estado !== undefined) {
    const v = registro.estado;
    sumar(COL.estado, (fila) => celdaDeEstado(v, fila));
  }
  if (registro.fecha_cierre !== undefined) {
    sumar(COL.fechaCierre, fechaParaLaPlanilla(registro.fecha_cierre));
  }
  if (registro.horas !== undefined) {
    sumar(COL.horas, registro.horas === null ? "" : String(registro.horas));
  }
  if (registro.contratista !== undefined) {
    sumar(COL.contratista, textoParaLaCelda(registro.contratista));
  }
  if (registro.operario_1 !== undefined) sumar(COL.operario1, textoParaLaCelda(registro.operario_1));
  if (registro.operario_2 !== undefined) sumar(COL.operario2, textoParaLaCelda(registro.operario_2));
  if (registro.operario_3 !== undefined) sumar(COL.operario3, textoParaLaCelda(registro.operario_3));
  if (registro.foto_url !== undefined) sumar(COL.fotos, registro.foto_url ?? "");
  if (registro.observaciones !== undefined) {
    sumar(COL.observaciones, textoParaLaCelda(registro.observaciones));
  }

  return celdas;
}

/** Una fecha ISO como la escribe la planilla. */
function fechaParaLaPlanilla(iso: string | null | undefined): string {
  if (!iso) return "";
  const [a, m, d] = String(iso).slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

