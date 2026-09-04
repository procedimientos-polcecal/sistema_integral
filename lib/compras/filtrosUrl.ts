import { ESTADOS_APROBACION, ESTADOS_COMPRA, PRIORIDADES } from "./constants";

/**
 * Los filtros del listado, leídos de la URL.
 *
 * El listado guardaba sus filtros sólo en memoria, así que un enlace con
 * `?estado_compra=PEDIDO` abría la tabla entera sin filtrar. El tablero ya
 * enlazaba así desde el cartel de pedidos viejos: la promesa estaba hecha y no
 * se cumplía.
 *
 * Se leen al montar y se vuelven a escribir con cada cambio, con
 * `escribirFiltrosEnLaUrl`: el query string es el estado de la pantalla y no
 * sólo su punto de entrada. Mientras fue nada más que la entrada, entrar a un
 * requerimiento y volver con el botón de atrás devolvía la tabla sin filtrar,
 * y había que rearmar los desplegables cada vez.
 *
 * Cada filtro es una lista y no un valor: un solo estado por vez obligaba a
 * mirar «Cotizando» y «Para comprar» en dos pasadas, cuando lo que se quiere
 * saber es qué hay abierto. Dentro de un filtro los valores suman (o), y entre
 * filtros se recortan (y): «área Mantenimiento, estado Pedido o En camino».
 */
export interface FiltrosCompras {
  busqueda: string;
  area: string[];
  aprobacion: string[];
  compra: string[];
  prioridad: string[];
  empresa: string[];
  proveedor: string[];
  ubicacion: string[];
  /**
   * La máquina y el sector de planta salen del catálogo de ubicaciones, no del
   * requerimiento: el enlace vive ahí desde la 019. Son otra forma de recortar
   * lo mismo —"Doosan 300" es una ubicación y es un equipo—, y conviven porque
   * una máquina puede tener más de una ubicación y un sector, varias.
   */
  equipo: string[];
  sector: string[];
}

export const FILTROS_VACIOS: FiltrosCompras = {
  busqueda: "", area: [], aprobacion: [], compra: [],
  prioridad: [], empresa: [], proveedor: [], ubicacion: [],
  equipo: [], sector: [],
};

/** Las listas contra las que se validan los filtros que son referencias. */
export interface Catalogos {
  areas: string[];
  empresas: string[];
  proveedores: string[];
  ubicaciones: string[];
  /** Sólo los que tienen alguna ubicación enlazada: el resto daría vacío. */
  equipos: string[];
  sectores: string[];
}

/**
 * Los valores que trajo la URL para un filtro, ya validados.
 *
 * Se aceptan las dos formas: repetido (`?prioridad=ALTA&prioridad=URGENTE`),
 * que es lo que arma un formulario, y separado por comas
 * (`?prioridad=ALTA,URGENTE`), que es lo que se manda por chat sin que la URL
 * se vuelva ilegible. Ningún id ni ningún estado tiene comas, así que partir
 * por coma no rompe nada.
 *
 * Un valor que no está en la lista se descarta en silencio. Es preferible a
 * dejarlo puesto: un filtro que la persona no ve —porque el desplegable no
 * tiene esa opción— y no puede quitar deja una tabla vacía que se lee como "no
 * hay nada".
 */
function losQueEstanEnLaLista(
  params: URLSearchParams,
  nombre: string,
  permitidos: readonly string[]
): string[] {
  const vistos = new Set<string>();
  for (const crudo of params.getAll(nombre)) {
    for (const valor of crudo.split(",")) {
      const v = valor.trim();
      // Repetir un valor en la URL no tendría por qué duplicarlo en el `.in()`.
      if (v && permitidos.includes(v)) vistos.add(v);
    }
  }
  return [...vistos];
}

export function leerFiltrosDeLaUrl(
  params: URLSearchParams,
  catalogos: Catalogos
): FiltrosCompras {
  return {
    busqueda: params.get("q")?.trim() ?? "",
    area: losQueEstanEnLaLista(params, "area", catalogos.areas),
    aprobacion: losQueEstanEnLaLista(params, "estado_aprobacion", ESTADOS_APROBACION),
    compra: losQueEstanEnLaLista(params, "estado_compra", ESTADOS_COMPRA),
    prioridad: losQueEstanEnLaLista(params, "prioridad", PRIORIDADES),
    // "AMBAS" no es una empresa sino una condición —los RI que no tienen
    // ninguna, porque pagan las dos—, así que se acepta además de los ids.
    empresa: losQueEstanEnLaLista(params, "empresa", [...catalogos.empresas, "AMBAS"]),
    proveedor: losQueEstanEnLaLista(params, "proveedor", catalogos.proveedores),
    ubicacion: losQueEstanEnLaLista(params, "ubicacion", catalogos.ubicaciones),
    equipo: losQueEstanEnLaLista(params, "equipo", catalogos.equipos),
    sector: losQueEstanEnLaLista(params, "sector", catalogos.sectores),
  };
}

