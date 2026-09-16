/**
 * Seguimiento de la compra: lo puro.
 *
 * Acá vive lo que se testea —la fila que se escribe en el master de
 * SEGUIMIENTO DE COMPRA y el dato duro que se muestra al lado del juicio—.
 * El I/O está en `seguimientoSheets.ts`.
 */

import { fechaDeSheets, serialDelDia } from "@/lib/core/fechaDeSheets";
import { empresaParaPlanilla } from "@/lib/compras/sheets";
import { norm } from "@/lib/compras/texto";
import type { Cumplio } from "@/lib/compras/types";

/** Cómo se escribe cada juicio en la planilla. "Si" va sin tilde: es así allá. */
export const ETIQUETA_CUMPLIO: Record<Cumplio, string> = {
  SI: "Si",
  MAS_O_MENOS: "Más o menos",
  NO: "No",
};

/** Lo que hace falta saber de un RI para armar su fila. */
export interface DatosDeSeguimiento {
  nro_ri: number;
  codigo: string | null;
  area: string | null;
  descripcion: string | null;
  proveedor: string | null;
  empresa: string | null;
  paga_ambas: boolean;
  cantidad: number | null;
  cantidad_comprada: number | null;
  cantidad_recibida: number | null;
  fecha_estimada_recepcion: string | null;
  fecha_recepcion: string | null;
  cumplio_compras: Cumplio | null;
  cumplio_proveedor: Cumplio | null;
}

const texto = (n: number | null) => (n === null || n === undefined ? "" : String(n));

/**
 * La fecha como serial, que es como la escribe todo el sistema.
 *
 * `serialDelDia` devuelve null para una fecha que no existe —el 30 de febrero
 * no se rueda al 2 de marzo— y acá eso queda en celda vacía: una celda vacía
 * se ve, una fecha corrida tres días no.
 */
const fecha = (iso: string | null) => {
  const serial = iso ? serialDelDia(iso) : null;
  return serial === null ? "" : String(serial);
};

/**
 * Las trece celdas de una fila de `COMPRAS CON RI`, en orden A..M.
 *
 * `null` en una posición significa **no escribir esa celda**, y hoy le pasa a
 * una sola: `MAIL_ENVIADO`. Un Apps Script de la planilla barre el master
 * buscando "fecha de recepción sin mail enviado" para avisarle al área, y
 * estampa el "SI". Si al reescribir una fila pisáramos esa celda con vacío, el
 * área recibiría el aviso de nuevo. La planilla manda sobre esa columna, igual
 * que sobre la celda LINK de la comparativa en el otro libro.
 *
 * El SdG no puede mandar ese mail en su lugar: no hay transporte de correo en
 * el proyecto —Remises usa web push— ni dirección de mail por área en la base.
 */
export function filaDeSeguimiento(r: DatosDeSeguimiento): (string | null)[] {
  return [
    String(r.nro_ri),                                    // A  NºRI
    r.codigo ?? "",                                      // B  CODIGO
    r.area ?? "",                                        // C  ÁREA
    r.descripcion ?? "",                                 // D  Descripción
    r.proveedor ?? "",                                   // E  Proveedor
    empresaParaPlanilla(r.empresa, r.paga_ambas),        // F  ¿Quién compro?
    texto(r.cantidad_comprada ?? r.cantidad),            // G  Cant Pedida
    texto(r.cantidad_recibida),                          // H  Cant Recibida
    fecha(r.fecha_estimada_recepcion),                   // I  Fecha estimada
    fecha(r.fecha_recepcion),                            // J  Fecha de recepción
    null,                                                // K  MAIL_ENVIADO ← nunca
    r.cumplio_compras ? ETIQUETA_CUMPLIO[r.cumplio_compras] : "",     // L
    r.cumplio_proveedor ? ETIQUETA_CUMPLIO[r.cumplio_proveedor] : "", // M
  ];
}

/** Lo que la pantalla muestra al lado de cada juicio. `null` = no hay qué decir. */
export interface ComoLlego {
  demora: string | null;
  cantidad: string | null;
}

/**
 * El dato duro, para decidir el juicio mirándolo.
 *
 * NO decide el juicio: `Cumplió COMPRAS?` y `Cumplió PROV?` son de la persona.
 * Se midió sobre las 1.757 filas del histórico y no hay regla: 295 de los "Sí"
 * de Compras habían llegado tarde, y 16 de los "No" del proveedor habían
 * recibido todo. Llegar tarde avisando no es lo mismo que llegar tarde.
 */
export function comoLeLlego(r: {
  fecha_estimada_recepcion: string | null;
  fecha_recepcion: string | null;
  cantidad: number | null;
  cantidad_comprada: number | null;
  cantidad_recibida: number | null;
}): ComoLlego {
  return { demora: laDemora(r), cantidad: laCantidad(r) };
}

