/**
 * El alta de un requerimiento, escrita donde la planilla la puede recibir.
 *
 * Está aparte de `sheets.ts` porque es **otra planilla**: la de respuestas del
 * formulario de Google (`FORM PEDIDO DE COMPRA POLCECAL - POLYSAN`), con otro
 * id, otra hoja y otro encabezado. `sheets.ts` espeja PEDIDOS DE COMPRA y ya
 * tiene 1.100 líneas haciendo eso.
 *
 * POR QUÉ ACÁ Y NO EN EL MASTER
 *
 * En el master las columnas del alta no son datos: `A2` es un
 * `QUERY(IMPORTRANGE(...))` de esta hoja de respuestas, y su salida ocupa A:J.
 * Las pestañas por área son a su vez un `FILTER` del master. O sea que el alta
 * no se puede escribir ni en el master ni en la pestaña del área: se escribe
 * una planilla más arriba y baja sola.
 *
 * Ver `docs/COMPRAS-SINCRONIZACION.md` y el spec del 09/09/2026.
 */

import { norm } from "@/lib/compras/texto";
import { serialDelDia, serialDelInstante } from "@/lib/core/fechaDeSheets";
import { letraDeColumna } from "@/lib/core/columnaDeSheets";

/** Cómo se llama cada columna en la hoja. La primera que exista gana. */
const ALIAS = {
  nro_ri: ["Nº RI", "N° RI", "NRO RI"],
  marca: ["Marca temporal", "Timestamp"],
  nombre: ["Nombre"],
  apellido: ["Apellido"],
  area: ["ÁREA", "AREA"],
  descripcion: ["DESCRIPCIÓN DEL PEDIDO", "DESCRIPCIÓN", "DESCRIPCION"],
  codigo: ["CODIGO", "CÓDIGO"],
  cantidad: ["CANTIDAD A PEDIR", "CANTIDAD", "CAN"],
  ubicacion: ["PARA DONDE SE NECESITA", "DONDE SE NECESITA"],
  fecha_necesidad: ["PARA CUANDO SE NECESITA", "FECHA DE REQUERIMIENTO"],
  detalle_extra: ["DETALLES EXTRA", "DETALLE EXTRA"],
  imagen: ["ARCHIVO COMPLEMENTARIO", "IMAGEN COMPLEMENTARIA", "IMAGEN"],
} as const;

type Clave = keyof typeof ALIAS;

/**
 * Sin qué columnas no se escribe.
 *
 * Son las que hacen que el pedido exista y aparezca donde tiene que aparecer:
 * el número —que lo calcula la fórmula—, la marca temporal —de la que depende
 * esa fórmula—, el área —con la que el `FILTER` de cada pestaña compara letra
 * por letra— y la descripción, que es el pedido. Sin una de ésas, escribir
 * sería dejar una fila que nadie va a poder leer.
 */
const IMPRESCINDIBLES: Clave[] = ["nro_ri", "marca", "area", "descripcion"];

export interface DatosDelAlta {
  nro_ri: number;
  nombre: string;
  apellido: string;
  area: string;
  descripcion: string;
  codigo: string | null;
  cantidad: number | null;
  ubicacion: string | null;
  /** ISO `2026-09-10`, o null si no la pidieron para una fecha. */
  fecha_necesidad: string | null;
  detalle_extra: string | null;
  imagen_url: string | null;
  creado: Date;
}

export interface Celda {
  /** Desde cero, como la espera `escribirCeldas` del núcleo. */
  columna: number;
  valor: string;
}

export type ResultadoCeldas =
  | { ok: true; celdas: Celda[] }
  | { ok: false; faltan: string[] };

/**
 * Compara nombres de columna sin distinguir acentos, mayúsculas ni el signo de
 * grado/ordinal: `norm` ya saca acentos y colapsa `°`/`º`/`.`, y este filtro de
 * más saca lo que le sobreviva (comas, dos puntos) para que sólo queden letras,
 * números y espacios en ambos lados de la comparación.
 */
const clave = (s: string) => norm(s).replace(/[^A-Z0-9 ]/g, "");

