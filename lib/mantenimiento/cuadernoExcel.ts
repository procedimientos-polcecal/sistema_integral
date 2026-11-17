import { leerNumeroDelCampo } from "./cuadernoNumero";
import { resolverFecha } from "./cuadernoLectura";
import { normalizarLugar } from "./partesDeContratista";

/**
 * El Excel del contratista, leído: una fila es una tarea, y una tarea es una OT.
 *
 * Es una **alternativa a las fotos** y no un reemplazo. Todo lo que viene
 * después —enganche a sector y equipo, la pantalla, juntar y separar a mano, el
 * freno de duplicados, la generación— es el mismo; lo único nuevo es leer el
 * archivo.
 *
 * Es puro: recibe las filas **ya leídas** (`FilaDelExcel`) y no abre ningún
 * archivo. Abrirlo es de `cuadernoExcelArchivo.ts`, y esta separación es lo que
 * deja probar todo sin armar un `.xlsx`.
 *
 * ── LAS CINCO COLUMNAS, Y POR QUÉ SE BUSCAN POR NOMBRE ──
 *
 * `Tarea · Fecha Desde · Fecha Hasta · Hs · Precio ($)`
 *
 * **Se buscan por el texto del encabezado y no por la letra de la columna.**
 * Esto no es comodidad: el 02/11/2026 el mismo contenido vivía en `K` a `O`
 * —era el resumen de la derecha de una planilla con dos mitades— y el 03/11
 * pasó a `A` a `E` al quedar la tabla sola. Leer por letra significa que mover
 * la tabla una columna rompe la carga sin decir por qué, y que quien arma el
 * archivo tiene que saber en qué columna va cada cosa. Leer por nombre deja que
 * el encabezado sea el contrato, que es lo que la persona ve.
 *
 * `Tarea` y `Hs` son las únicas obligatorias: sin tarea no hay qué hacer y sin
 * horas no hay qué cargarle a la OT. `Fecha Desde`, `Fecha Hasta` y
 * `Precio ($)` entran si están, y si no están se dice.
 *
 * ── LO QUE ANTES ERA UN GRUPO ──
 *
 * Hasta el 02/11/2026 el archivo traía el detalle día por día a la izquierda y
 * un resumen a la derecha cuyas fórmulas (`=C47+C50+C51`) decían qué renglones
 * iban juntos en una OT. Ese resumen **es ahora la tabla entera**: quien arma el
 * archivo ya hizo la consolidación, así que **cada fila es una orden** y no hay
 * nada que agrupar. El rango de días, que antes salía de los renglones que la
 * fórmula juntaba, ahora lo dicen `Fecha Desde` y `Fecha Hasta`.
 *
 * ── EL CONTROL: LA FILA DE TOTALES ──
 *
 * Al desaparecer el detalle desaparece la comprobación de «las horas del
 * resumen dan las del detalle», que era la defensa contra una fórmula mal
 * escrita. Lo que queda, y por eso se usa, es la **fila de TOTALES**: su número
 * de horas tiene que dar la suma de las filas. Medido sobre el archivo real,
 * ese total está **escrito a mano** y no es una fórmula, así que comparar no es
 * redundante — es exactamente lo que detecta una fila tipeada de más, una de
 * menos, o un número con un dígito cambiado.
 *
 * **Si no cierra, los renglones entran igual.** No hay nada que retener: la
 * tabla *es* el dato, no hay grupos que armar sobre una cuenta que no da. Lo
 * que se hace es decirlo fuerte, con los dos números y la diferencia.
 *
 * NADA SE TIRA EN SILENCIO. Una fila que no se entiende entra marcada `dudoso`
 * con su motivo —la fecha ilegible queda en null, no se descarta—, y lo que no
 * puede entrar (una fila con horas y sin tarea) queda dicho en `problemas` con
 * su número de fila.
 */

// ─── Lo que entra: filas ya leídas ───────────────────────────────────────────

