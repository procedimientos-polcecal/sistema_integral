import { leerNumeroDelCampo } from "./cuadernoNumero";
import { resolverFecha, TOPE_DE_HORAS_POR_RENGLON } from "./cuadernoLectura";
import { normalizarLugar } from "./partesDeContratista";

/**
 * El Excel del cuaderno de PIPARO, leído: renglones, grupos y un control.
 *
 * Es una **alternativa a las fotos** y no un reemplazo. Todo lo que viene
 * después —enganche a sector y equipo, la pantalla, juntar y separar, el freno
 * de duplicados, la generación— es el mismo; lo único nuevo es leer el archivo.
 *
 * Es puro: recibe las filas **ya leídas** (`FilaDelExcel`) y no abre ningún
 * archivo. Abrirlo es de `cuadernoExcelArchivo.ts`, y esta separación es lo que
 * deja probar todo sin armar un `.xlsx`.
 *
 * LA FORMA DEL ARCHIVO, MEDIDA el 02/11/2026 sobre `Tareas_Octubre_2026.xlsx`
 * (una hoja, 99 filas):
 *
 * - **Izquierda, el detalle**: `A` fecha, `B` tarea, `C` horas, `D` precio.
 *   97 renglones. La última fila es `TOTALES` con `=SUM(C2:C98)`.
 * - **Derecha, el resumen**: `K` tarea, `L` desde, `M` hasta, `N` horas, `O`
 *   precio. 63 grupos. La celda de `N` es una **fórmula** como `=C47+C50+C51`
 *   que dice **qué renglones del detalle van juntos**: eso es exactamente un
 *   grupo, o sea una OT. La última fila del resumen también es `TOTALES`, con
 *   `=SUM(N2:N65)` y ninguna referencia a `C`, y no es un grupo.
 *
 * LO QUE NO SE LEE DEL RESUMEN: `O`, el precio. El precio de cada renglón sale
 * del detalle (`D`) y la OT suma el de sus renglones; lo que diga `O` no entra a
 * ninguna cuenta, y leerlo sólo agregaría una segunda fuente para el mismo dato.
 *
 * EL CONTROL, que es la defensa contra una fórmula mal escrita
 *
 * El criterio es de quien pidió esto: **las horas del resumen tienen que dar las
 * del detalle**, sin renglones contados dos veces ni renglones sin cubrir. Si
 * cierra, se arman los grupos. Si no cierra, **el archivo se carga igual** —los
 * renglones entran— pero **no se arman los grupos**, y se dice con el número de
 * fila qué pasó. Nunca se arma un grupo sobre una cuenta que no da: una fórmula
 * que apunta una fila más abajo junta dos tareas que no tienen nada que ver y
 * las horas van a la OT equivocada sin que nadie lo note.
 *
 * Tres decisiones que no se deducen del código:
 *
 * - **«Sin cubrir» es un renglón con horas que ningún grupo toma.** Uno que
 *   sólo trae precio (un empalme, un parche: se cobran por trabajo y no por
 *   hora) y no está en el resumen **no es un error**: no tiene horas que se
 *   pierdan, y sale como su propia orden. Lo que sí es error es que un renglón
 *   esté en dos grupos.
 * - **Apuntar a una celda de horas en blanco no es apuntar a una celda vacía si
 *   el renglón trae precio.** Una plantilla que escribe `=C7` para el empalme
 *   aunque sus horas estén en blanco no se equivoca: el renglón existe. Vacía es
 *   una fila sin renglón, el encabezado, el total, o un renglón sin horas ni
 *   precio.
 * - **Se compara también lo que dice la celda de `N` contra lo que suman sus
 *   referencias.** Una fórmula con un término de más (`=C4+C6+2`) o un valor
 *   viejo que Excel no recalculó no se ve mirando las referencias. Si la celda no
 *   tiene valor calculado (un archivo que no guardó Excel) no se compara: mandan
 *   las referencias, que son lo que dice qué se junta.
 *
 * NADA SE TIRA EN SILENCIO. Un renglón que no se entiende entra marcado
 * `dudoso` con su motivo —la fecha ilegible queda en null, no se descarta—, y lo
 * que no puede entrar (una fila con horas y sin tarea) queda dicho en
 * `problemas` con su fila.
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

export type RenglonDelExcel = {
  /** El número de fila del Excel: va a `linea` y es la única forma de volver a la planilla. */
  fila: number;
  fecha: string | null;
  tarea: string;
  horas: number | null;
  costo: number | null;
  dudoso: boolean;
  motivo_dudoso: string | null;
};

