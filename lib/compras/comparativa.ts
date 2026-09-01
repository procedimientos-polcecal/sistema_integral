/**
 * La comparativa de proveedores, en la forma que tiene la planilla.
 *
 * Todo lo que se puede decidir sin hablar con Google vive acá: la fórmula del
 * total, el mapeo de columnas por nombre, la regla de la columna A y cómo se
 * arma una fila para escribirla. Así se puede testear sin red y sin
 * credenciales.
 *
 * La plantilla de referencia es "00. COMPARATIVA DE PROVEEDORES GENERICO".
 */

import { norm } from "@/lib/compras/texto";
import { monedaExacta } from "@/lib/compras/constants";

/** Las 19 columnas de la plantilla, en orden. */
export const COLUMNAS_COMPARATIVA = [
  "NRO RI", "FECHA", "ÁREA", "DESCRIPCION", "PROVEEDOR", "MARCA",
  "UNIDAD DE MEDIDA", "PRECIO UNITARIO", "CANTIDAD", "ENVÍO", "DESCUENTO",
  "IVA", "PRECIO TOTAL", "PRECIO HASTA", "PLAZOS", "CONDICIONES DE PAGO",
  "DISPONIBILIDAD", "COMENTARIO", "ELECCIÓN",
] as const;

/** Días de pago del desplegable de la columna PLAZOS. */
export const PLAZOS_PAGO = [0, 15, 21, 30, 45, 60, 90, 120, 150] as const;

/**
 * Desplegable de DISPONIBILIDAD, copiado tal cual.
 *
 * "1-3 día" está en singular en la planilla. Corregirlo haría que la validación
 * de datos de Sheets rechace el valor al escribirlo.
 */
export const DISPONIBILIDADES = [
  "Inmediata", "1-3 día", "4-7 días", "8-15 días",
  "16-30 días", "31-45 días", "46-60 días",
] as const;

export type ClaveColumna =
  | "nro_ri" | "fecha" | "area" | "descripcion" | "proveedor" | "marca"
  | "unidad_medida" | "precio_unitario" | "cantidad" | "envio" | "descuento"
  | "iva" | "precio_total" | "precio_hasta" | "plazos" | "condiciones_pago"
  | "disponibilidad" | "comentario" | "eleccion";

/**
 * Cómo puede venir escrito cada encabezado. El primero es el nombre canónico.
 *
 * No son idénticos entre planillas: el número de RI aparece como `NRO RI`,
 * `N° RI` o `N RI` según quién la armó. Y como la columna A es el vínculo con
 * el pedido, no reconocerla deja la planilla afuera entera.
 *
 * `norm()` ya saca acentos, grados y puntos, así que `N° RI`, `Nº RI` y `N. RI`
 * llegan acá como `N RI`: alcanza con listar esa forma.
 */
const ALIAS: Record<ClaveColumna, string[]> = {
  nro_ri: ["NRO RI", "N RI", "NUMERO RI", "N DE RI"],
  fecha: ["FECHA"],
  area: ["ÁREA", "AREA", "SECTOR"],
  descripcion: ["DESCRIPCION", "DESCRIPCIÓN", "DETALLE"],
  proveedor: ["PROVEEDOR", "PROVEEDORES"],
  marca: ["MARCA"],
  unidad_medida: ["UNIDAD DE MEDIDA", "UNIDAD", "U MEDIDA", "UM"],
  precio_unitario: ["PRECIO UNITARIO", "PRECIO UNIT", "P UNITARIO", "UNITARIO"],
  cantidad: ["CANTIDAD", "CAN", "CANT"],
  envio: ["ENVÍO", "ENVIO", "FLETE"],
  descuento: ["DESCUENTO", "DESC"],
  iva: ["IVA"],
  precio_total: ["PRECIO TOTAL", "TOTAL"],
  precio_hasta: ["PRECIO HASTA", "VALIDO HASTA", "VÁLIDO HASTA"],
  plazos: ["PLAZOS", "PLAZO", "PLAZO DE PAGO"],
  condiciones_pago: ["CONDICIONES DE PAGO", "CONDICIONES"],
  disponibilidad: ["DISPONIBILIDAD", "ENTREGA"],
  comentario: ["COMENTARIO", "COMENTARIOS", "OBSERVACIONES"],
  eleccion: ["ELECCIÓN", "ELECCION", "ELEGIDO"],
};