/** El valor de una celda, aplanado por quien abrió el archivo. */
export type ValorDeCelda = string | number | boolean | Date | null | undefined;

/**
 * Lo que trae una celda: un valor, un error de Excel (`#REF!`) o una fórmula con
 * su resultado. `resultado` es `undefined` cuando el archivo no lo calculó.
 */
export type CeldaDelExcel =
  | ValorDeCelda
  | { error: string }
  | { formula: string; resultado?: ValorDeCelda | { error: string } };

/** Una fila del Excel: su número (desde 1) y sus celdas por letra de columna. */
export type FilaDelExcel = { fila: number; celdas: Record<string, CeldaDelExcel> };

// ─── Lo que sale ─────────────────────────────────────────────────────────────

/** Qué letra de columna resultó ser cada cosa. Null si esa columna no está. */
export type ColumnasDelExcel = {
  tarea: string;
  desde: string | null;
  hasta: string | null;
  horas: string;
  precio: string | null;
};

export type RenglonDelExcel = {
  /** El número de fila del Excel: va a `linea` y es la única forma de volver a la planilla. */
  fila: number;
  tarea: string;
  /** El primer día. Null si la celda no se pudo leer; entonces el renglón es dudoso. */
  desde: string | null;
  /** El último día. Igual a `desde` cuando la tarea fue de un solo día. */
  hasta: string | null;
  horas: number | null;
  costo: number | null;
  dudoso: boolean;
  motivo_dudoso: string | null;
};

export type ControlDelExcel = {
  /** El archivo trae una fila de TOTALES con un número de horas legible. */
  hay_total: boolean;
  /** La suma de las filas da el total declarado. Verdadero también si no hay total que comparar. */
  cierra: boolean;
  horas_filas: number;
  /** Lo que dice la fila de TOTALES; null si no hay. */
  horas_total: number | null;
  /** Total menos suma: negativo si el total declara de menos. */
  diferencia: number;
  costo_filas: number;
  /** Cada cosa que no cierra, con su fila. Vacío cuando cierra. */
  problemas: string[];
};

export type LecturaDelExcel =
  | {
      ok: true;
      /** Qué columna resultó ser cada cosa: es lo que se le muestra a quien cargó. */
      columnas: ColumnasDelExcel;
      renglones: RenglonDelExcel[];
      control: ControlDelExcel;
      /** Todo lo que hay que decirle a quien carga, en orden y con sus filas. */
      problemas: string[];
    }
  | { ok: false; error: string };

// ─── Lo chico ────────────────────────────────────────────────────────────────

/** Hasta qué fila se busca el encabezado: un título arriba es normal, diez no. */
const FILAS_PARA_EL_ENCABEZADO = 10;

/** Menos que esto no es una diferencia de horas: es coma flotante. */
const TOLERANCIA = 0.005;

/**
 * Más horas que éstas en una sola fila no es un dato: es un dígito de más.
 *
 * Medido el 03/11/2026 sobre el archivo real de octubre: 63 filas, 1074 horas,
 * y la más grande es **106** —una tarea que duró del 24 al 31—. El error
 * probable tipeando es el dígito extra (106 → 1060), y 500 lo atrapa dejando
 * casi cinco veces el máximo visto de margen. **Sólo marca dudoso**: una obra
 * larga de verdad tiene que poder entrar.
 *
 * No es el mismo número que `TOPE_DE_HORAS_POR_RENGLON` de `cuadernoLectura`
 * (200) y no tiene por qué serlo: allá una fila es **un renglón de un día** del
 * cuaderno manuscrito, acá es **una tarea entera a lo largo del mes**.
 */
export const TOPE_DE_HORAS_POR_FILA = 500;

const redondear = (n: number) => Math.round(n * 100) / 100;
const verHoras = (n: number) => String(redondear(n)).replace(".", ",");

type Vista = { valor: Exclude<ValorDeCelda, undefined>; error: string | null; formula: string | null };

