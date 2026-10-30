import { norm } from "@/lib/core/texto";
import { esFechaIso } from "@/lib/core/fechas";
import { CRITERIOS, type Criterio } from "./riesgo";

/**
 * De una fila del Excel de condiciones inseguras (`21-10-26.xlsm`) a una fila de
 * `syh_condiciones`. Lo usa `scripts/importar-condiciones-del-excel.mts`, que se
 * corre una sola vez; todo lo que tiene decisiones vive acá para poder probarlo.
 *
 * LA REGLA QUE GOBIERNA TODO ESTE ARCHIVO es la del repo: **enlazar al que se le
 * parece es peor que dejar en null.** La planilla nombra los lugares y las
 * personas en texto libre; cuando no se los reconoce con certeza el enlace queda
 * vacío y se informa. Un enlace equivocado no se nota nunca —el dato aparece en
 * el lugar que no es—, y uno vacío se ve en el primer filtro.
 *
 * Por eso el enlace es una **igualdad** y no un «se parece»: sin contener, sin
 * distancia de edición, sin el nombre de pila solo. Lo único que se perdona es
 * lo que no cambia de qué se habla: mayúsculas, acentos, espacios de más y ceros
 * a la izquierda.
 */

export interface Sector {
  id: string;
  nombre: string;
  /** `null` o ausente cuenta como activo; sólo `false` descarta. */
  activo?: boolean | null;
}

export interface Persona {
  id: string;
  /** El nombre completo, con apellido: «Francisco Varela». */
  nombre: string;
}

/**
 * Para comparar dos nombres: sin acentos, en mayúsculas, con los espacios
 * normalizados, y **sin los ceros a la izquierda de un número** —«Planta 02» y
 * «Planta 2» son el mismo nombre escrito dos veces—.
 *
 * El `\b` es lo que impide que «Planta 10» pierda su cero, y el `(?=\d)` lo que
 * impide que «Planta 0-2 mm» pierda el suyo: un cero se quita sólo si lo sigue
 * otro dígito y no hay otra letra o número antes.
 */
function comparable(texto: string): string {
  return norm(texto).replace(/\b0+(?=\d)/g, "");
}

/**
 * Los nombres con los que la planilla llama a un sector del catálogo y que el
 * propio repo documenta como **el mismo sector**.
 *
 * `scripts/sectores-de-la-ot.mts` renombró el 19/10/2026 «Filler 1», «Filler 2»
 * y «Filler 3» a «Planta filler 1/2/3» —nombres largos, los del formulario de
 * Mantenimiento— y deja escrito que eran los mismos. Es la única tabla de
 * alias, y es corta a propósito: cada línea es un enlace que alguien tuvo que
 * poder justificar con algo que no sea que se parecen.
 *
 * **Lo que NO está acá importa más.** «Planta 02» fue, hasta ese mismo
 * renombre, el nombre de lo que hoy es «Planta 0-2 mm». Un alias por nombre
 * viejo la habría mandado a ese sector, y la planilla no habla de él: habla de
 * «Planta 2», «Planta 02» y «Planta 3», la serie de las plantas de trituración
 * (mandíbula, zaranda, cintas). El mismo texto es el nombre viejo de un sector
 * y el nombre corto de otro, y ninguna regla lo decide: queda en null y lo
 * resuelve una persona.
 */
const ALIAS_DE_SECTOR: Record<string, string> = {
  [comparable("Filler 1")]: "Planta filler 1",
  [comparable("Filler 2")]: "Planta filler 2",
  [comparable("Filler 3")]: "Planta filler 3",
};

/**
 * Los nombres de personas que la planilla escribe distinto del que tiene su
 * cuenta, **revisados uno por uno**.
 *
 * - «Maxi Lenzetti» → «Maximiliano Lenzetti»: «Maxi» es el diminutivo, el
 *   apellido es el mismo y la cuenta es `maximilianolenzetti@`. Hay otro
 *   Lenzetti en el catálogo, Nicolas, y es por eso que el apellido solo no
 *   alcanza para enlazar.
 *
 * «Pedro Arias» no está porque no tiene cuenta: no es un usuario del sistema.
 * La tabla se resuelve contra el catálogo por nombre y no lleva ids.
 */
