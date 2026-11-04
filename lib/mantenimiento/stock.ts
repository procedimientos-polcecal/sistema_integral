/**
 * Qué hay en el pañol, leído de su planilla.
 *
 * No se guarda: se consulta en vivo. El stock cambia cada vez que alguien
 * retira algo, y una copia en la base estaría desactualizada justo cuando
 * importa —cuando hay que decidir si se puede hacer el trabajo hoy—.
 *
 * La planilla no la maneja Mantenimiento, así que los nombres de las columnas
 * son los que sean: se busca por alias.
 */

import { texto, normalizar, monto } from "@/lib/mantenimiento/planilla";

/** Cómo puede llamarse cada columna del inventario. */
const ALIAS: Record<string, string[]> = {
  codigo: ["CODIGO", "COD", "SKU", "ARTICULO", "ART", "ITEM", "N ITEM", "N ARTICULO"],
  descripcion: ["DESCRIPCION", "NOMBRE", "DETALLE", "REPUESTO", "PRODUCTO"],
  stock: ["STOCK ACTUAL", "STOCK", "CANTIDAD", "CANT", "EXISTENCIA", "DISPONIBLE", "SALDO", "EN STOCK"],
  seguridad: ["STOCK DE SEGURIDAD", "STOCK SEGURIDAD", "STOCK MINIMO", "MINIMO", "SS"],
  ubicacion: ["UBICACION", "DEPOSITO", "ESTANTE", "LUGAR", "POSICION", "PAÑOL"],
};

const clave = (v: unknown): string =>
  normalizar(v).toUpperCase().replace(/[.°]/g, "").replace(/\s+/g, " ").trim();

/** Dónde quedó cada dato. `-1` es que la planilla no lo trae. */
export type IndiceInventario = Record<string, number>;

/** El encabezado de la planilla, resuelto a índices de columna. */
export function mapearInventario(encabezado: unknown[]): IndiceInventario {
  const claves = encabezado.map(clave);
  const idx: IndiceInventario = {};

  for (const [nombre, alias] of Object.entries(ALIAS)) {
    idx[nombre] = -1;
    for (const a of alias) {
      const i = claves.indexOf(clave(a));
      if (i >= 0) { idx[nombre] = i; break; }
    }
  }
  return idx;
}

export interface Insumo {
  codigo: string | null;
  descripcion: string | null;
  /** `null` es "nadie lo contó", que no es lo mismo que cero. */
  stock: number | null;
  seguridad: number | null;
  ubicacion: string | null;
}

/** Una fila del inventario. `null` si no identifica a nada. */
export function filaDeInsumo(fila: unknown[], idx: IndiceInventario): Insumo | null {
  const celda = (nombre: string): unknown => {
    const i = idx[nombre];
    return i >= 0 ? fila[i] : undefined;
  };

  const codigo = texto(celda("codigo"));
  const descripcion = texto(celda("descripcion"));
  if (!codigo && !descripcion) return null;

  return {
    codigo,
    descripcion,
    stock: monto(celda("stock")),
    seguridad: monto(celda("seguridad")),
    ubicacion: texto(celda("ubicacion")),
  };
}

/**
 * En qué situación está un repuesto.
 *
 * "No está en el inventario" y "no hay stock" son cosas distintas: una se
 * compra, la otra se busca en otro lado o se pregunta en el pañol.
 */
export type EstadoDeStock =
  | "hay"
  | "no_alcanza"
  | "bajo_minimo"
  | "no_hay"
  | "sin_dato"
  | "no_esta";

export interface Disponibilidad {
  codigo: string | null;
  nombre: string | null;
  insumo: Insumo | null;
  estado: EstadoDeStock;
}

/** Menos letras que esto no alcanzan para reconocer un repuesto. */
const MINIMO_PARA_BUSCAR = 4;

/**
 * Qué hay de cada repuesto que la orden necesita.
 *
 * Se busca por código, después por nombre completo y por último por nombre
 * parcial. El parcial pide un mínimo de letras: con dos o tres, "de" o "tor"
 * encuentran media planilla.
 */
