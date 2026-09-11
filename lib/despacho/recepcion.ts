import type { Recepcion } from "./types";

/**
 * La recepción de un camión de material: el pesaje, el estado y la planilla.
 *
 * Spec: docs/superpowers/specs/2026-09-11-despacho-recepcion-de-carbonilla-design.md
 *
 * Todo lo de acá es puro: se prueba sin red y sin base, que es donde este repo
 * pone lo que decide algo.
 */

/**
 * Dónde descarga el camión.
 *
 * Dos valores, y salen de contar el libro: `ARRIBA` en 83 renglones y `ABAJO` en
 * 23, de los 107 que lo anotan. Va como texto y no como enum de Postgres por lo
 * mismo que las listas de material y envase: un valor nuevo de enum obliga a una
 * migración sola (`55P04`, la trampa que ya mordió dos veces). La contra es que
 * la base acepta cualquier cosa, así que la ruta valida contra esta lista.
 */
export const LUGARES_DE_DESCARGA = ["ARRIBA", "ABAJO"] as const;

export type LugarDeDescarga = (typeof LUGARES_DE_DESCARGA)[number];

/**
 * El rango de toneladas que trajo un camión en todo un año.
 *
 * Medido sobre los 567 renglones del libro: de 4,1 a 44,36, con promedio 19,79.
 * **Avisa, no bloquea**: un camión puede traer algo fuera de rango y el papel es
 * el papel. Lo que no puede pasar es que un cero de más entre sin que nadie lo
 * vea, porque de acá sale una orden de compra confirmada.
 */
export const TONELADAS_VISTAS = { minimo: 4.1, maximo: 44.36 } as const;

export interface NetoDeLaRecepcion {
  /** Los kilos de material: bruto − tara. Null si falta un peso o si no cierra. */
  kg: number | null;
  /** Lo mismo en toneladas, con dos decimales, que es como se escribe. */
  toneladas: number | null;
  /** Qué está mal, si algo lo está. Null cuando el neto se puede usar. */
  problema: string | null;
  /** Está fuera de lo visto en un año, pero es un número usable. */
  aviso: string | null;
}

/**
 * El neto, o por qué no hay neto.
 *
 * **La tara mayor que el bruto es un error de tipeo, no un neto negativo.** Es el
 * caso que importa: de acá sale la cantidad de una orden de compra que se
 * confirma sola, y una cantidad negativa —o un cero— entraría a la contabilidad
 * del grupo sin que nadie la mire. Por eso devuelve el problema en vez de un
 * número.
 */
export function netoDeLaRecepcion(recepcion: {
  peso_bruto_kg: number | null;
  peso_tara_kg: number | null;
}): NetoDeLaRecepcion {
  const { peso_bruto_kg: bruto, peso_tara_kg: tara } = recepcion;

  if (bruto === null || bruto === undefined || tara === null || tara === undefined) {
    return { kg: null, toneladas: null, problema: null, aviso: null };
  }
  if (!Number.isFinite(bruto) || !Number.isFinite(tara)) {
    return { kg: null, toneladas: null, problema: "Los pesos tienen que ser números.", aviso: null };
  }
  if (tara > bruto) {
    return {
      kg: null,
      toneladas: null,
      problema: `La tara (${tara} kg) es mayor que el bruto (${bruto} kg).`,
      aviso: null,
    };
  }
  if (tara === bruto) {
    return {
      kg: null,
      toneladas: null,
      problema: "El bruto y la tara son iguales: el neto daría cero.",
      aviso: null,
    };
  }

  const kg = bruto - tara;
  // Dos decimales, que es como está escrito el año entero del libro (19,79).
  const toneladas = Math.round((kg / 1000) * 100) / 100;

  const aviso =
    toneladas < TONELADAS_VISTAS.minimo || toneladas > TONELADAS_VISTAS.maximo
      ? `${toneladas} t está fuera de lo que trajo un camión en todo el año (${TONELADAS_VISTAS.minimo} a ${TONELADAS_VISTAS.maximo} t). Revisá los pesos.`
      : null;

  return { kg, toneladas, problema: null, aviso };
}

/**
 * En qué paso está la recepción.
 *
 * No se guarda: se despeja de lo que hay, igual que el estado de una orden de
 * carga. Un estado guardado y un peso se desincronizan, y nada avisa.
 */
export type EstadoDeRecepcion = "esperando_bruto" | "descargando" | "lista" | "cerrada";

export function estadoDeLaRecepcion(recepcion: Recepcion): EstadoDeRecepcion {
  if (recepcion.odoo_purchase_order_id !== null) return "cerrada";
  if (recepcion.peso_bruto_kg === null) return "esperando_bruto";
  if (recepcion.peso_tara_kg === null) return "descargando";
  return "lista";
}

export const ETIQUETA_DE_ESTADO: Record<EstadoDeRecepcion, string> = {
  esperando_bruto: "Esperando el bruto",
  descargando: "Descargando",
  lista: "Lista para cerrar",
  cerrada: "Cerrada",
};

/**
 * El próximo paso, que es el único botón que la pantalla ofrece.
 *
 * Uno solo y no tres, por lo mismo que la cola del día ofrece un horario y no
 * cuatro: con un camión esperando, tres botones son tres oportunidades de
 * apretar el que no es, y un peso en el campo equivocado no se nota hasta que la
 * orden ya está confirmada en Odoo.
 */
