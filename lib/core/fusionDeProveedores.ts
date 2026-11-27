/**
 * Fusionar dos filas del padrón que son el mismo proveedor.
 *
 * `proveedores` es catálogo del núcleo: lo comparten los seis módulos y **19
 * tablas le apuntan**. Fusionar es re-apuntarlas todas a una fila y borrar la
 * otra, así que no se deshace y por eso se audita.
 *
 * ## La regla que decide cuál queda, y que este archivo NO aplica
 *
 * No es la que tiene más actividad: es **la que nombra la planilla de
 * Compras**, porque `asegurarProveedores()` crea la fila que no encuentra por
 * nombre y la corrida siguiente traería de vuelta a la borrada, vacía y sin
 * CUIT. Esa decisión la toma una persona en la pantalla —acá sólo se ejecuta—
 * porque hay un tercer caso que ningún dato de la base contesta: «SINGLA, FASE
 * 3» es una celda de la planilla que nombró a dos proveedores, y ahí la que
 * queda no es ninguna de las dos.
 *
 * ## Qué se lleva la que queda
 *
 * **Cada campo que ella tenga vacío y la otra tenga cargado**, y nada más. El
 * caso que importa es el que destapó el archivo del 26/11/2026: la fila que usa
 * la planilla no tiene CUIT y su gemela sí, así que fusionar es cómo el CUIT
 * llega a la fila que recibe los pedidos. Lo que ya tiene cargado no se pisa:
 * un dato que alguien escribió gana sobre el de la fila que se está yendo.
 *
 * **El `nombre` no se muda nunca.** Es con lo que la sincronización reconoce al
 * proveedor; cambiarlo mientras se borra la otra fila dejaría a la planilla sin
 * a quién apuntar por partida doble.
 */

import { normalizarCuit } from "./cuit";

/** Lo que hace falta saber de una fila para fusionarla. */
export interface FilaDelPadron {
  id: string;
  nombre: string;
  cuit?: string | null;
  razon_social?: string | null;
  [campo: string]: unknown;
}

/**
 * Las 19 tablas que le apuntan a `proveedores`, de
 * `node scripts/que-cuelga-de.mjs proveedores` el 26/11/2026.
 *
 * `choque` dice qué hacer cuando la fila que se va no puede mudarse porque la
 * que queda ya ocupa esa clave:
 *
 * - **`borrar`**: la fila de la que se va sobra. Son los dos casos medidos ese
 *   día —3 pares invitados al mismo requerimiento y 5 con el mismo enlace a
 *   Odoo en la misma empresa—, y en los dos la fila duplicada no dice nada que
 *   la otra no diga: una invitación repetida al mismo RI, o el mismo
 *   `partner_id` de Odoo, que además se vuelve a resolver solo por CUIT.
 * - **`frenar`**: ahí `proveedor_id` **es** la clave primaria, así que la fila
 *   lleva datos propios —la configuración de un contratista de Cantera, el
 *   perfil de recepción de Despacho— y borrarla los pierde. Hoy esas tablas
 *   tienen 2 y 10 filas, así que el caso es casi imposible; cuando pase, lo
 *   decide una persona y no este código.
 */
export const TABLAS_QUE_APUNTAN: readonly {
  tabla: string;
  /** La otra columna de la clave única, si la hay. */
  choque?: { columna: string | null; que: "borrar" | "frenar" };
}[] = [
  { tabla: "calidad_carbonilleros" },
  { tabla: "calidad_envases_movimientos" },
  { tabla: "calidad_envases_proveedores" },
  { tabla: "calidad_movimientos" },
  { tabla: "cantera_contratistas", choque: { columna: null, que: "frenar" } },
  { tabla: "compras_cotizaciones" },
  { tabla: "compras_requerimiento_proveedores", choque: { columna: "requerimiento_id", que: "borrar" } },
  { tabla: "compras_requerimientos" },
  { tabla: "despacho_recepcion_proveedores", choque: { columna: null, que: "frenar" } },
  { tabla: "despacho_recepciones" },
  { tabla: "facturas_proveedor" },
  { tabla: "inventario_movimientos" },
  { tabla: "mant_contratista_lugares" },
  { tabla: "mant_cuadernos" },
  { tabla: "mant_partes_contratista" },
  { tabla: "ordenes_servicio" },
  { tabla: "ordenes_trabajo" },
  { tabla: "os_comparativas" },
  { tabla: "proveedores_odoo", choque: { columna: "empresa_id", que: "borrar" } },
];

/**
 * Los campos que se copian de la fila que se va a la que queda, **si la que
 * queda los tiene vacíos**.
 *
 * `nombre` no está, y es la omisión importante. `activo`, `es_contratista` y
 * `trabaja_con_ambas` tampoco: son booleanos y se resuelven aparte, porque
 * «vacío» no quiere decir nada en un booleano —ver `banderasQueSeMudan`—.
 */
const CAMPOS_QUE_SE_COPIAN = [
  "cuit",
  "razon_social",
  "contacto",
  "telefono",
  "telefono_alt",
  "email",
  "direccion",
  "sitio_web",
  "rubro",
  "notas",
  "comentario",
  "plazo_pago_dias",
  "forma_pago",
  "condicion_pago",
  "cbu",
  "alias_bancario",
  "modo_de_carga",
  "empresa_id",
] as const;

/** Los tres booleanos: si alguna de las dos lo tenía, la fusionada lo tiene. */
const BANDERAS = ["activo", "es_contratista", "trabaja_con_ambas"] as const;

const estaVacio = (v: unknown): boolean =>
  v === null || v === undefined || (typeof v === "string" && v.trim() === "");

/**
 * Por qué estas dos filas no se pueden fusionar, o `null` si se puede.
 *
 * El único freno duro es **dos CUITs distintos**: el CUIT identifica a la
 * empresa, así que dos filas con dos CUITs válidos y distintos no son un
 * duplicado sino dos proveedores, y fusionarlas mandaría las facturas de uno a
 * la cuenta del otro. Que los nombres se parezcan no alcanza para discutirle
 * eso a AFIP.
 */
export function problemaParaFusionar(queda: FilaDelPadron, seVa: FilaDelPadron): string | null {
  if (queda.id === seVa.id) return "Es la misma fila.";

  const a = normalizarCuit(queda.cuit ?? null);
  const b = normalizarCuit(seVa.cuit ?? null);
  if (a && b && a !== b) {
    return (
      `«${queda.nombre}» tiene CUIT ${a} y «${seVa.nombre}» tiene ${b}: son dos empresas distintas. ` +
      "Si una de las dos está mal cargada, corregila primero en su ficha."
    );
  }

  return null;
}

/**
 * Qué campos hay que escribirle a la que queda. Vacío si no hay nada que mudar.
 *
 * Devuelve sólo lo que cambia, para que el `PATCH` no toque `updated_at` sin
 * motivo y para que la pantalla pueda decir exactamente qué se mudó.
 */
export function camposQueSeMudan(
  queda: FilaDelPadron,
  seVa: FilaDelPadron
): Record<string, unknown> {
  const cambios: Record<string, unknown> = {};

  for (const campo of CAMPOS_QUE_SE_COPIAN) {
    if (estaVacio(queda[campo]) && !estaVacio(seVa[campo])) cambios[campo] = seVa[campo];
  }

  for (const bandera of BANDERAS) {
    if (seVa[bandera] === true && queda[bandera] !== true) cambios[bandera] = true;
  }

  return cambios;
}