/** Si la URL trajo algo utilizable. Sirve para saber si arrancar filtrado. */
export function hayAlgunFiltro(f: FiltrosCompras): boolean {
  return Object.values(f).some((v) => (Array.isArray(v) ? v.length > 0 : Boolean(v)));
}

/** El orden en que van los filtros en la URL, y con qué nombre. */
const NOMBRES: [keyof FiltrosCompras, string][] = [
  ["busqueda", "q"],
  ["area", "area"],
  ["aprobacion", "estado_aprobacion"],
  ["compra", "estado_compra"],
  ["prioridad", "prioridad"],
  ["empresa", "empresa"],
  ["proveedor", "proveedor"],
  ["ubicacion", "ubicacion"],
  ["equipo", "equipo"],
  ["sector", "sector"],
];

/**
 * Los filtros de vuelta como query string, sin el `?`. Vacío si no hay ninguno.
 *
 * Es la inversa de `leerFiltrosDeLaUrl`: lo que sale de acá tiene que volver
 * igual al leerse, porque de eso depende que el botón de atrás devuelva la
 * tabla como estaba.
 *
 * Cada filtro va en un solo parámetro con los valores separados por comas
 * —`?prioridad=ALTA,URGENTE`— y no repetido: es la forma que deja la URL
 * legible y la que se puede pasar por chat. El orden es fijo para que tocar
 * dos veces el mismo desplegable no cambie la URL.
 *
 * La página va última y sólo si no es la primera, que es el caso de siempre:
 * un `?pagina=1` en cada enlace sería ruido. Adentro se cuenta desde cero
 * porque así se calcula el `range()`, pero en la URL se escribe como la lee
 * quien la mira —`?pagina=2` es la segunda—, que es también lo que dicen los
 * botones de abajo de la tabla.
 */
export function escribirFiltrosEnLaUrl(f: FiltrosCompras, pagina = 0): string {
  const params = new URLSearchParams();
  for (const [clave, nombre] of NOMBRES) {
    const valor = f[clave];
    if (Array.isArray(valor)) {
      if (valor.length) params.set(nombre, valor.join(","));
    } else if (valor.trim()) {
      params.set(nombre, valor.trim());
    }
  }
  if (pagina > 0) params.set("pagina", String(pagina + 1));
  return params.toString();
}

/**
 * En qué página arranca el listado. Cero es la primera.
 *
 * Sin esto, entrar a un RI desde la página 3 y volver dejaba la tabla en la 1,
 * con los filtros puestos pero doscientas filas más arriba de donde se estaba.
 *
 * Cualquier cosa que no sea un entero de una página en adelante es la primera.
 * No se valida contra cuántas hay —eso no se sabe hasta consultar—, así que un
 * número de más lo acomoda el listado cuando ve el total: una tabla vacía se
 * lee como "no hay nada" y acá no habría nada que lo desmienta.
 */
export function leerPaginaDeLaUrl(params: URLSearchParams): number {
  const crudo = params.get("pagina");
  if (!crudo) return 0;
  const numero = Number(crudo);
  if (!Number.isInteger(numero) || numero < 1) return 0;
  return numero - 1;
}

/**
 * El enlace a la ficha de un RI desde el listado, cargando de dónde se salió.
 *
 * El botón de atrás del navegador ya devuelve la tabla filtrada, porque la URL
 * del listado sigue a los filtros. Pero el «← Volver a requerimientos» de la
 * ficha es un enlace hacia adelante, no un retroceso: sin esto navega a la URL
 * pelada y deja la tabla entera, que era el mismo problema por otra puerta.
 *
 * Se manda el query string del listado y no un "volvé atrás" a secas: a la
 * ficha se llega también desde el tablero, la bandeja o el panel, y desde ahí
 * lo correcto es el listado limpio. Si no se sabe de dónde vino, no se inventa.
 */
export function enlaceAlRequerimiento(id: string, query: string): string {
  const ficha = `/compras/requerimientos/${id}`;
  return query ? `${ficha}?volver=${encodeURIComponent(query)}` : ficha;
}

/**
 * A dónde lleva el «← Volver a requerimientos» de la ficha.
 *
 * Lo que trae el parámetro es texto que llega por la URL, así que no se pega
 * tal cual: se lo parsea y se lo vuelve a serializar. Lo que salga de acá es
 * siempre la misma ruta con un query string bien formado —nada puede correr el
 * enlace a otra parte—, y un filtro que no exista lo descarta el listado al
 * leerlo, que es donde están los catálogos para saberlo.
 */
export function volverAlListado(volver: string | string[] | undefined): string {
  const crudo = Array.isArray(volver) ? volver[0] : volver;
  const query = new URLSearchParams(crudo ?? "").toString();
  return query ? `/compras/requerimientos?${query}` : "/compras/requerimientos";
}