export function proximoPaso(
  recepcion: Recepcion
): Exclude<EstadoDeRecepcion, "cerrada"> | null {
  const estado = estadoDeLaRecepcion(recepcion);
  return estado === "cerrada" ? null : estado;
}

export const ETIQUETA_DEL_BOTON: Record<Exclude<EstadoDeRecepcion, "cerrada">, string> = {
  esperando_bruto: "Pesar bruto",
  descargando: "Pesar tara",
  lista: "Cerrar y crear la orden",
};

// ── La planilla ──────────────────────────────────────────────

/** Los encabezados del libro, tal cual están escritos —con el espacio de más. */
export const COLUMNAS_DE_LA_PLANILLA = [
  "Fecha",
  "Proveedor",
  "Cantidad",
  "Notas",
  "Total del Dia ",
  "Nro Orden",
  "LUGAR DE DESCARGAR",
] as const;

/** La única pestaña que se escribe. La otra, `RESUMEN POR DIA `, es fórmulas. */
export const PESTANA_DEL_DETALLE = "Detalle";

/**
 * La columna que dice dónde termina lo cargado: `B`, el proveedor.
 *
 * Las tres primeras están al 100% en los 567 renglones, pero la `A` es la fecha
 * y en estos libros las fechas aparecen vacías cuando el formato de la celda las
 * esconde —pasó en el libro de las órdenes de carga y pisó renglones—. La `B` es
 * texto y no tiene ese problema.
 */
export const COLUMNA_QUE_MANDA = "B";

/**
 * `E` (`Total del Dia `) **no se escribe nunca**.
 *
 * Está vacía en los 567 renglones y el total vive como fórmula en la otra
 * pestaña. Escribir ahí —aunque sea un vacío— es lo que convierte una fórmula en
 * dato muerto el día que alguien la arrastre.
 */
export const COLUMNA_QUE_NO_SE_TOCA = 4;

/** "11/9/2026": d/m, como la planilla. Nunca m/d — eso dio vuelta 885 fechas en Compras. */
export function fechaComoSeEscribe(fecha: string): string {
  const m = fecha.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  return `${Number(m[3])}/${Number(m[2])}/${m[1]}`;
}

/**
 * Las toneladas como las escribe el libro: con coma decimal.
 *
 * El libro tiene las dos formas —557 como número y 10 como texto con coma—, y se
 * escribe con coma porque `valueInputOption: USER_ENTERED` hace que Google la
 * interprete con la configuración regional de la planilla, que es la de acá.
 */
export function cantidadComoSeEscribe(toneladas: number): string {
  return toneladas.toFixed(2).replace(".", ",");
}

/**
 * El Nº de orden como lo escribe el libro: `orden 1615`, no `P01615`.
 *
 * Es la forma que tienen los 118 renglones que lo anotan, y `orden 1615` **es**
 * la `P01615` de Odoo: se comprobó contra las dos bases, 116 de 118 existen. Se
 * escribe así porque quien lee la planilla tiene un año de historia escrito así.
 */
export function ordenComoSeEscribe(odooNombre: string | null): string {
  if (!odooNombre) return "";
  // Sólo la forma `P#####`, que es la que tiene esta instancia. Cualquier otra
  // se escribe tal cual: sacarle "el número" a un nombre desconocido —de
  // `OC/2026/0015` saldría 2026— es inventar el dato que se anota en el papel.
  const numero = odooNombre.match(/^P0*(\d+)$/)?.[1];
  return numero ? `orden ${Number(numero)}` : odooNombre;
}

export interface FilaDeRecepcion {
  /** Índice de columna (0 = A) y qué va adentro. La `E` nunca aparece acá. */
  columna: number;
  valor: string;
}

/**
 * Las seis celdas que el sistema escribe, con su columna.
 *
 * Se devuelven con el número de columna —y no como un arreglo de siete— para que
 * saltear la `E` sea estructural y no un `""` puesto en el lugar justo.
 */
export function celdasDeLaRecepcion(datos: {
  fecha: string;
  proveedor: string;
  toneladas: number | null;
  notas: string | null;
  odooNombre: string | null;
  lugarDescarga: string | null;
}): FilaDeRecepcion[] {
  return [
    { columna: 0, valor: fechaComoSeEscribe(datos.fecha) },
    { columna: 1, valor: datos.proveedor },
    { columna: 2, valor: datos.toneladas === null ? "" : cantidadComoSeEscribe(datos.toneladas) },
    { columna: 3, valor: datos.notas ?? "" },
    { columna: 5, valor: ordenComoSeEscribe(datos.odooNombre) },
    { columna: 6, valor: datos.lugarDescarga ?? "" },
  ];
}

/**
 * Las cuatro primeras celdas (`A:D`), que es lo que se escribe al agregar.
 *
 * `agregarFila` escribe desde la `A` hasta donde llegue el arreglo, así que
 * mandarle cuatro deja intactas la `E` —la fórmula— y las dos que siguen, que se
 * escriben después por celda.
 */
export function primerasCeldas(celdas: FilaDeRecepcion[]): string[] {
  return [0, 1, 2, 3].map((c) => celdas.find((x) => x.columna === c)?.valor ?? "");
}