function laDemora(r: {
  fecha_estimada_recepcion: string | null;
  fecha_recepcion: string | null;
}): string | null {
  if (!r.fecha_estimada_recepcion || !r.fecha_recepcion) return null;

  // La misma guardia que usa `fecha()` para escribir en la planilla: una fecha
  // que no existe, o que no viene como YYYY-MM-DD, no se corrige ni se estima.
  // Sin esto, un `" "` daba "llegó 46310 días tarde" —un número con forma de
  // dato real al lado de un juicio que carga una persona—, que es peor que no
  // decir nada.
  const estimada = serialDelDia(r.fecha_estimada_recepcion);
  const recibida = serialDelDia(r.fecha_recepcion);
  if (estimada === null || recibida === null) return null;

  // Los seriales ya son días enteros, así que la resta es la cantidad de días y
  // no hay husos de por medio.
  const dias = recibida - estimada;

  if (dias <= 0) return "llegó a tiempo";
  return `llegó ${dias} ${dias === 1 ? "día" : "días"} tarde`;
}

function laCantidad(r: {
  cantidad: number | null;
  cantidad_comprada: number | null;
  cantidad_recibida: number | null;
}): string | null {
  const recibida = r.cantidad_recibida;
  const esperada = r.cantidad_comprada ?? r.cantidad;
  if (recibida === null || esperada === null) return null;

  if (recibida === esperada) return "recibió todo lo comprado";
  if (recibida > esperada) {
    return `recibió ${recibida} de ${esperada}: ${recibida - esperada} de más`;
  }
  return `recibió ${recibida} de ${esperada}`;
}

/**
 * Si un requerimiento tiene que estar en el libro de seguimiento.
 *
 * El libro es de compras hechas: sus 1.757 filas son todas RI comprados. Un RI
 * que todavía está en comparativa o esperando aprobación no va, y sin esta
 * guarda iba: `exportarSeguimiento` se llama desde el PATCH del requerimiento,
 * que es por donde pasan también aprobar, asignar y cargar un presupuesto.
 *
 * `yaTieneFila` es la excepción y no una concesión: si el RI ya ocupa una fila
 * —porque se compró y después volvió a comparativa, por ejemplo— esa fila sigue
 * existiendo, y dejar de escribirla la congelaría con datos viejos. Se sigue
 * manteniendo al día; lo que no se hace nunca es CREARLA fuera de tiempo.
 */
export function entraEnElSeguimiento(
  estadoCompra: string | null,
  yaTieneFila: boolean
): boolean {
  if (estadoCompra === "PEDIDO" || estadoCompra === "RECIBIDO") return true;
  return yaTieneFila;
}

/** Lo que una fila del histórico aporta a su requerimiento. */
export interface DelHistorico {
  nro_ri: number;
  cantidad_comprada: number | null;
  cantidad_recibida: number | null;
  fecha_estimada_recepcion: string | null;
  fecha_recepcion: string | null;
  cumplio_compras: Cumplio | null;
  cumplio_proveedor: Cumplio | null;
  /** Celdas que no se pudieron leer. Quedan en null y se informan. */
  sucias: string[];
}

const DE_LA_PLANILLA: Record<string, Cumplio> = {
  "si": "SI",
  "más o menos": "MAS_O_MENOS",
  "mas o menos": "MAS_O_MENOS",
  "no": "NO",
};

/**
 * Una fila A..M del master del histórico. `null` si no es una compra.
 *
 * Las filas sin NºRI —363 de las 2.120— son restos de una fórmula rota, con
 * `#N/A` en el resto de las columnas. No hay ninguna compra real sin RI: se
 * midió.
 */
export function filaDelHistorico(celdas: string[]): DelHistorico | null {
  const nro_ri = Number(String(celdas[0] ?? "").trim());
  if (!Number.isFinite(nro_ri) || nro_ri === 0) return null;

  const sucias: string[] = [];

  const numero = (v: unknown, comoSeLlama: string): number | null => {
    const t = String(v ?? "").trim();
    if (t === "") return null;
    const n = Number(t.replace(",", "."));
    if (Number.isFinite(n)) return n;
    // No se adivina: se informa y queda vacío.
    sucias.push(`${comoSeLlama} "${t}"`);
    return null;
  };

  const juicio = (v: unknown): Cumplio | null =>
    DE_LA_PLANILLA[String(v ?? "").trim().toLowerCase()] ?? null;

  return {
    nro_ri,
    cantidad_comprada: numero(celdas[6], "cantidad comprada"),
    cantidad_recibida: numero(celdas[7], "cantidad recibida"),
    fecha_estimada_recepcion: fechaDeSheets(celdas[8]),
    fecha_recepcion: fechaDeSheets(celdas[9]),
    cumplio_compras: juicio(celdas[11]),
    cumplio_proveedor: juicio(celdas[12]),
    sucias,
  };
}