/** Lo que una celda dice, sea un valor, un error o una fórmula con su resultado. */
function ver(c: CeldaDelExcel): Vista {
  if (c === null || c === undefined) return { valor: null, error: null, formula: null };
  if (c instanceof Date || typeof c !== "object") return { valor: c, error: null, formula: null };
  if ("formula" in c) {
    const r = c.resultado;
    if (r !== null && r !== undefined && typeof r === "object" && !(r instanceof Date)) {
      return { valor: null, error: r.error, formula: c.formula };
    }
    return { valor: r ?? null, error: null, formula: c.formula };
  }
  return { valor: null, error: c.error, formula: null };
}

/** El texto de una celda, recortado. Vacío si no es texto ni número. */
function textoDe(c: CeldaDelExcel): string {
  const { valor } = ver(c);
  if (typeof valor === "string") return valor.trim();
  if (typeof valor === "number" && Number.isFinite(valor)) return String(valor);
  return "";
}

/** Una celda sin nada: ni valor, ni error, ni fórmula. */
function estaVacia(c: CeldaDelExcel): boolean {
  const v = ver(c);
  if (v.error || v.formula) return false;
  return v.valor === null || (typeof v.valor === "string" && v.valor.trim() === "");
}

const norm = (c: CeldaDelExcel) => normalizarLugar(textoDe(c));

const ETIQUETA_DE_TOTAL = /^(sub)?total(es)?( general(es)?)?$/;

// ─── El encabezado: qué columna es cada cosa ─────────────────────────────────

/**
 * Qué papel cumple un encabezado. El orden importa: `fecha desde` tiene que
 * probarse antes que `fecha` a secas, y `tarea / descripción` antes que nada
 * que empiece con «descripción».
 */
const PAPELES: Array<{ papel: keyof ColumnasDelExcel; es: RegExp }> = [
  { papel: "desde", es: /^(fecha\s*)?desde\b|^fecha\s+de\s+inicio|^inicio$/ },
  { papel: "hasta", es: /^(fecha\s*)?hasta\b|^fecha\s+de\s+fin|^fin$/ },
  { papel: "tarea", es: /^(tarea|descripcion|trabajo)\b|^(tarea|descripcion|trabajo)$/ },
  { papel: "horas", es: /^(hs|hrs|horas)\b|^(hs|hrs|horas)$/ },
  { papel: "precio", es: /^(precio|importe|costo|monto)\b|^(precio|importe|costo|monto)$/ },
  // Una sola columna de fecha es el día en que empieza: sin `hasta`, la tarea
  // fue de un día y el rango se colapsa solo.
  { papel: "desde", es: /^fecha$/ },
];

type Mapa = Partial<Record<keyof ColumnasDelExcel, string>>;

/** Qué columna es cada cosa en esta fila, si es que esta fila es el encabezado. */
function mapearColumnas(f: FilaDelExcel): Mapa {
  const mapa: Mapa = {};
  // Por letra de columna y no por el orden en que vinieron las celdas: si el
  // archivo trae dos columnas que podrían ser lo mismo, gana la de más a la
  // izquierda, que es la que la persona ve primero.
  for (const letra of Object.keys(f.celdas).sort()) {
    const titulo = norm(f.celdas[letra]);
    if (!titulo) continue;
    for (const { papel, es } of PAPELES) {
      if (mapa[papel] === undefined && es.test(titulo)) {
        mapa[papel] = letra;
        break;
      }
    }
  }
  return mapa;
}

/** Un encabezado sirve si dice dónde está la tarea y dónde las horas. */
const sirve = (m: Mapa): boolean => m.tarea !== undefined && m.horas !== undefined;

// ─── Una celda a número, a fecha ─────────────────────────────────────────────

type Leido<T> = { valor: T | null; motivo: string | null };