/** Sin estas columnas la planilla no es una comparativa y no se toca. */
const IMPRESCINDIBLES: ClaveColumna[] = ["nro_ri", "proveedor", "precio_unitario"];

export type Indice = Record<ClaveColumna, number>;

export type ResultadoMapeo =
  | { ok: true; idx: Indice }
  | { ok: false; faltan: string[]; encontrados: string[] };

/**
 * Ubica cada columna por NOMBRE, no por posición.
 *
 * Escribir por posición en un archivo con otra estructura es la forma más fácil
 * de arruinar la planilla de alguien. Si falta algo imprescindible, no se
 * escribe: se avisa qué falta.
 */
export function mapearEncabezados(encabezado: string[]): ResultadoMapeo {
  const normalizado = encabezado.map(norm);
  const idx = {} as Indice;

  for (const [clave, alias] of Object.entries(ALIAS) as [ClaveColumna, string[]][]) {
    idx[clave] = -1;
    for (const nombre of alias) {
      const i = normalizado.indexOf(norm(nombre));
      if (i >= 0) { idx[clave] = i; break; }
    }
  }

  // Lo que falta se nombra con sus variantes, y se dice qué encabezados había:
  // sin eso, corregir la planilla es adivinar.
  const faltan = IMPRESCINDIBLES.filter((c) => idx[c] < 0).map((c) => nombreConVariantes(c));

  return faltan.length > 0
    ? { ok: false, faltan, encontrados: encabezado.filter((h) => String(h ?? "").trim() !== "") }
    : { ok: true, idx };
}

/** "NRO RI (o N° RI, NUMERO RI)", para que se pueda corregir la planilla. */
function nombreConVariantes(clave: ClaveColumna): string {
  const [canonico, ...resto] = ALIAS[clave];
  // "N RI" se muestra como "N° RI", que es como lo escribe la gente.
  const legibles = resto.map((v) => (v === "N RI" ? "N° RI" : v));
  return legibles.length > 0 ? `${canonico} (o ${legibles.join(", ")})` : canonico;
}

// ── Lectura de valores ───────────────────────────────────────

const texto = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};

/**
 * Números como los escribe la gente: "1.500,50", "$ 1500", "10%".
 *
 * Un porcentaje vuelve como fracción (10% → 0.1), que es como lo guarda la
 * planilla y como lo espera la fórmula del total.
 */
export function numero(v: unknown): number | null {
  const bruto = String(v ?? "").trim();
  if (bruto === "") return null;

  const esPorcentaje = bruto.includes("%");
  const limpio = bruto.replace(/[^\d.,-]/g, "");
  if (limpio === "") return null;

  // Si tiene los dos separadores, el último es el decimal.
  const ultimaComa = limpio.lastIndexOf(",");
  const ultimoPunto = limpio.lastIndexOf(".");
  let normalizado: string;
  if (ultimaComa >= 0 && ultimoPunto >= 0) {
    normalizado = ultimaComa > ultimoPunto
      ? limpio.replace(/\./g, "").replace(",", ".")
      : limpio.replace(/,/g, "");
  } else {
    normalizado = limpio.replace(",", ".");
  }

  const n = Number(normalizado);
  if (!isFinite(n)) return null;
  return esPorcentaje ? n / 100 : n;
}

/**
 * Días de plazo de pago, que van a una columna `integer`.
 *
 * En esa celda la gente escribe lo que quiere, y un decimal hacía fallar el
 * INSERT entero con "invalid input syntax for type integer": una sola celda
 * rara dejaba sin adjuntar toda la comparativa. Se redondea.
 *
 * Lo que no puede ser un plazo de pago queda sin definir en vez de guardarse
 * como cualquier cosa: "30/60" son dos opciones, no 3060 días. El tope es un
 * año, que ya es más de lo que nadie financia.
 */