export function buscarEnInventario(
  repuestos: { codigo?: string | null; nombre?: string | null; cantidad?: string | null }[],
  inventario: Insumo[]
): Disponibilidad[] {
  const porCodigo = new Map<string, Insumo>();
  const porNombre = new Map<string, Insumo>();

  for (const i of inventario) {
    if (i.codigo) porCodigo.set(normalizar(i.codigo), i);
    if (i.descripcion) porNombre.set(normalizar(i.descripcion), i);
  }

  return repuestos.map((r) => {
    const codigo = normalizar(r.codigo);
    const nombre = normalizar(r.nombre);

    const insumo =
      (codigo && porCodigo.get(codigo)) ||
      (nombre && porNombre.get(nombre)) ||
      (nombre.length >= MINIMO_PARA_BUSCAR
        ? inventario.find((i) => normalizar(i.descripcion).includes(nombre))
        : undefined) ||
      null;

    return {
      codigo: r.codigo ?? null,
      nombre: r.nombre ?? null,
      insumo,
      estado: estadoDe(insumo, r.cantidad),
    };
  });
}

/**
 * Cuántos pide la orden, si de lo anotado sale un número.
 *
 * El campo es texto libre —"80", "80 u.", "un juego"— porque la planilla lo es.
 * Lo que no tiene número devuelve `null` y **no se compara**: decir «no
 * alcanza» sin saber cuánto hace falta es inventar.
 *
 * Es la misma lectura que hace `cantidadPedida` de `pedirRepuesto.ts`, que
 * llena el formulario del requerimiento. Están separadas porque devuelven
 * cosas distintas —aquélla el texto para un campo, ésta un número para
 * comparar— y unirlas obligaría a una a convertir de vuelta.
 */
function cuantosPide(texto: string | null | undefined): number | null {
  const m = String(texto ?? "").match(/\d+(?:[.,]\d+)?/);
  if (!m) return null;
  const n = Number(m[0].replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * En qué situación está un repuesto, para **esta** orden.
 *
 * El orden de las preguntas no es casual y se decidió el 04/11/2026:
 *
 *  - **No estar y no haber ganan**, porque son más graves y porque decir «no
 *    alcanza» de algo que no existe en el pañol no significa nada.
 *  - **«No alcanza» le gana a «queda poco»**, que es el más blando de los tres
 *    y además el que afirma de más: «queda poco» quiere decir *alcanza para
 *    este trabajo, pero hay que reponer*, y eso es falso justamente cuando no
 *    alcanza. Hasta hoy ese era el único juicio sobre la cantidad que el
 *    sistema hacía, y lo hacía sin mirar lo que la orden pide.
 *  - **Sin cantidad legible no se compara** y queda lo de siempre.
 */
function estadoDe(insumo: Insumo | null, cantidad?: string | null): EstadoDeStock {
  if (!insumo) return "no_esta";
  if (insumo.stock === null) return "sin_dato";
  if (insumo.stock <= 0) return "no_hay";

  const pide = cuantosPide(cantidad);
  if (pide !== null && insumo.stock < pide) return "no_alcanza";

  // Al mínimo o por debajo: alcanza para este trabajo, pero hay que reponer.
  if (insumo.seguridad !== null && insumo.stock <= insumo.seguridad) return "bajo_minimo";
  return "hay";
}

/** Cómo se dice cada estado en la pantalla. */
export const ESTADO_DE_STOCK: Record<EstadoDeStock, { label: string; color: string }> = {
  hay: { label: "Hay", color: "text-emerald-700" },
  no_alcanza: { label: "No alcanza", color: "text-amber-700" },
  bajo_minimo: { label: "Queda poco", color: "text-amber-700" },
  no_hay: { label: "No hay", color: "text-red-600" },
  sin_dato: { label: "Sin stock informado", color: "text-slate-500" },
  no_esta: { label: "No está en el inventario", color: "text-slate-400" },
};