/**
 * Horas o precio de una celda. Un número es un número; un texto se lee con la
 * regla del campo (en horas la coma es decimal, en plata el punto es de miles:
 * mandarlo crudo a `Number()` daría 920 por «920.000»). Lo que no se puede leer
 * con certeza **no se adivina**: queda en null y con el motivo.
 */
function leerNumero(c: CeldaDelExcel, esDinero: boolean): Leido<number> {
  const quees = esDinero ? "el precio" : "las horas";
  const v = ver(c);
  const nombre = esDinero ? "El precio" : "Las horas";
  if (v.error) return { valor: null, motivo: `La celda de ${quees} tiene un error de Excel (${v.error})` };
  if (v.formula !== null && v.valor === null) {
    return { valor: null, motivo: `La celda de ${quees} es una fórmula sin valor calculado: guardá el archivo con Excel para que la calcule` };
  }
  const x = v.valor;
  if (x === null) return { valor: null, motivo: null };
  if (typeof x === "number") {
    if (!Number.isFinite(x)) return { valor: null, motivo: `${nombre} no es un número` };
    if (x < 0) return { valor: null, motivo: `${esDinero ? "El precio es negativo" : "Las horas son negativas"} (${x}) y no se tomó` };
    return { valor: x, motivo: null };
  }
  if (typeof x === "string") {
    const leido = leerNumeroDelCampo(x, esDinero);
    if (leido.tipo === "vacio") return { valor: null, motivo: null };
    if (leido.tipo === "invalido") return { valor: null, motivo: `No se pudo leer ${quees} «${x.trim()}»` };
    return { valor: leido.valor, motivo: null };
  }
  return { valor: null, motivo: `${nombre} no es un número` };
}

/** Lo que un Excel hace con las fechas: serie de días desde 1899-12-30. */
const SERIE_DEL_2000 = 36526;
const SERIE_DEL_2100 = 73415;

const ANIO_MINIMO = 2000;
const ANIO_MAXIMO = 2100;

const dosDigitos = (n: number) => String(n).padStart(2, "0");

function isoDeUTC(d: Date): string {
  return `${d.getUTCFullYear()}-${dosDigitos(d.getUTCMonth() + 1)}-${dosDigitos(d.getUTCDate())}`;
}

/**
 * La fecha de una celda: un `Date`, un número de serie de Excel, o un texto
 * día/mes/año (**nunca mes/día**: leerlo al revés dio vuelta 885 fechas en
 * Compras). Lo que no sea un día real queda en null y con el motivo.
 *
 * Un `Date` se lee por sus partes **UTC**: `exceljs` devuelve la fecha de una
 * celda como medianoche UTC, y leerla con el huso local la corre un día en
 * cualquier máquina al oeste de Greenwich.
 */
function leerFecha(c: CeldaDelExcel, cual: string): Leido<string> {
  const v = ver(c);
  if (v.error) return { valor: null, motivo: `La celda de ${cual} tiene un error de Excel (${v.error})` };
  if (v.formula !== null && v.valor === null) {
    return { valor: null, motivo: `La celda de ${cual} es una fórmula sin valor calculado: guardá el archivo con Excel para que la calcule` };
  }
  const x = v.valor;
  if (x === null || (typeof x === "string" && x.trim() === "")) return { valor: null, motivo: `No trae ${cual}` };

  const razonable = (iso: string, dicho: string): Leido<string> => {
    const anio = Number(iso.slice(0, 4));
    return anio >= ANIO_MINIMO && anio <= ANIO_MAXIMO
      ? { valor: iso, motivo: null }
      : { valor: null, motivo: `La ${cual} «${dicho}» no es razonable (año ${anio})` };
  };

  if (x instanceof Date) {
    if (Number.isNaN(x.getTime())) return { valor: null, motivo: `La ${cual} no es un día real` };
    return razonable(isoDeUTC(x), isoDeUTC(x));
  }
  if (typeof x === "number") {
    if (x >= SERIE_DEL_2000 && x <= SERIE_DEL_2100) {
      return { valor: isoDeUTC(new Date(Math.round((Math.floor(x) - 25569) * 86400000))), motivo: null };
    }
    return { valor: null, motivo: `El número ${x} no es una ${cual}` };
  }
  if (typeof x === "string") {
    // Un ISO con hora («2026-10-06T00:00:00.000Z») es el día de adelante si se
    // parte por la T mal; se corta antes de resolverlo.
    const t = x.trim().replace(/T.*$/, "");
    const iso = resolverFecha(t, "");
    return iso ? razonable(iso, t) : { valor: null, motivo: `La ${cual} «${t}» no es un día real` };
  }
  return { valor: null, motivo: `La ${cual} no es un día real` };
}