export type GrupoDelExcel = {
  /** La fila del resumen. */
  fila: number;
  tarea: string;
  /** Las filas del detalle que su fórmula junta, sin repetir y en orden. */
  filas: number[];
};

export type ControlDelExcel = {
  /** El archivo trae el resumen (K a N) y se pudo leer. */
  hay_resumen: boolean;
  /** Las horas del resumen dan las del detalle y no hay nada que frene los grupos. */
  cierra: boolean;
  horas_detalle: number;
  horas_resumen: number;
  /** Resumen menos detalle: negativo si faltan horas en el resumen. */
  diferencia: number;
  /** Cuántas filas del resumen eran grupos (los totales no cuentan). */
  grupos_leidos: number;
  /** Cada cosa que no cierra, con su fila. Vacío cuando cierra. */
  problemas: string[];
};

export type LecturaDelExcel =
  | {
      ok: true;
      renglones: RenglonDelExcel[];
      /** Todo lo que el resumen decía, cierre o no: es lo que se guarda como evidencia. */
      grupos_leidos: GrupoDelExcel[];
      /** Los que se arman: lo mismo que `grupos_leidos` si el control cierra, y nada si no. */
      grupos: GrupoDelExcel[];
      control: ControlDelExcel;
      /** Todo lo que hay que decirle a quien carga, en orden y con sus filas. */
      problemas: string[];
    }
  | { ok: false; error: string };

// ─── Lo chico ────────────────────────────────────────────────────────────────

/** Hasta qué fila se busca el encabezado: un título arriba es normal, diez no. */
const FILAS_PARA_EL_ENCABEZADO = 10;

/** Un rango de fórmula más grande que esto no es un grupo de tareas: es un descuido. */
const MAXIMO_DE_UN_RANGO = 5000;

/** Menos que esto no es una diferencia de horas: es coma flotante. */
const TOLERANCIA = 0.005;

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

/** «Fecha» en la A y «Tarea» o «Descripción» en la B. */
function esElEncabezado(f: FilaDelExcel): boolean {
  return norm(f.celdas.A) === "fecha" && /^(tarea|descripcion)/.test(norm(f.celdas.B));
}

const ETIQUETA_DE_TOTAL = /^(sub)?total(es)?( general(es)?)?$/;

/** Una fórmula que suma una columna de C: `SUM(C2:C98)`. */
const SUMA_DE_LA_COLUMNA_C = /\b(?:SUM|SUBTOTAL)\s*\([^)]*\$?C\$?\d+\s*:\s*\$?C\$?\d+/i;

/** Una fila del detalle que es un total y no un renglón. */
function esTotalDelDetalle(f: FilaDelExcel): boolean {
  if (ETIQUETA_DE_TOTAL.test(norm(f.celdas.A)) || ETIQUETA_DE_TOTAL.test(norm(f.celdas.B))) return true;
  const formula = ver(f.celdas.C).formula;
  return formula !== null && SUMA_DE_LA_COLUMNA_C.test(formula);
}