export function diasDePlazo(v: unknown): number | null {
  const bruto = String(v ?? "").trim();
  // Varios números separados no son un plazo: no hay forma de elegir cuál.
  if (/\d\s*[/|]\s*\d/.test(bruto)) return null;

  const n = numero(bruto);
  if (n === null) return null;

  const dias = Math.round(n);
  return dias < 0 || dias > 365 ? null : dias;
}

/** Fechas de la planilla (d/m/yyyy) a ISO. */
export function fechaISO(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (s === "") return null;

  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const anio = y.length === 2 ? `20${y}` : y;
    return `${anio}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const iso = s.match(/^\d{4}-\d{2}-\d{2}/);
  return iso ? iso[0] : null;
}

// ── El total ─────────────────────────────────────────────────

/**
 * El total de un presupuesto.
 *
 * El IVA se aplica sobre el neto completo y el descuento se resta después, sin
 * IVA encima:
 *
 *     unitario * cantidad * (1 + IVA) - (unitario * cantidad * descuento) + envío
 *
 * No es lo mismo que descontar primero y aplicar IVA al resultado, que es lo que
 * hacía antes: con unitario 290, IVA 21% y 10% de descuento, aquello daba 315,81
 * y esto da 321,90. Con descuento en cero las dos coinciden, que es por qué la
 * diferencia no se veía.
 *
 * Vive en tres lugares y los tres tienen que decir lo mismo: la columna generada
 * `compras_cotizaciones.precio_total` (migración 041), que es la que se guarda y
 * por la que se ordena; esta función, para mostrar el total mientras alguien
 * escribe el formulario; y la fórmula que `filaParaPlanilla()` escribe en la
 * planilla de comparativa. Los casos de `comparativa.test.ts` están para que no
 * se pueda mover una sola.
 */
export function totalCotizacion(c: {
  precio_unitario: number | null;
  cantidad: number | null;
  descuento: number | null;
  iva: number | null;
  costo_envio: number | null;
}): number {
  const neto = (c.precio_unitario ?? 0) * (c.cantidad ?? 1);
  const total = neto * (1 + (c.iva ?? 0)) - neto * (c.descuento ?? 0) + (c.costo_envio ?? 0);

  return Math.round(total * 100) / 100;
}

// ── La regla de la columna A ─────────────────────────────────

export interface FilaPropia {
  fila: string[];
  /** Fila real de la planilla, contando el encabezado. */
  numeroFila: number;
}

/**
 * Qué filas de la planilla son de este requerimiento.
 *
 * Sólo las que tienen ESTE número de RI en la columna A. Las demás se dejan
 * quietas y se cuentan aparte.
 *
 * Antes también se tomaban las de columna A vacía, con la idea de que "nadie las
 * reclamó todavía". Con la planilla real eso resultó desastroso: las planillas
 * son por artículo y acumulan cotizaciones de años sin etiquetar, así que una
 * sola de CORREAS le pegó 238 presupuestos ajenos a un pedido de una correa. Una
 * fila sin número no significa "es de este RI", significa "no se sabe de cuál
 * es", y adivinar es peor que no traerla.
 *
 * `filas` no incluye el encabezado; la primera es la fila 2 de la planilla.
 */
export function filasParaEsteRi(
  filas: string[][],
  columnaNroRi: number,
  nroRi: number
): { propias: FilaPropia[]; ajenas: number; sinRi: number } {
  const propias: FilaPropia[] = [];
  let ajenas = 0;
  let sinRi = 0;

  filas.forEach((fila, i) => {
    // Una fila sin nada escrito no es de nadie.
    if (fila.every((c) => String(c ?? "").trim() === "")) return;

    const marca = String(fila[columnaNroRi] ?? "").trim();
    if (marca === "") sinRi += 1;
    else if (Number(marca) === nroRi) propias.push({ fila, numeroFila: i + 2 });
    else ajenas += 1;
  });

  return { propias, ajenas, sinRi };
}

// ── Parsear y escribir ───────────────────────────────────────

export interface CotizacionLeida {
  proveedor_nombre: string;
  marca: string | null;
  unidad_medida: string | null;
  precio_unitario: number | null;
  cantidad: number | null;
  costo_envio: number | null;
  descuento: number | null;
  iva: number | null;
  precio_hasta: string | null;
  plazo_pago_dias: number | null;
  condiciones_pago: string | null;
  disponibilidad: string | null;
  comentario: string | null;
}

/**
 * La fecha como la escribe una persona: 24/08/2026.
 *
 * Lo que llega es lo que guarda Postgres —"2026-08-24T00:00:00+00:00"— y eso en
 * la planilla se lee como un dato de sistema, no como una fecha. Se toman los
 * primeros diez caracteres y se dan vuelta: sin `new Date()`, que interpretaría
 * la zona horaria y podría correr un día.
 */
export function fechaCorta(valor: string | null | undefined): string {
  if (!valor) return "";
  const m = String(valor).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(valor);
}

/**
 * Con qué multiplicar los montos para que queden en pesos.
 *
 * Devuelve null cuando el presupuesto está en dólares y no hay cotización: ahí
 * el monto no se escribe. Un número en dólares en una planilla que suma pesos
 * gana cualquier comparación por ser diez veces más chico.
 */
export function enPesos(moneda: string | null | undefined, dolar: number | null | undefined): number | null {
  if ((moneda ?? "ARS") !== "USD") return 1;
  return dolar && dolar > 0 ? dolar : null;
}

/** Un monto convertido, listo para la celda. Vacío si no se puede convertir. */
export function montoParaLaPlanilla(monto: number | null, aPesos: number | null): string {
  if (monto === null || monto === undefined) return "";
  if (aPesos === null) return "";
  return String(Math.round(monto * aPesos * 100) / 100);
}

/** Una fila de la planilla como presupuesto. `null` si no lo es. */
export function parsearFila(fila: string[], idx: Indice): CotizacionLeida | null {
  const en = (c: ClaveColumna) => (idx[c] >= 0 ? fila[idx[c]] : undefined);

  const proveedor = texto(en("proveedor"));
  const unitario = numero(en("precio_unitario"));

  // Sin proveedor o sin precio no hay nada que comparar.
  if (!proveedor || unitario === null) return null;

  return {
    proveedor_nombre: proveedor,
    marca: texto(en("marca")),
    unidad_medida: texto(en("unidad_medida")),
    precio_unitario: unitario,
    cantidad: numero(en("cantidad")),
    costo_envio: numero(en("envio")),
    descuento: numero(en("descuento")),
    iva: numero(en("iva")),
    precio_hasta: fechaISO(en("precio_hasta")),
    plazo_pago_dias: diasDePlazo(en("plazos")),
    condiciones_pago: texto(en("condiciones_pago")),
    disponibilidad: texto(en("disponibilidad")),
    comentario: texto(en("comentario")),
  };
}

const porcentaje = (v: number | null | undefined) =>
  v === null || v === undefined ? "" : `${Math.round(v * 10000) / 100}%`;

/** Letra de columna de Sheets a partir del índice (0 → A). */
export const letraColumna = (i: number) => String.fromCharCode(65 + i);

/**
 * Arma la fila para escribirla en la planilla.
 *
 * El total va como FÓRMULA y no como número, para que la planilla siga siendo
 * una planilla: si alguien corrige un precio ahí, el total se recalcula. Es la
 * fórmula corregida, con el envío sumado — las filas viejas conservan la
 * original hasta que alguien las toque.
 */
export function filaParaPlanilla(args: {
  idx: Indice;
  numeroFila: number;
  nroRi: number;
  fecha: string | null;
  area: string | null;
  descripcion: string | null;
  cotizacion: CotizacionLeida;
  /**
   * En qué moneda se cargó el presupuesto y con qué dólar convertirlo.
   *
   * La planilla es toda en pesos: si se escribe un unitario en dólares, la
   * fórmula del total lo suma con los presupuestos en pesos y la comparación
   * queda sin sentido. Sin cotización el precio no se escribe: un número en la
   * moneda equivocada es peor que una celda vacía.
   */
  moneda?: string | null;
  dolar?: number | null;
}): string[] {
  const { idx, numeroFila: n, nroRi, cotizacion: c } = args;
  const fila: string[] = new Array(COLUMNAS_COMPARATIVA.length).fill("");

  const poner = (clave: ClaveColumna, valor: string) => {
    if (idx[clave] >= 0) fila[idx[clave]] = valor;
  };

  const col = (clave: ClaveColumna) => letraColumna(idx[clave]);

  poner("nro_ri", String(nroRi));
  // La planilla la lee gente, no un parser: "24/08/2026" y no
  // "2026-08-24T00:00:00+00:00", que es lo que venía guardado.
  poner("fecha", fechaCorta(args.fecha));
  poner("area", args.area ?? "");
  poner("descripcion", args.descripcion ?? "");
  poner("proveedor", c.proveedor_nombre);
  poner("marca", c.marca ?? "");
  poner("unidad_medida", c.unidad_medida ?? "");
  const aPesos = enPesos(args.moneda, args.dolar);
  const unitarioEnLaCelda = montoParaLaPlanilla(c.precio_unitario, aPesos);
  poner("precio_unitario", unitarioEnLaCelda);
  poner("cantidad", c.cantidad === null ? "" : String(c.cantidad));
  poner("envio", montoParaLaPlanilla(c.costo_envio, aPesos));
  poner("descuento", porcentaje(c.descuento));
  poner("iva", porcentaje(c.iva));
  poner("precio_hasta", c.precio_hasta ?? "");
  poner("plazos", c.plazo_pago_dias === null ? "" : String(c.plazo_pago_dias));
  poner("condiciones_pago", c.condiciones_pago ?? "");
  poner("disponibilidad", c.disponibilidad ?? "");
  poner("comentario", c.comentario ?? "");
  poner("eleccion", "FALSE");

  // Sin unitario en la celda no se escribe fórmula ninguna.
  //
  // Pasa cuando el presupuesto está en dólares y no hay cotización:
  // `montoParaLaPlanilla` deja la celda vacía a propósito, para no mezclar
  // monedas. Pero la fórmula la multiplicaba igual, y una celda vacía vale
  // cero: el total daba 0 y en una comparativa donde gana el más barato, un
  // cero gana todas. Un total en blanco dice lo que pasa —no se pudo
  // calcular—; un cero miente.
  if (idx.precio_total >= 0 && idx.precio_unitario >= 0 && unitarioEnLaCelda !== "") {
    // Sólo se nombran las columnas que esa planilla tiene.
    //
    // Antes se armaba con todas y `letraColumna(-1)` devolvía "@" para las que
    // faltaban: en las comparativas viejas, sin columna de ENVÍO, la fórmula
    // salía "...+@1001" y Excel la marcaba como error. Una columna que no está
    // no aporta al total, así que no tiene por qué figurar.
    const parte = (clave: ClaveColumna) => (idx[clave] >= 0 ? `${col(clave)}${n}` : null);

    const unitario = parte("precio_unitario")!;
    const descuento = parte("descuento");
    const iva = parte("iva");
    const envio = parte("envio");

    // La cantidad se nombra sólo si además TIENE valor, y no sólo si la
    // columna existe. Es la única que multiplica: una celda vacía vale cero y
    // `H7*I7` dejaba el total entero en cero, mientras la app mostraba el
    // número correcto. `totalCotizacion` usa `cantidad ?? 1`; sin cantidad la
    // fórmula tiene que ser el unitario solo, que es lo mismo.
    //
    // Las otras tres se dejan referenciadas aunque estén vacías, porque no
    // multiplican: IVA vacío es ×(1+0), descuento vacío es −0 y envío vacío es
    // +0, todo consistente con `totalCotizacion`. Y así, si alguien las
    // completa en la planilla, el total se recalcula solo — que es el punto de
    // escribir una fórmula y no un número.
    const cantidad =
      c.cantidad === null || c.cantidad === undefined ? null : parte("cantidad");

    // El neto se nombra dos veces —una para el IVA y otra para el descuento—
    // porque el descuento se resta sin IVA encima. Las letras salen del
    // encabezado de cada planilla, así que en la versión nueva el IVA es L y el
    // descuento K, y en las viejas son otras: por eso no van fijas.
    const neto = cantidad ? `${unitario}*${cantidad}` : unitario;

    let formula = iva ? `=${neto}*(1+${iva})` : `=${neto}`;
    if (descuento) formula += `-(${neto}*${descuento})`;
    if (envio) formula += `+${envio}`;

    poner("precio_total", formula);
  }

  return fila;
}

// ── Para mostrarla ────────────────────────────────────

/**
 * Cuánto más caro que el más barato.
 *
 * Es el número que más ayuda a decidir y el que nadie calcula a mano: "16% más"
 * dice mucho más que dos totales al lado. El más barato devuelve `null`, porque
 * "+0%" sería ruido.
 */
export function diferenciaPorcentual(
  total: number | null | undefined,
  minimo: number | null | undefined
): string | null {
  if (total === null || total === undefined) return null;
  if (!minimo || minimo <= 0) return null;
  if (total <= minimo) return null;
  return `+${Math.round((total / minimo - 1) * 100)}%`;
}

const pct = (v: number) => `${Math.round(v * 10000) / 100}%`;

/**
 * La cuenta que hay detrás del total, en una línea.
 *
 * Sin esto el total es un número que hay que creer. Con esto se ve de dónde
 * sale, que es lo que permite discutirlo: el unitario más bajo puede terminar
 * siendo el total más alto por el envío.
 */
export function detalleCotizacion(c: {
  marca: string | null;
  precio_unitario: number | null;
  cantidad: number | null;
  descuento: number | null;
  iva: number | null;
  costo_envio: number | null;
}): string {
  const partes: string[] = [];
  if (c.marca) partes.push(c.marca);

  const unitario = monedaExacta(c.precio_unitario);
  partes.push(
    c.cantidad === null || c.cantidad === undefined
      ? unitario
      : `${unitario} × ${c.cantidad}`
  );

  if (c.descuento) partes.push(`−${pct(c.descuento)}`);
  partes.push(`IVA ${pct(c.iva ?? 0)}`);
  if (c.costo_envio) partes.push(`+ ${monedaExacta(c.costo_envio)} de envío`);

  return partes.join(" · ");
}

/**
 * Qué proveedor y qué costos deja el presupuesto elegido en el requerimiento.
 *
 * `costo_iva` es el total SIN el envío, porque en el requerimiento el envío va
 * en su propio campo y la ficha suma los dos: así el total del RI coincide con
 * el del presupuesto en vez de contar el flete dos veces.
 *
 * Vive acá y no en la ruta porque lo usan los dos lados: la ruta al pasar a
 * PEDIDO, y el tablero para mostrar de antemano con qué va a quedar.
 */
export function costosParaElPedido(c: {
  proveedor_id: string;
  precio_total: number | null;
  costo_envio: number | null;
  moneda?: string | null;
  cotizacion?: number | null;
}): { proveedor_id: string; costo_iva: number; costo_envio: number } {
  // El requerimiento lleva pesos: es lo que se compara en el tablero, lo que
  // suma el dashboard y lo que va a la planilla. Si el presupuesto vino en
  // dólares, acá se convierte con la cotización que quedó congelada al
  // elegirlo.
  const aPesos = (v: number) =>
    (c.moneda ?? "ARS") === "USD" && c.cotizacion ? v * c.cotizacion : v;

  const envio = aPesos(c.costo_envio ?? 0);
  const total = aPesos(c.precio_total ?? 0);

  return {
    proveedor_id: c.proveedor_id,
    costo_iva: Number((total - envio).toFixed(2)),
    costo_envio: Number(envio.toFixed(2)),
  };
}

// ── Presupuestos en dólares ──────────────────────────────────

/**
 * El total de un presupuesto, en pesos.
 *
 * `precio_total` guarda lo que el proveedor cotizó, en su moneda: es una
 * columna generada en Postgres y no puede depender de un valor que cambia
 * todos los días. La conversión se hace acá, al mostrar.
 *
 * Cuál cotización se usa depende de en qué etapa está el presupuesto:
 *
 *   - mientras se compara, la del día. Es lo que permite mirar dos
 *     presupuestos cargados con semanas de diferencia con la misma vara.
 *   - una vez elegido, la que quedó grabada. Lo que se pagó no cambia porque
 *     hoy el dólar esté más caro.
 *
 * Devuelve null cuando no hay con qué convertir. Un cero sería peor: se leería
 * como un presupuesto gratis y ganaría cualquier comparación.
 */
export function totalEnPesos(
  c: { precio_total: number | null; moneda?: string | null; cotizacion?: number | null },
  dolarDeHoy: number | null
): number | null {
  const total = c.precio_total;
  if (total === null || total === undefined) return null;

  // Sin moneda es un presupuesto de los de antes: pesos.
  if ((c.moneda ?? "ARS") !== "USD") return total;

  const dolar = c.cotizacion ?? dolarDeHoy;
  if (!dolar || dolar <= 0) return null;

  return Math.round(total * dolar * 100) / 100;
}

/** Si este presupuesto necesita una cotización que no tenemos. */
export function faltaLaCotizacion(
  c: { moneda?: string | null; cotizacion?: number | null },
  dolarDeHoy: number | null
): boolean {
  if ((c.moneda ?? "ARS") !== "USD") return false;
  return !(c.cotizacion ?? dolarDeHoy);
}

/**
 * Los totales de una comparativa, todos en pesos.
 *
 * Se calcula una vez y se reparte, en vez de que cada pantalla convierta por su
 * cuenta: el orden, el más barato y la diferencia porcentual tienen que salir
 * todos de los mismos números, o la comparativa dice una cosa y el resaltado
 * otra.
 */
export function totalesEnPesosDe(
  cotizaciones: { id: string; precio_total: number | null; moneda?: string | null; cotizacion?: number | null }[],
  dolarDeHoy: number | null
): Record<string, number | null> {
  const totales: Record<string, number | null> = {};
  for (const c of cotizaciones) totales[c.id] = totalEnPesos(c, dolarDeHoy);
  return totales;
}

/** El más barato de la comparativa, ya en pesos. Null si no hay ninguno. */
export function minimoEnPesos(totales: Record<string, number | null>): number | null {
  const valores = Object.values(totales).filter((v): v is number => v !== null);
  return valores.length > 0 ? Math.min(...valores) : null;
}

/** Los datos de pago que la base guarda del proveedor. */
export interface PagoDelProveedor {
  plazo_pago_dias: number | null;
  forma_pago: string | null;
  condicion_pago: string | null;
}

/**
 * Lo que el formulario de presupuesto puede completar solo al elegir proveedor.
 *
 * Son datos que administración ya lleva en la base de proveedores: en cuántos
 * días se le paga y cómo. Escribirlos de nuevo en cada presupuesto es trabajo
 * repetido y una oportunidad de equivocarse.
 *
 * Se completa lo que se sabe y nada más. Hoy 60 de 284 proveedores tienen el
 * plazo cargado y 109 la forma de pago, así que lo habitual es que traiga poco:
 * un campo vacío es correcto, inventarlo no.
 *
 * La forma y la condición van juntas al único campo de condiciones que tiene la
 * planilla —"ECHEQ · FF"—, que es donde una persona las escribiría.
 */
export function datosDePagoDe(p: PagoDelProveedor | null | undefined): {
  plazo: string;
  condiciones: string;
} {
  if (!p) return { plazo: "", condiciones: "" };

  // Un plazo que el desplegable no ofrece dejaría el select en blanco mostrando
  // un valor que no existe: mejor no completarlo y que la persona elija.
  const plazo =
    p.plazo_pago_dias != null && (PLAZOS_PAGO as readonly number[]).includes(p.plazo_pago_dias)
      ? String(p.plazo_pago_dias)
      : "";

  const condiciones = [p.forma_pago, p.condicion_pago]
    .map((v) => (v ?? "").trim())
    .filter(Boolean)
    .join(" · ");

  return { plazo, condiciones };
}

/**
 * Qué queda en un campo autocompletable cuando se cambia de proveedor.
 *
 * Lo que escribió una persona manda: si para esta compra se acordaron
 * condiciones distintas a las habituales del proveedor, cambiar de proveedor no
 * puede borrarlas. Lo que había puesto el autocompletado sí se reemplaza, y un
 * campo vacío se vuelve a completar.
 */
export function alCambiarDeProveedor(actual: string, puestoAntes: string, nuevo: string): string {
  return actual.trim() === "" || actual === puestoAntes ? nuevo : actual;
}

/** Un proveedor en el selector del formulario, con lo que se autocompleta de él. */
export type ProveedorElegible = { id: string; nombre: string } & PagoDelProveedor;