// ─── La lectura ──────────────────────────────────────────────────────────────

const soloFecha = (f: string) => f.split("-").reverse().map(Number).join("/");

export function interpretarExcel(filasCrudas: readonly FilaDelExcel[]): LecturaDelExcel {
  const filas = [...filasCrudas].sort((a, b) => a.fila - b.fila);
  const problemas: string[] = [];

  // ── El encabezado ──
  let encabezado: FilaDelExcel | null = null;
  let mapa: Mapa = {};
  for (const f of filas) {
    if (f.fila > FILAS_PARA_EL_ENCABEZADO) break;
    const m = mapearColumnas(f);
    if (sirve(m)) { encabezado = f; mapa = m; break; }
  }

  if (!encabezado) {
    const primera = filas[0];
    const quedice = primera
      ? `La primera fila con algo (la ${primera.fila}) dice: ${Object.keys(primera.celdas).sort()
          .map((l) => `${l}: «${textoDe(primera.celdas[l])}»`).join(", ")}.`
      : "El archivo no tiene ninguna fila con datos.";
    return {
      ok: false,
      error:
        `No se reconoció la planilla. Tiene que tener una fila de encabezado con una columna «Tarea» y ` +
        `una columna «Hs», en cualquier orden y en cualquier columna. ${quedice}`,
    };
  }

  const columnas: ColumnasDelExcel = {
    tarea: mapa.tarea!,
    desde: mapa.desde ?? null,
    hasta: mapa.hasta ?? null,
    horas: mapa.horas!,
    precio: mapa.precio ?? null,
  };

  if (!columnas.desde && !columnas.hasta) {
    problemas.push(
      "La planilla no trae ninguna columna de fecha («Fecha Desde» / «Fecha Hasta»): los renglones entran " +
      "sin fecha y no se van a poder generar las órdenes hasta que se las pongas."
    );
  }
  if (!columnas.precio) {
    problemas.push("La planilla no trae columna de precio: las órdenes salen sólo con horas.");
  }

  // ── Las filas ──
  const renglones: RenglonDelExcel[] = [];
  let horasDelTotal: number | null = null;
  let filaDelTotal: number | null = null;

  for (const f of filas) {
    if (f.fila <= encabezado.fila) continue;

    const tarea = textoDe(f.celdas[columnas.tarea]).trim();

    // La fila de TOTALES no es una tarea: es el control.
    if (ETIQUETA_DE_TOTAL.test(normalizarLugar(tarea))) {
      const { valor, motivo } = leerNumero(f.celdas[columnas.horas], false);
      filaDelTotal = f.fila;
      if (valor !== null) horasDelTotal = valor;
      else if (motivo) problemas.push(`La fila ${f.fila} dice TOTALES pero sus horas no se pudieron leer: ${motivo}.`);
      continue;
    }

    const usadas = [columnas.tarea, columnas.desde, columnas.hasta, columnas.horas, columnas.precio]
      .filter((l): l is string => !!l);

    if (!tarea) {
      // Una fila en blanco se saltea sin decir nada; una con datos y sin tarea
      // no se puede cargar, y eso sí se dice: son horas que se perderían.
      if (usadas.some((l) => !estaVacia(f.celdas[l]))) {
        problemas.push(`La fila ${f.fila} tiene datos pero no dice qué tarea es, así que no se cargó.`);
      }
      continue;
    }

    const motivos: string[] = [];

    const leerSiHay = (letra: string | null, cual: string): string | null => {
      if (!letra) return null;
      const { valor, motivo } = leerFecha(f.celdas[letra], cual);
      // «No trae fecha» no es un motivo que valga la pena cuando la otra punta
      // sí está: una tarea de un día suele llevar sólo una de las dos.
      if (motivo && !/^No trae /.test(motivo)) motivos.push(motivo);
      return valor;
    };

    let desde = leerSiHay(columnas.desde, "fecha desde");
    let hasta = leerSiHay(columnas.hasta, "fecha hasta");

    // Una sola punta alcanza: la tarea fue de un día, o la otra celda está
    // rota. No se inventa nada — se usa la que hay para las dos.
    if (desde && !hasta) hasta = desde;
    else if (hasta && !desde) desde = hasta;
    else if (desde && hasta && hasta < desde) {
      motivos.push(`La fecha hasta (${soloFecha(hasta)}) es anterior a la desde (${soloFecha(desde)})`);
    }

    if (!desde && !hasta && (columnas.desde || columnas.hasta)) {
      motivos.push("No trae ninguna fecha");
    }

    const horas = leerNumero(f.celdas[columnas.horas], false);
    if (horas.motivo) motivos.push(horas.motivo);
    if (horas.valor !== null && horas.valor > TOPE_DE_HORAS_POR_FILA) {
      motivos.push(`${verHoras(horas.valor)} h en una sola tarea es más de lo que suele entrar: revisalo`);
    }

    const costo = columnas.precio ? leerNumero(f.celdas[columnas.precio], true) : { valor: null, motivo: null };
    if (costo.motivo) motivos.push(costo.motivo);

    if (horas.valor === null && costo.valor === null) {
      motivos.push("No trae ni horas ni precio");
    }

    renglones.push({
      fila: f.fila,
      tarea,
      desde,
      hasta,
      horas: horas.valor,
      costo: costo.valor,
      dudoso: motivos.length > 0,
      motivo_dudoso: motivos.length > 0 ? `${motivos.join(". ")}.` : null,
    });
  }

  // ── El control ──
  const horas_filas = redondear(renglones.reduce((s, r) => s + (r.horas ?? 0), 0));
  const costo_filas = redondear(renglones.reduce((s, r) => s + (r.costo ?? 0), 0));
  const hay_total = horasDelTotal !== null;
  const diferencia = hay_total ? redondear(horasDelTotal! - horas_filas) : 0;
  const delControl: string[] = [];

  if (!hay_total) {
    delControl.push(
      "La planilla no trae fila de TOTALES, así que no hay contra qué comparar la suma de las horas. " +
      `Las ${renglones.length} filas suman ${verHoras(horas_filas)} h.`
    );
  } else if (Math.abs(diferencia) > TOLERANCIA) {
    delControl.push(
      `Las horas de las filas (${verHoras(horas_filas)}) no dan el total declarado en la fila ` +
      `${filaDelTotal} (${verHoras(horasDelTotal!)}): ` +
      (diferencia > 0
        ? `faltan ${verHoras(diferencia)} h entre las filas.`
        : `sobran ${verHoras(-diferencia)} h entre las filas.`) +
      " Los renglones se cargaron igual: revisá cuál fila está de más o de menos."
    );
  }

  const cierra = !hay_total || Math.abs(diferencia) <= TOLERANCIA;

  return {
    ok: true,
    columnas,
    renglones,
    control: {
      hay_total,
      cierra,
      horas_filas,
      horas_total: horasDelTotal,
      diferencia,
      costo_filas,
      problemas: delControl,
    },
    problemas: [...delControl, ...problemas],
  };
}