const ALIAS_DE_PERSONA: Record<string, string> = {
  [comparable("Maxi Lenzetti")]: "Maximiliano Lenzetti",
};

/** El id de la única coincidencia, o `null` si no hay ninguna o hay más de una. */
function unicoPorNombre<T extends { id: string; nombre: string }>(
  buscado: string,
  candidatos: T[]
): string | null {
  const coinciden = candidatos.filter((c) => comparable(c.nombre) === buscado);
  return coinciden.length === 1 ? coinciden[0].id : null;
}

/**
 * El sector del catálogo que nombra la planilla, o `null`.
 *
 * Con dos activos del mismo nombre tampoco elige: elegir uno es una decisión que
 * la función no tiene con qué tomar. Los dados de baja no se miran —«Calidad» y
 * «Administración» tienen cada uno dos filas viejas—.
 */
export function sectorDe(texto: string, catalogo: Sector[]): string | null {
  const buscado = comparable(texto);
  if (!buscado) return null;

  const vigentes = catalogo.filter((s) => s.activo !== false);

  // Primero el nombre tal cual: si el catálogo tiene un sector que se llama
  // «Filler 1», el alias no tiene nada que hacer.
  const exacto = unicoPorNombre(buscado, vigentes);
  if (exacto) return exacto;

  const alias = ALIAS_DE_SECTOR[buscado];
  return alias ? unicoPorNombre(comparable(alias), vigentes) : null;
}

/**
 * El usuario que nombra la planilla, o `null`.
 *
 * Es el nombre **y** el apellido: el nombre de pila solo no enlaza, porque hay
 * dos Nicolas, y el apellido solo tampoco, porque hay dos Lenzetti.
 */
export function personaDe(texto: string, usuarios: Persona[]): string | null {
  const buscado = comparable(texto);
  if (!buscado) return null;

  const exacto = unicoPorNombre(buscado, usuarios);
  if (exacto) return exacto;

  const alias = ALIAS_DE_PERSONA[buscado];
  return alias ? unicoPorNombre(comparable(alias), usuarios) : null;
}

/** Una fila de la hoja `CI Operativas`, como la entrega el lector de Python. */
export interface FilaDelExcel {
  /** El número de fila en la hoja, para los mensajes. */
  fila: number;
  numero: number | null;
  lugar: string | null;
  detectada: string | null;
  descripcion: string | null;
  /** La columna «Motivo o herramienta de detección», que trae un nombre de persona. */
  detecto: string | null;
  accion: string | null;
  responsable: string | null;
  fecha_maxima: string | null;
  fecha_ejecucion: string | null;
  prioridad: number | null;
  /** La columna K, que es una fórmula: sirve para contrastar, no para importar. */
  estado: string | null;
  requiere_inversion: string | null;
  observaciones: string | null;
  frecuencia: number | null;
  antecedentes: number | null;
  controles: number | null;
  magnitud_dano: number | null;
  legislacion: number | null;
  /** La columna del nivel que la planilla calculó, para contrastar con el de la base. */
  nivel: number | null;
  /** Lo que dicen las columnas de fotos: nombres de archivo, no archivos. */
  fotos: string[];
}

/** Lo que se inserta. Sin `id`, sin `creada_en` y sin las tres columnas generadas. */
export interface CondicionAInsertar {
  numero: number;
  clave: string;
  sector_id: string | null;
  equipo_id: string | null;
  detectada_el: string;
  detectada_por: string | null;
  descripcion: string;
  peligro_id: string | null;
  accion_propuesta: string | null;
  prioridad: number | null;
  responsable_id: string | null;
  fecha_maxima: string | null;
  fecha_ejecucion: string | null;
  requiere_inversion: boolean | null;
  observaciones: string | null;
  frecuencia: number | null;
  antecedentes: number | null;
  controles: number | null;
  magnitud_dano: number | null;
  legislacion: number | null;
}