const ES_UNA_SUMA = /^\s*=?\s*(?:SUM|SUBTOTAL)\s*\(/i;
const TIENE_UNA_C = /(?<![A-Za-z0-9_.])\$?C\$?\d+(?![A-Za-z0-9_(])/i;

/**
 * Una fila del resumen que es un total y no un grupo: la que dice TOTALES, o una
 * suma sin ninguna referencia a la columna de horas (`=SUM(N2:N65)`).
 */
function esTotalDelResumen(f: FilaDelExcel): { total: boolean; rotulado: boolean } {
  const rotulado = ETIQUETA_DE_TOTAL.test(norm(f.celdas.K));
  if (rotulado) return { total: true, rotulado };
  const formula = ver(f.celdas.N).formula;
  return { total: formula !== null && ES_UNA_SUMA.test(formula) && !TIENE_UNA_C.test(formula), rotulado };
}

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
function leerFecha(c: CeldaDelExcel): Leido<string> {
  const v = ver(c);
  if (v.error) return { valor: null, motivo: `La celda de fecha tiene un error de Excel (${v.error})` };
  if (v.formula !== null && v.valor === null) {
    return { valor: null, motivo: "La celda de fecha es una fórmula sin valor calculado: guardá el archivo con Excel para que la calcule" };
  }
  const x = v.valor;
  if (x === null || (typeof x === "string" && x.trim() === "")) return { valor: null, motivo: "No trae fecha" };

  const razonable = (iso: string, dicho: string): Leido<string> => {
    const anio = Number(iso.slice(0, 4));
    return anio >= ANIO_MINIMO && anio <= ANIO_MAXIMO
      ? { valor: iso, motivo: null }
      : { valor: null, motivo: `La fecha «${dicho}» no es razonable (año ${anio})` };
  };

  if (x instanceof Date) {
    if (Number.isNaN(x.getTime())) return { valor: null, motivo: "La fecha no es un día real" };
    return razonable(isoDeUTC(x), isoDeUTC(x));
  }
  if (typeof x === "number") {
    if (x >= SERIE_DEL_2000 && x <= SERIE_DEL_2100) {
      return { valor: isoDeUTC(new Date(Math.round((Math.floor(x) - 25569) * 86400000))), motivo: null };
    }
    return { valor: null, motivo: `El número ${x} no es una fecha` };
  }
  if (typeof x === "string") {
    // Un ISO con hora («2026-10-01T00:00:00.000Z») es el día de adelante.
    const t = x.trim().replace(/T.*$/, "");
    const iso = resolverFecha(t, "");
    return iso ? razonable(iso, t) : { valor: null, motivo: `La fecha «${x.trim()}» no es un día real` };
  }
  return { valor: null, motivo: "La fecha no es un día real" };
}

// ─── Las fórmulas del resumen ────────────────────────────────────────────────

type Referencias = {
  /** Las filas de la columna C que nombra, en orden y **con repetidas**: Excel las suma dos veces. */
  filas: number[];
  /** Referencias a una columna que no es la de horas. */
  fueraDeC: string[];
  /** Apunta a otra hoja: no se puede leer, y no se supone que es de ésta. */
  otraHoja: boolean;
  /** Un rango demasiado grande para ser un grupo de tareas. */
  rangoDescomunal: string | null;
};

/**
 * Las filas del detalle que una fórmula de horas nombra: `C47+C50`, `SUM(C3:C5)`,
 * `SUM(C3,C5)`, `$C$47`. Un rango se expande a todas sus filas.
 *
 * No evalúa nada: lo que importa es **qué renglones junta**, no cuánto da. La
 * cuenta de cuánto da la hace el control con los renglones de verdad.
 */
function referenciasDe(formula: string): Referencias {
  const salida: Referencias = { filas: [], fueraDeC: [], otraHoja: false, rangoDescomunal: null };
  if (formula.includes("!")) {
    salida.otraHoja = true;
    return salida;
  }
  // Ni detrás de una letra, un dígito o un punto (`LOG10`, `1.5C3`) ni delante de
  // un paréntesis: un nombre de función con dígitos no es una celda.
  const celda = /(?<![A-Za-z0-9_.])\$?([A-Za-z]{1,3})\$?(\d+)(?:\s*:\s*\$?([A-Za-z]{1,3})\$?(\d+))?(?![A-Za-z0-9_(])/g;
  for (const m of formula.matchAll(celda)) {
    const col = m[1].toUpperCase();
    const desde = Number(m[2]);
    if (m[3] === undefined) {
      if (col !== "C") salida.fueraDeC.push(`${col}${desde}`);
      else salida.filas.push(desde);
      continue;
    }
    const colHasta = m[3].toUpperCase();
    const hasta = Number(m[4]);
    if (col !== "C" || colHasta !== "C") {
      salida.fueraDeC.push(`${col}${desde}:${colHasta}${hasta}`);
      continue;
    }
    const [a, b] = desde <= hasta ? [desde, hasta] : [hasta, desde];
    if (b - a + 1 > MAXIMO_DE_UN_RANGO) {
      salida.rangoDescomunal = `C${desde}:C${hasta}`;
      continue;
    }
    for (let n = a; n <= b; n++) salida.filas.push(n);
  }
  return salida;
}

// ─── La lectura ──────────────────────────────────────────────────────────────

const lista = (xs: readonly (string | number)[]): string =>
  xs.length <= 1 ? String(xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`;

export function interpretarExcel(filasCrudas: readonly FilaDelExcel[]): LecturaDelExcel {
  const filas = [...filasCrudas].sort((a, b) => a.fila - b.fila);

  // ── El encabezado ──
  const encabezado = filas.find((f) => f.fila <= FILAS_PARA_EL_ENCABEZADO && esElEncabezado(f));
  if (!encabezado) {
    const primera = filas.find((f) => f.fila <= FILAS_PARA_EL_ENCABEZADO && !Object.values(f.celdas).every(estaVacia));
    const quedice = primera
      ? `La fila ${primera.fila} dice: A=«${textoDe(primera.celdas.A)}», B=«${textoDe(primera.celdas.B)}».`
      : "Las primeras filas están vacías.";
    return {
      ok: false,
      error:
        `No se reconoce el formato del archivo: busqué en las primeras ${FILAS_PARA_EL_ENCABEZADO} filas un ` +
        `encabezado con «Fecha» en la columna A y «Tarea» en la B, y no está. ${quedice}`,
    };
  }

  const problemas: string[] = [];
  const datos = filas.filter((f) => f.fila > encabezado.fila);

  // ── El resumen: ¿está, y es el que se espera? ──
  const kTitulo = norm(encabezado.celdas.K);
  const nTitulo = norm(encabezado.celdas.N);
  const hayResumen = /^(tarea|descripcion)/.test(kTitulo) && /^(hs|hora)/.test(nTitulo);
  if (!hayResumen) {
    const algoEnElResumen = ["K", "L", "M", "N", "O"].some((c) => !estaVacia(encabezado.celdas[c]));
    problemas.push(
      algoEnElResumen
        ? `No se leyó el resumen: el encabezado de la columna K dice «${textoDe(encabezado.celdas.K)}» y el de la N «${textoDe(encabezado.celdas.N)}», y se esperaba «Tarea» y «Hs». Cada renglón sale como su propia orden.`
        : "El archivo no trae el resumen (columnas K a O): cada renglón sale como su propia orden hasta que los juntes a mano."
    );
  }

  // ── El detalle ──
  const renglones: RenglonDelExcel[] = [];
  const porFila = new Map<number, RenglonDelExcel>();
  /** Filas con datos pero sin tarea: no son renglones, y una fórmula que las nombra lo tiene que decir. */
  const sinTarea = new Set<number>();
  const totales = new Map<number, string>();
  let ultimaConDatos = 0;

  for (const f of datos) {
    const celdas = f.celdas;
    if (["A", "B", "C", "D"].every((c) => estaVacia(celdas[c]))) continue;

    if (esTotalDelDetalle(f)) {
      totales.set(f.fila, [textoDe(celdas.A), textoDe(celdas.B)].filter(Boolean).join(" · "));
      continue;
    }
    ultimaConDatos = f.fila;

    const tarea = textoDe(celdas.B);
    const fecha = leerFecha(celdas.A);
    const horas = leerNumero(celdas.C, false);
    const costo = leerNumero(celdas.D, true);

    if (!tarea) {
      sinTarea.add(f.fila);
      const trae = [
        fecha.valor,
        horas.valor !== null ? `${verHoras(horas.valor)} h` : null,
        costo.valor !== null ? `$${verHoras(costo.valor)}` : null,
      ].filter((x): x is string => !!x);
      problemas.push(
        `La fila ${f.fila} del detalle no trae tarea y no se cargó${trae.length ? ` (trae ${trae.join(", ")})` : ""}.`
      );
      continue;
    }

    const motivos: string[] = [];
    if (fecha.motivo) motivos.push(fecha.motivo);
    if (horas.motivo) motivos.push(horas.motivo);
    if (costo.motivo) motivos.push(costo.motivo);
    if (horas.valor !== null && horas.valor > TOPE_DE_HORAS_POR_RENGLON) {
      motivos.push(
        `Las ${verHoras(horas.valor)} horas no parecen horas: son más de ${TOPE_DE_HORAS_POR_RENGLON} en un solo renglón (¿un dígito de más?)`
      );
    }
    // Si ya se dijo por qué un número no entró, «no trae número» sería falso.
    if (horas.valor === null && costo.valor === null && !horas.motivo && !costo.motivo) {
      motivos.push("No trae horas ni precio");
    }

    const r: RenglonDelExcel = {
      fila: f.fila,
      fecha: fecha.valor,
      tarea,
      horas: horas.valor,
      costo: costo.valor,
      dudoso: motivos.length > 0,
      motivo_dudoso: motivos.length > 0 ? motivos.join("; ") : null,
    };
    renglones.push(r);
    porFila.set(f.fila, r);
  }

  // Un total en el medio del detalle no se carga y se dice: perder un renglón
  // porque «parecía» un total es justo lo que no tiene que pasar en silencio.
  // El de la última fila es el normal y no se menciona.
  for (const [fila, texto] of totales) {
    if (fila < ultimaConDatos) {
      problemas.push(`La fila ${fila} del detalle parece un total y se salteó, no es un renglón (dice «${texto}»).`);
    }
  }

  if (!hayResumen) {
    return {
      ok: true,
      renglones,
      grupos_leidos: [],
      grupos: [],
      control: {
        hay_resumen: false, cierra: false, horas_detalle: redondear(sumaDeHoras(renglones)),
        horas_resumen: 0, diferencia: 0, grupos_leidos: 0, problemas: [],
      },
      problemas,
    };
  }

  // ── El resumen ──
  type FilaDeGrupo = {
    fila: number;
    tarea: string;
    formula: string | null;
    dicho: Vista;
    refs: Referencias | null;
  };
  const delResumen: FilaDeGrupo[] = [];

  for (const f of datos) {
    if (["K", "L", "M", "N", "O"].every((c) => estaVacia(f.celdas[c]))) continue;
    const { total, rotulado } = esTotalDelResumen(f);
    // Después de la fila que dice TOTALES no hay más grupos: lo que siga son
    // notas, y leerlas como grupos pararía el control por algo que no es una fórmula.
    if (rotulado) break;
    if (total) continue;
    const dicho = ver(f.celdas.N);
    delResumen.push({
      fila: f.fila,
      tarea: textoDe(f.celdas.K),
      formula: dicho.formula,
      dicho,
      refs: dicho.formula !== null ? referenciasDe(dicho.formula) : null,
    });
  }

  const control = controlar({ delResumen, renglones, porFila, sinTarea, totales, encabezado: encabezado.fila });

  const grupos_leidos: GrupoDelExcel[] = delResumen.map((g) => ({
    fila: g.fila,
    tarea: g.tarea,
    filas: [...new Set(g.refs?.filas ?? [])].sort((a, b) => a - b),
  }));

  const grupos = control.cierra ? grupos_leidos : [];
  if (!control.cierra) {
    problemas.push(
      "El resumen no cierra con el detalle, así que no se armaron los grupos: los renglones se cargaron " +
      "todos y cada uno sale como su propia orden hasta que los juntes a mano. Lo que no cierra:",
      ...control.problemas
    );
  }

  return { ok: true, renglones, grupos_leidos, grupos, control, problemas };
}

const sumaDeHoras = (rs: readonly RenglonDelExcel[]) => rs.reduce((s, r) => s + (r.horas ?? 0), 0);

// ─── El control ──────────────────────────────────────────────────────────────

/**
 * La cuenta: ¿lo que dice el resumen es lo que hay en el detalle? Devuelve todo
 * lo que no cierra, junto y con su fila, y no el primer problema que encuentra.
 */
function controlar(entrada: {
  delResumen: ReadonlyArray<{
    fila: number; tarea: string; formula: string | null; dicho: Vista;
    refs: Referencias | null;
  }>;
  renglones: readonly RenglonDelExcel[];
  porFila: ReadonlyMap<number, RenglonDelExcel>;
  sinTarea: ReadonlySet<number>;
  totales: ReadonlyMap<number, string>;
  encabezado: number;
}): ControlDelExcel {
  const { delResumen, renglones, porFila, sinTarea, totales, encabezado } = entrada;
  const problemas: string[] = [];

  const nombre = (r: RenglonDelExcel) =>
    `«${r.tarea}»${r.horas !== null ? `, ${verHoras(r.horas)} h` : ""}`;

  /** Veces que cada renglón aparece, y en qué filas del resumen. */
  const apariciones = new Map<number, number[]>();
  let horasDelResumen = 0;

  for (const g of delResumen) {
    const donde = `N${g.fila}`;
    const formula = g.formula ?? "";

    // Una fila del resumen que no dice qué junta.
    if (g.formula === null || g.refs === null) {
      const v = g.dicho;
      problemas.push(
        v.valor === null && !v.error
          ? `La fila ${g.fila} del resumen («${g.tarea}») no tiene fórmula en N: no se sabe qué renglones junta.`
          : `La celda ${donde} del resumen no es una fórmula con referencias al detalle (dice «${v.error ?? textoDe(v.valor)}»): no se sabe qué renglones junta.`
      );
      continue;
    }

    const refs = g.refs;
    let legible = true;
    if (refs.otraHoja) {
      problemas.push(`La fórmula de ${donde} (=${formula}) apunta a otra hoja y no se puede leer.`);
      legible = false;
    }
    for (const fuera of refs.fueraDeC) {
      problemas.push(`La fórmula de ${donde} (=${formula}) apunta a ${fuera}, que no es de la columna de horas (C).`);
      legible = false;
    }
    if (refs.rangoDescomunal) {
      problemas.push(`La fórmula de ${donde} (=${formula}) tiene un rango de más de ${MAXIMO_DE_UN_RANGO} filas (${refs.rangoDescomunal}): no es un grupo de tareas.`);
      legible = false;
    }
    if (legible && refs.filas.length === 0) {
      problemas.push(`La fórmula de ${donde} (=${formula}) no nombra ninguna fila de horas del detalle: no se sabe qué renglones junta.`);
      legible = false;
    }

    let suma = 0;
    for (const n of refs.filas) {
      const r = porFila.get(n);
      if (r) {
        suma += r.horas ?? 0;
        apariciones.set(n, [...(apariciones.get(n) ?? []), g.fila]);
        // Una referencia a un renglón sin horas ni precio es apuntar a una celda vacía.
        if (r.horas === null && r.costo === null) {
          problemas.push(`La fórmula de ${donde} (=${formula}) apunta a C${n}, y esa fila del detalle no trae horas ni precio.`);
        }
        continue;
      }
      const que = n <= encabezado
        ? "que es el encabezado"
        : totales.has(n)
          ? "que es la fila de totales"
          : sinTarea.has(n)
            ? "que es una fila sin tarea"
            : "que está vacía";
      problemas.push(`La fórmula de ${donde} (=${formula}) apunta a C${n}, ${que}.`);
    }
    horasDelResumen += suma;

    // Lo que dice la celda contra lo que suman sus referencias: sólo si el
    // archivo la calculó y si se pudieron leer todas las referencias.
    const calculado = g.dicho.valor;
    if (legible && typeof calculado === "number" && Math.abs(calculado - suma) >= TOLERANCIA) {
      problemas.push(`La celda ${donde} dice ${verHoras(calculado)} pero las filas que junta suman ${verHoras(suma)}.`);
    }
  }

  // Contado dos veces.
  for (const [n, enFilas] of apariciones) {
    if (enFilas.length < 2) continue;
    const r = porFila.get(n)!;
    const distintas = [...new Set(enFilas)];
    if (distintas.length === 1) {
      const g = delResumen.find((x) => x.fila === distintas[0])!;
      problemas.push(`La fórmula de N${g.fila} (=${g.formula}) toma dos veces la fila ${n} del detalle (${nombre(r)}).`);
    } else {
      const cuantos = distintas.length === 2 ? "dos" : String(distintas.length);
      problemas.push(
        `La fila ${n} del detalle (${nombre(r)}) está en ${cuantos} grupos del resumen: las filas ${lista(distintas)} del resumen.`
      );
    }
  }

  // Sin cubrir: horas que ningún grupo toma.
  for (const r of renglones) {
    if ((r.horas ?? 0) > 0 && !apariciones.has(r.fila)) {
      problemas.push(`La fila ${r.fila} del detalle (${nombre(r)}) no está en ningún grupo del resumen.`);
    }
  }

  const horas_detalle = redondear(sumaDeHoras(renglones));
  const horas_resumen = redondear(horasDelResumen);
  const diferencia = redondear(horas_resumen - horas_detalle);
  if (Math.abs(diferencia) >= TOLERANCIA) {
    problemas.push(
      `Las horas del resumen (${verHoras(horas_resumen)}) no dan las del detalle (${verHoras(horas_detalle)}): ` +
      (diferencia < 0
        ? `faltan ${verHoras(-diferencia)} h en el resumen.`
        : `sobran ${verHoras(diferencia)} h en el resumen.`)
    );
  }

  return {
    hay_resumen: true,
    cierra: problemas.length === 0,
    horas_detalle,
    horas_resumen,
    diferencia,
    grupos_leidos: delResumen.length,
    problemas,
  };
}

// ─── Lo que se junta de verdad ───────────────────────────────────────────────

/**
 * De los grupos del resumen, los que **juntan** algo: los de dos renglones o
 * más. Un grupo de un solo renglón es la orden de ese renglón, y escribirle un
 * `grupo_id` sólo lo haría aparecer como «juntado con 0 más» en la pantalla y le
 * sacaría la propuesta de acumular los que se llaman igual.
 *
 * De los 63 grupos del archivo real, 17 juntan dos o más renglones.
 */
export function gruposAJuntar(grupos: readonly GrupoDelExcel[]): GrupoDelExcel[] {
  return grupos.filter((g) => g.filas.length >= 2);
}