/**
 * Cuántas columnas puede llenar un alta: las 12 de `ALIAS`, A a L.
 *
 * La búsqueda no mira más allá de esa ventana, y no es sólo por prolijidad: la
 * hoja real tiene una columna `O` que se llama literalmente `Area`, la misma
 * palabra que `E` (`ÁREA`) una vez que `clave()` les saca el acento a las dos.
 * Si el alta llega con un encabezado al que le falta la `E` —el caso que
 * prueba "si falta una columna no escribe nada"—, buscar en toda la fila
 * encuentra la `O` y escribe ahí: el área queda enlazada a una columna que el
 * `QUERY` del master ignora, así que el pedido sale sin área en la pestaña de
 * nadie y no hay ningún error que lo avise. Es el mismo riesgo que el CLAUDE.md
 * del repo nombra para las planillas: "enlazar al que se le parece es peor que
 * dejar en null". Acá el "que se le parece" es toda una columna real, no un
 * texto parecido.
 */
const COLUMNAS_DEL_ALTA = Object.keys(ALIAS).length;

/** En qué columna está cada cosa, por nombre y no por posición. */
function indexar(encabezado: string[]): Record<Clave, number> {
  const normalizado = encabezado.slice(0, COLUMNAS_DEL_ALTA).map(clave);
  const idx = {} as Record<Clave, number>;

  for (const [c, alias] of Object.entries(ALIAS) as [Clave, readonly string[]][]) {
    idx[c] = -1;
    for (const a of alias) {
      const i = normalizado.indexOf(clave(a));
      if (i >= 0) { idx[c] = i; break; }
    }
  }
  return idx;
}

/**
 * Qué escribir en la fila `fila` de la hoja de respuestas.
 *
 * El N° de RI va como **la misma fórmula que tienen las otras 1.955 filas** y
 * no como número. Dos razones: el que numera sigue siendo uno solo —la
 * planilla—, y la fila que Google agrega en la próxima respuesta copia la
 * fórmula de la de arriba; si arriba encuentra un literal, la serie se corta.
 *
 * Las columnas que el `QUERY` del master ignora no se tocan: `DIRECCIÓN EMAIL
 * ENVIADA` la escribe el Apps Script de los avisos, y ponerle algo sería decir
 * que se avisó cuando no se avisó.
 */
export function celdasDelAlta(
  encabezado: string[],
  datos: DatosDelAlta,
  fila: number
): ResultadoCeldas {
  const idx = indexar(encabezado);

  const faltan = IMPRESCINDIBLES.filter((c) => idx[c] < 0).map(
    (c) => `${c} (${ALIAS[c].join(" o ")})`
  );
  if (faltan.length > 0) return { ok: false, faltan };

  const marca = letraDeColumna(idx.marca);
  const nro = letraDeColumna(idx.nro_ri);
  const serialNecesidad = datos.fecha_necesidad ? serialDelDia(datos.fecha_necesidad) : null;

  const valores: Partial<Record<Clave, string>> = {
    nro_ri: `=IF(${marca}${fila}:${marca}<>"",${nro}${fila - 1}+1,"")`,
    marca: String(serialDelInstante(datos.creado)),
    nombre: datos.nombre,
    apellido: datos.apellido,
    area: datos.area,
    descripcion: datos.descripcion,
    codigo: datos.codigo ?? "",
    cantidad: datos.cantidad !== null ? String(datos.cantidad) : "",
    ubicacion: datos.ubicacion ?? "",
    fecha_necesidad: serialNecesidad !== null ? String(serialNecesidad) : "",
    detalle_extra: datos.detalle_extra ?? "",
    imagen: datos.imagen_url ?? "",
  };

  const celdas: Celda[] = [];
  for (const [c, valor] of Object.entries(valores) as [Clave, string][]) {
    const columna = idx[c];
    // Una columna que esta hoja no tiene y no es imprescindible: se omite en
    // silencio. No se escribe en una posición inventada.
    if (columna < 0) continue;
    celdas.push({ columna, valor });
  }
  return { ok: true, celdas };
}