export type ResultadoDeLaFila =
  | {
      ok: true;
      condicion: CondicionAInsertar;
      /** Cosas que no cierran y que se importaron igual; se informan. */
      avisos: string[];
      /** El texto de la planilla cuando no se pudo enlazar; `null` si se enlazó o venía vacío. */
      lugarSinEnlazar: string | null;
      responsableSinEnlazar: string | null;
    }
  | { ok: false; motivo: string };

/** La clave que hace idempotente la corrida: la segunda no inserta lo que la primera ya metió. */
export const clavePorNumero = (numero: number) => `excel-21-10-26-${numero}`;

const texto = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
};

const CRITERIOS_EN_ORDEN: Criterio[] = ["frecuencia", "antecedentes", "controles", "magnitud_dano", "legislacion"];

/**
 * Arma la fila de `syh_condiciones` desde la del Excel, o dice por qué no puede.
 *
 * **Rechazar y no corregir**: una fila con un puntaje fuera de la escala, con
 * una evaluación a medias o sin descripción hace fallar a la importación entera
 * antes de escribir nada. La alternativa —que Postgres rebote el lote por un
 * `check`— corta igual, pero con un mensaje que no dice qué fila fue.
 *
 * Las fechas que no cierran entre sí (una detección en el futuro, una ejecución
 * anterior a la detección) **se importan tal cual y se avisan**. Son el tipo de
 * error que se corrige con el dato en la mano —¿es 13/10 o 13/11?— y no con una
 * regla; arreglarlo acá sería escribir en la base lo que alguien supone.
 */