/**
 * Cuánto estuvo el material guardado antes de usarse.
 *
 * Es el único indicador del seguimiento que no existe en ningún otro lado, y
 * sale de las dos fechas: recepción y aplicación. No se guarda en la base
 * porque es una resta —ya es una fórmula en la planilla— y dos copias del mismo
 * hecho se pelean sin que nadie gane.
 *
 * Medido el 16/09/2026 sobre las 343 filas de Mantenimiento con las dos fechas:
 * mediana 3 días, percentil 75 en 7, máximo 66, y **13 negativas**. Esas trece
 * dicen que el material se aplicó antes de recibirse, o sea que alguna de las
 * dos fechas está mal cargada. Mostrarlas como "-15 días en stock" las
 * disfrazaría de medición; acá se nombra el problema y se deja que alguien lo
 * corrija.
 *
 * La guardia de fechas es la misma que usa `laDemora`: una fecha que no existe
 * o que no viene como YYYY-MM-DD no produce un número, produce nada.
 */
export function tiempoEnStock(
  fechaRecepcion: string | null,
  fechaAplicacion: string | null
): string | null {
  if (!fechaRecepcion || !fechaAplicacion) return null;

  const recibido = serialDelDia(fechaRecepcion);
  const aplicado = serialDelDia(fechaAplicacion);
  if (recibido === null || aplicado === null) return null;

  const dias = aplicado - recibido;
  if (dias < 0) return "la fecha de aplicación es anterior a la de recepción";
  if (dias === 0) return "se aplicó el mismo día";
  return `${dias} ${dias === 1 ? "día" : "días"} en stock`;
}

/** Cómo se escribe la aplicación en la planilla. "Si" sin tilde, como está allá. */
export const ETIQUETA_APLICADO: Record<string, string> = { SI: "Si", NO: "No" };

/** Cómo puede venir escrito cada encabezado de la aplicación. */
const ALIAS_APLICACION = {
  se_aplico: { nombre: "Se aplicó?", variantes: ["SE APLICO?", "SE APLICO", "APLICADO"] },
  fecha_aplicacion: {
    nombre: "Fecha de Aplicación",
    variantes: ["FECHA DE APLICACION", "FECHA APLICACION"],
  },
} as const;

/**
 * Qué celdas de la pestaña del área se escriben, y cuáles no.
 *
 * Las pestañas por área no tienen todas la misma forma: Mantenimiento tiene 21
 * columnas y las demás 18, porque `Estimada Aplicación`, `ANALISIS` y `Equipo`
 * existen sólo ahí **y en el medio**. Por eso las columnas se ubican por nombre;
 * con un índice fijo la fecha de Mantenimiento caería en `ANALISIS`.
 *
 * `conFormula` son las columnas que en ESA fila tienen una fórmula. No se
 * escriben nunca: en Almacén la columna entera de `Fecha de Aplicación` es `=J`
 * —599 de 599 celdas medidas el 16/09/2026—, o sea que copia la fecha de
 * recepción, y en Taller Vial son 539 de 599. Pisarlas rompe el cálculo y el
 * libro no tiene deshacer.
 *
 * Un valor en null **no se escribe**, y no se escribe vacío: es lo que deja que
 * el área siga tildando a mano en la planilla sin que el sistema se lo borre.
 * Es la misma regla que `solicita` y `comparativa` en el otro libro.
 *
 * Lo que no se pudo escribir se devuelve en `salteadas` en vez de callarse: un
 * dato que está en la base y no aparece en la planilla, sin que nadie sepa por
 * qué, es la divergencia que no avisa.
 */
export function celdasDeAplicacion(
  encabezado: string[],
  conFormula: number[],
  datos: { seAplico: string | null; fechaAplicacion: string | null }
): { aEscribir: { columna: number; valor: string }[]; salteadas: string[] } {
  const normalizado = encabezado.map((h) => norm(h).replace(/\s*\?$/, ""));
  const ubicar = (variantes: readonly string[]) => {
    for (const v of variantes) {
      const i = normalizado.indexOf(norm(v).replace(/\s*\?$/, ""));
      if (i >= 0) return i;
    }
    return -1;
  };

  const aEscribir: { columna: number; valor: string }[] = [];
  const salteadas: string[] = [];

  const poner = (clave: keyof typeof ALIAS_APLICACION, valor: string | null) => {
    // Sin valor no hay nada que decidir: la celda no se toca.
    if (valor === null) return;

    const { nombre, variantes } = ALIAS_APLICACION[clave];
    const columna = ubicar(variantes);
    if (columna < 0) {
      salteadas.push(`${nombre} (la pestaña no tiene esa columna)`);
      return;
    }
    if (conFormula.includes(columna)) {
      salteadas.push(`${nombre} (es una fórmula en la planilla)`);
      return;
    }
    aEscribir.push({ columna, valor });
  };

  poner("se_aplico", datos.seAplico ? (ETIQUETA_APLICADO[datos.seAplico] ?? null) : null);

  // La fecha va como serial, igual que en el master. Una que no existe deja la
  // celda quieta en vez de correrla tres días.
  const serial = datos.fechaAplicacion ? serialDelDia(datos.fechaAplicacion) : null;
  poner("fecha_aplicacion", serial === null ? null : String(serial));

  return { aEscribir, salteadas };
}