export function condicionDeLaFila(
  f: FilaDelExcel,
  enlaces: { sectores: Sector[]; usuarios: Persona[]; hoy: string }
): ResultadoDeLaFila {
  const donde = `Fila ${f.fila}`;

  if (f.numero === null || !Number.isInteger(f.numero) || f.numero < 1) {
    return { ok: false, motivo: `${donde}: no tiene N° de condición` };
  }
  const descripcion = texto(f.descripcion);
  if (!descripcion) return { ok: false, motivo: `${donde} (N° ${f.numero}): no tiene descripción` };
  if (!esFechaIso(f.detectada)) {
    return { ok: false, motivo: `${donde} (N° ${f.numero}): la fecha de detección no es una fecha («${f.detectada ?? ""}»)` };
  }
  for (const [nombre, valor] of [["fecha máxima", f.fecha_maxima], ["fecha de ejecución", f.fecha_ejecucion]] as const) {
    if (valor !== null && !esFechaIso(valor)) {
      return { ok: false, motivo: `${donde} (N° ${f.numero}): la ${nombre} no es una fecha («${valor}»)` };
    }
  }
  if (f.prioridad !== null && ![1, 2, 3].includes(f.prioridad)) {
    return { ok: false, motivo: `${donde} (N° ${f.numero}): la prioridad ${f.prioridad} no es 1, 2 ni 3` };
  }

  // Los cinco puntajes, o ninguno.
  const puntajes = CRITERIOS_EN_ORDEN.map((c) => f[c]);
  const cargados = puntajes.filter((p) => p !== null).length;
  if (cargados !== 0 && cargados !== 5) {
    return {
      ok: false,
      motivo: `${donde} (N° ${f.numero}): tiene ${cargados} de los 5 puntajes; una evaluación a medias no se importa`,
    };
  }
  for (const c of CRITERIOS_EN_ORDEN) {
    const valor = f[c];
    if (valor !== null && !CRITERIOS[c].some((o) => o.puntos === valor)) {
      return { ok: false, motivo: `${donde} (N° ${f.numero}): ${c} = ${valor} no está en la escala` };
    }
  }

  const avisos: string[] = [];

  if (f.detectada > enlaces.hoy) {
    avisos.push(`detección con fecha futura (${f.detectada}; hoy es ${enlaces.hoy})`);
  }
  if (f.fecha_maxima && f.fecha_maxima < f.detectada) {
    avisos.push(`la fecha máxima (${f.fecha_maxima}) es anterior a la detección (${f.detectada})`);
  }
  if (f.fecha_ejecucion && f.fecha_ejecucion < f.detectada) {
    avisos.push(`la fecha de ejecución (${f.fecha_ejecucion}) es anterior a la detección (${f.detectada})`);
  }

  // «Vencida» no se compara: es una fórmula sobre la fecha máxima, no algo que se cargue.
  const estado = comparable(f.estado ?? "");
  if (f.fecha_ejecucion && estado && estado !== "CERRADO") {
    avisos.push(`el estado de la planilla dice «${f.estado}» pero tiene fecha de ejecución`);
  }
  if (!f.fecha_ejecucion && estado === "CERRADO") {
    avisos.push("el estado de la planilla dice «Cerrado» pero no tiene fecha de ejecución");
  }

  if (cargados === 5 && f.nivel !== null) {
    const [fr, an, co, ma, le] = puntajes as number[];
    const calculado = (fr + an + co) * (ma + le);
    if (calculado !== f.nivel) {
      avisos.push(`el nivel de la planilla (${f.nivel}) no es el de los puntajes (${calculado})`);
    }
  }

  const lugar = texto(f.lugar);
  const sector_id = lugar ? sectorDe(lugar, enlaces.sectores) : null;

  const quien = texto(f.responsable);
  const responsable_id = quien ? personaDe(quien, enlaces.usuarios) : null;

  // Quién lo detectó: si es un usuario, queda en `detectada_por`. Si no —en las
  // 44 filas del Excel es alguien sin cuenta—, el nombre se conserva en las
  // observaciones: dejarlo caer perdería el único dato de origen que tiene la
  // condición, y enlazarlo a otro usuario sería inventar uno.
  const detecto = texto(f.detecto);
  const detectada_por = detecto ? personaDe(detecto, enlaces.usuarios) : null;
  const lineaDeOrigen = detecto && !detectada_por ? `Detectó: ${detecto} (planilla 21-10-26).` : null;
  const observacionesOriginales = texto(f.observaciones);
  const observaciones =
    [observacionesOriginales, lineaDeOrigen].filter((x): x is string => x !== null).join("\n") || null;

  const inversion = comparable(f.requiere_inversion ?? "");
  let requiere_inversion: boolean | null = null;
  if (inversion === "SI") requiere_inversion = true;
  else if (inversion === "NO") requiere_inversion = false;
  else if (inversion) avisos.push(`«Requiere inversión» dice «${f.requiere_inversion}» y no se pudo leer como sí o no`);

  return {
    ok: true,
    condicion: {
      numero: f.numero,
      clave: clavePorNumero(f.numero),
      sector_id,
      equipo_id: null,
      detectada_el: f.detectada,
      detectada_por,
      descripcion,
      // La planilla no tiene esta columna: el peligro está escrito adentro de la
      // descripción («riesgo de atrapamiento»), y deducirlo con una búsqueda de
      // texto es exactamente el enlace al que se le parece.
      peligro_id: null,
      accion_propuesta: texto(f.accion),
      prioridad: f.prioridad,
      responsable_id,
      fecha_maxima: f.fecha_maxima,
      fecha_ejecucion: f.fecha_ejecucion,
      requiere_inversion,
      observaciones,
      frecuencia: f.frecuencia,
      antecedentes: f.antecedentes,
      controles: f.controles,
      magnitud_dano: f.magnitud_dano,
      legislacion: f.legislacion,
    },
    avisos,
    lugarSinEnlazar: lugar && !sector_id ? lugar : null,
    responsableSinEnlazar: quien && !responsable_id ? quien : null,
  };
}
