/**
 * Los filtros del listado de órdenes de trabajo, leídos de la URL.
 *
 * Calcados de los de Compras, y por la misma razón: el listado tenía estado,
 * especialidad y un buscador, y con 1.819 órdenes eso no alcanza para llegar a
 * las que uno busca. «Las correctivas eléctricas de Filler 1 y Filler 2» son
 * tres preguntas que hoy hay que hacer en varias pasadas mirando la tabla.
 *
 * Cada filtro es una lista y no un valor: dentro de un filtro los valores suman
 * (o) y entre filtros se recortan (y). El caso que más se pide es el estado —
 * «qué hay abierto» es *Atrasado o En proceso o Por hacer*, y con un solo valor
 * por vez son tres pasadas para contar 36 órdenes sobre 1.819.
 *
 * La URL es el punto de entrada y también el de vuelta: el tablero enlaza acá
 * con `?estado=ATRASADO`, y al volver de una orden la tabla tiene que estar
 * como estaba.
 */

import {
  losQueEstanEnLaLista, escribirEnLaUrl, conLaPagina, elSiONo, hayAlgunFiltro as hayAlguno,
} from "@/lib/core/filtrosUrl";
import { fechaDeTexto } from "@/lib/core/fechas";
import { ESPECIALIDADES, ESTADOS_DE_OT } from "./ordenes";
import { CERRADAS } from "./alertas";

/**
 * Los valores que la planilla usa en estas tres columnas.
 *
 * No son enums de la base —la columna es texto libre, porque el origen es una
 * planilla— así que la lista se declara acá y se la valida contra ella. Salen
 * de mirar las órdenes cargadas: al 21/10/2026, sobre 2.224, `tipo` tiene dos
 * valores en uso, `quien` dos y `prioridad` tres, todos escritos siempre igual.
 *
 * **PREDICTIVO, MEJORA y MIXTO se sumaron el 21/10/2026 y tienen 0 usos.** No
 * salen de la planilla: salen de `NuevaOTModal` y `FormularioOTOffline`, que
 * tenían cada uno su copia de estas dos listas y los ofrecían. Una OT creada
 * desde ahí con uno de esos tres valores no aparecía al filtrar por nada, que
 * es exactamente lo que pasó con las prioridades el 16/10.
 *
 * Se decidió sumarlos en vez de sacarlos de las pantallas, a pedido. MIXTO
 * además **ya estaba diseñado**: `loQueFaltaParaCerrar` le exige contratista y
 * operario, y los dos formularios muestran el campo de contratista cuando se
 * elige. Era la única de las tres con código detrás.
 *
 * Lo que NO hubo que tocar, y conviene saber por qué: el MTBF cuenta fallas con
 * `tipo === "CORRECTIVO"` (`mtbf.ts`, `mtbfDatos.ts`), así que un PREDICTIVO o
 * una MEJORA no cuentan como falla — que es lo correcto, no una omisión.
 */
export const TIPOS_DE_OT = ["PROGRAMADO", "CORRECTIVO", "PREDICTIVO", "MEJORA"] as const;
export const QUIENES_DE_OT = ["INTERNO", "CONTRATADO", "MIXTO"] as const;

/**
 * Cómo se escriben esos dos vocabularios cuando los lee una persona.
 *
 * ── POR QUÉ SON UN `Record` Y NO UN TERNARIO ────────────────────────────────
 *
 * El filtro del listado los armaba así:
 *
 *     t === "PROGRAMADO" ? "Programado" : "Correctivo"
 *     q === "INTERNO"    ? "Interno"    : "Contratado"
 *
 * Eso funcionaba mientras las listas tuvieran **exactamente dos** valores. El
 * 21/10/2026 se sumaron PREDICTIVO, MEJORA y MIXTO, y al día siguiente el
 * desplegable de tipos mostraba **«Programado, Correctivo, Correctivo,
 * Correctivo»**: tres opciones distintas con la misma etiqueta, imposibles de
 * distinguir y por lo tanto de usar. El de «quién lo realiza» mostraba
 * «Contratado» dos veces.
 *
 * Nada lo notó. No hay test de pantallas, y para `tsc` un ternario sobre un
 * string es perfectamente válido: el `else` se traga cualquier valor nuevo.
 *
 * **Un `Record` sobre el propio tuple sí lo nota, y en el compilador**: agregar
 * un valor a `TIPOS_DE_OT` sin agregarle su etiqueta acá es un error de `tsc`,
 * que es lo que no pasó. Por eso el tipo se escribe contra la lista
 * —`(typeof TIPOS_DE_OT)[number]`— y no como un `Record<string, string>` suelto,
 * que volvería a tragarse el olvido.
 */
export const ETIQUETA_DE_TIPO: Record<(typeof TIPOS_DE_OT)[number], string> = {
  PROGRAMADO: "Programado",
  CORRECTIVO: "Correctivo",
  PREDICTIVO: "Predictivo",
  MEJORA: "Mejora",
};

export const ETIQUETA_DE_QUIEN: Record<(typeof QUIENES_DE_OT)[number], string> = {
  INTERNO: "Interno",
  CONTRATADO: "Contratado",
  MIXTO: "Mixto",
};

/**
 * Las dos cosas que se pueden querer decir con «reprogramada», que son filtros
 * distintos y se pidieron alcanzables juntos o por separado:
 *
 * - `hechas`: la orden ya se corrió de fecha alguna vez (`reprogramada_veces`
 *   mayor a cero; la mantiene un trigger y nadie la escribe).
 * - `necesitan`: la orden sigue abierta y su fecha de inicio ya pasó, o sea que
 *   hay que correrla.
 *
 * Es un solo filtro con dos valores y no dos filtros porque dentro de un filtro
 * los valores suman, que es lo que se pidió: elegir los dos da la unión.
 *
 * El `Record` es sobre el tuple, por lo mismo que `ETIQUETA_DE_TIPO`.
 */
export const VALORES_DE_REPROGRAMACION = ["hechas", "necesitan"] as const;

export const ETIQUETA_DE_REPROGRAMACION: Record<(typeof VALORES_DE_REPROGRAMACION)[number], string> = {
  hechas: "Ya reprogramadas",
  necesitan: "Que necesitan reprogramarse",
};

/**
 * La condición de PostgREST para `.or()` que sale de ese filtro, o `null` si no
 * hay nada que agregar. Vive acá y no en la ruta —que no tiene tests— para que
 * lo que decide cada valor se pueda probar.
 *
 * - `necesitan` usa el campo `estado` y **nunca el valor `ATRASADO`**: la planilla
 *   lo calcula contra el `TODAY()` de su última recalculada y envejece sola
 *   (de 29 abiertas vencidas, 17 decían ATRASADO). Abierta es «fuera de
 *   `CERRADAS`», la misma lista que decide qué orden está atrasada.
 * - Los dos valores se unen con coma, que en `.or()` es un o. El `and(...)` de
 *   `necesitan` va adentro para que su coma no se lea como otro o.
 * - `hoy` se valida: llega armado a un string de filtro y una fecha que no lo es
 *   podría meter otra condición.
 */
export function condicionDeReprogramacion(
  valores: readonly string[],
  hoy: string
): string | null {
  const condiciones: string[] = [];
  if (valores.includes("hechas")) condiciones.push("reprogramada_veces.gt.0");
  if (valores.includes("necesitan")) {
    const dia = fechaDeTexto(hoy);
    if (dia) {
      condiciones.push(
        `and(estado.not.in.(${CERRADAS.join(",")}),fecha_ejecucion.lt.${dia})`
      );
    }
  }
  return condiciones.length ? condiciones.join(",") : null;
}

/**
 * La prioridad viene con el emoji adelante, tal cual la escribe la planilla:
 * "🟠 Alta". Se guarda así y se filtra así, porque cambiarla acá la separaría
 * de lo que dice la celda. Ver `pesoDePrioridad` en `prioridad.ts`, que sí
 * tiene que ignorarlo para poder ordenar.
 */
export const PRIORIDADES_DE_OT = ["🟠 Alta", "🟡 Media", "🟢 Baja"] as const;

/**
 * Sobre qué fecha corre el rango.
 *
 * Una orden tiene tres y no son la misma pregunta: **cuándo se creó**
 * (`fecha`), **cuándo se hizo o se va a hacer** (`fecha_ejecucion`) y **cuándo
 * se cerró** (`fecha_cierre`). Las tres están cargadas —1.818, 1.818 y 1.566 de
 * 1.819— y elegir una por nosotros sería contestar otra cosa: "las de agosto"
 * da 180 por creación y 195 por inicio, y quien pregunta sabe cuál quiere.
 *
 * El default es `fecha`, que es la que la tabla muestra y la más completa.
 *
 * **Los rótulos cambiaron el 18/11/2026 y las columnas no.** La planilla pasó
 * a llamar «FECHA DE INICIO» a la J —que decía «FECHA DE EJECUCIÓN»— y acá se
 * emparejó la pantalla, incluida la primera, que se decía «fecha de la orden»
 * y ahora dice de creación. Los valores (`""`, `fecha_ejecucion`,
 * `fecha_cierre`) son los mismos a propósito: viajan en la URL del listado y
 * en los filtros guardados, así que renombrarlos rompería los enlaces que
 * alguien ya tiene anotados, y la columna de la base sigue llamándose
 * `fecha_ejecucion`.
 */
export const CAMPOS_DE_FECHA = [
  ["", "Fecha de creación"],
  ["fecha_ejecucion", "Fecha de inicio"],
  ["fecha_cierre", "Fecha de cierre"],
] as const;

const CAMPOS_VALIDOS: readonly string[] = CAMPOS_DE_FECHA.map(([v]) => v);

/**
 * En qué orden se listan las órdenes.
 *
 * **Desde el 18/11/2026 el listado arranca por número**, de la más nueva a la
 * más vieja, que es como se nombra una orden cuando alguien pregunta "¿qué pasó
 * con la 2884?". Se pidió, y el motivo es que las dos cosas que se hacen con
 * esta pantalla no se ordenan igual: buscar una orden puntual quiere el número,
 * y repartir trabajo quiere el GUT.
 *
 * El sugerido —`gut_orden` descendente, que sube lo abierto por encima de lo
 * cerrado y dentro de eso lo de más puntaje— **no se fue a ningún lado**: sigue
 * en el desplegable y a un clic. Y la pregunta para la que existe ya tiene su
 * propia pestaña en esta misma pantalla, «En qué orden hacer lo que está
 * pendiente», que no está paginada ni filtrada y lo contesta mejor que un
 * listado de 2.516 filas de a 50.
 *
 * EL QUE SE DIO VUELTA ES EL `""`, Y ESO HAY QUE LEERLO DESPACIO PORQUE LA
 * PANTALLA Y LA RUTA NO LO ENTIENDEN IGUAL, A PROPÓSITO:
 *
 * - Para **la pantalla**, `""` es el número: el default no viaja a la barra de
 *   direcciones —`escribirEnLaUrl` saltea lo vacío—, igual que el primer valor
 *   de `CAMPOS_DE_FECHA`. Por eso el sugerido necesitó un valor propio: si
 *   fuera él el vacío, **elegirlo no se podría guardar en el enlace** y al
 *   recargar volvería al número.
 * - Para **la ruta**, un pedido sin `orden` sigue siendo el sugerido, y eso es
 *   lo que deja en su sitio a los **cuatro** lugares que piden órdenes sin
 *   decir ninguno: el tablero kanban —donde cada columna muestra primero lo más
 *   urgente—, el historial de un equipo, la pantalla de mantenimientos y
 *   `?pendientes=1`.
 *
 * Las dos lecturas conviven porque **`consultaDeLaRuta` traduce**: lo que la
 * pantalla calla, al pedirle los datos a la API lo dice como `orden=numero`.
 * La barra de direcciones habla el idioma de la pantalla y la consulta el de la
 * ruta, que es la misma distinción que ya hacía la página (`pagina` contra
 * `page`).
 *
 * Un enlace viejo con `?orden=numero` sigue ordenando por número: la pantalla
 * sólo distingue el sugerido de todo lo demás, así que lo lee como `""`, que es
 * justamente el número, y en la próxima escritura el parámetro se cae solo.
 *
 * Ordenar **en la base y no en el cliente**, igual que el resto: son 2.516
 * filas paginadas de a 50, y ordenar la página que se está mirando no es
 * ordenar nada.
 */
export const ORDENES_DEL_LISTADO = [
  ["", "N° de OT"],
  ["gut", "Sugerido (GUT)"],
] as const;

/**
 * **La lista blanca no sale del desplegable, y es la única del archivo que no
 * lo hace.** `numero` no es una opción —la opción por número vale `""`— pero sí
 * es un valor que hay que aceptar: es el que `consultaDeLaRuta` le manda a la
 * ruta, porque del otro lado el vacío quiere decir el sugerido, y es además el
 * que traen los enlaces anteriores al 18/11/2026.
 */
const ORDENES_VALIDOS: readonly string[] = ["", "numero", "gut"];

/**
 * El orden pedido, o `""` —que para la pantalla es el número y para la ruta el
 * sugerido— si no se reconoce. El porqué de esas dos lecturas está arriba.
 *
 * La lista blanca vive acá y no en la ruta por lo mismo que `columnaDeFecha`:
 * de esto sale un nombre de columna para la consulta, y dejar que quien lo use
 * se acuerde de validarlo es cómo alguna vez no se acuerda.
 */
export function ordenDelListado(valor: string | null | undefined): string {
  const elegido = String(valor ?? "");
  return ORDENES_VALIDOS.includes(elegido) ? elegido : "";
}

/**
 * La columna que hay que filtrar. Lo que no está en la lista cae en `fecha`.
 *
 * La lista blanca vive **acá y no en la ruta**, aunque sea la ruta la que
 * arma la consulta: es un nombre de columna que viene de la URL, y dejar que
 * quien lo use se acuerde de validarlo es cómo alguna vez no se acuerda. Así
 * la función es segura sola y se puede probar.
 */
export function columnaDeFecha(campo: string | null | undefined): string {
  const elegido = String(campo ?? "");
  return elegido && CAMPOS_VALIDOS.includes(elegido) ? elegido : "fecha";
}

/**
 * Una fecha de la URL, o `""`.
 *
 * Se valida con el mismo parser que el resto del sistema, que descarta el 31 de
 * febrero en vez de convertirlo en 3 de marzo. Una fecha imposible en la URL
 * dejaría la tabla vacía sin que se vea por qué.
 */
const laFecha = (params: URLSearchParams, nombre: string): string =>
  fechaDeTexto(params.get(nombre)) ?? "";

export interface FiltrosOt {
  busqueda: string;
  /** Sobre cuál de las tres fechas corre el rango. `""` es `fecha`. */
  campoFecha: string;
  /** En qué orden se listan. `""` es el sugerido. Ver `ORDENES_DEL_LISTADO`. */
  orden: string;
  /** "YYYY-MM-DD", los dos inclusive. `""` es sin límite de ese lado. */
  desde: string;
  hasta: string;
  estado: string[];
  especialidad: string[];
  tipo: string[];
  quien: string[];
  prioridad: string[];
  /**
   * El contratista, por su id de proveedor y no por el texto de la columna.
   * La 032 ya decidió que los contratistas son proveedores del núcleo, y las
   * 427 órdenes contratadas tienen el enlace puesto.
   */
  proveedor: string[];
  sector: string[];
  equipo: string[];
  /** `hechas` y/o `necesitan`. Ver `VALORES_DE_REPROGRAMACION`. */
  reprogramacion: string[];
  /**
   * «Se le pasó la fecha», el mismo criterio que `estaAtrasada` de `alertas.ts`
   * (abierta y con la fecha de inicio —o la pendiente— anterior a hoy).
   *
   * **No es un valor más de `estado`**: ese vocabulario espeja el de la
   * planilla y `ATRASADO` ahí es lo que alguien escribió en la celda, que no
   * es lo mismo. Meterle un valor inventado rompería la validación contra
   * `ESTADOS_DE_OT`. Es un sí o un no, y viaja como `atrasada=1`.
   *
   * **Se parece a `reprogramacion=necesitan` y no es lo mismo**, que es lo que
   * hay que saber antes de tocar cualquiera de los dos: éste cuenta además el
   * `ATRASADO` que escribió una persona en la planilla y respeta la ventana de
   * `fecha_fin`, mientras que el otro pregunta por lo que hay que correr de
   * fecha y mira sólo las fechas. Ver `condicionDeReprogramacion`.
   */
  atrasada: boolean;
}

export const FILTROS_VACIOS: FiltrosOt = {
  busqueda: "", campoFecha: "", orden: "", desde: "", hasta: "",
  estado: [], especialidad: [], tipo: [], quien: [],
  prioridad: [], proveedor: [], sector: [], equipo: [], reprogramacion: [],
  atrasada: false,
};

/** Las listas contra las que se validan los filtros que son referencias. */
export interface CatalogosOt {
  sectores: string[];
  equipos: string[];
  proveedores: string[];
}

export function leerFiltrosDeLaUrl(
  params: URLSearchParams,
  catalogos: CatalogosOt
): FiltrosOt {
  return {
    busqueda: params.get("q")?.trim() ?? "",
    // Se guarda "" cuando es la de siempre: así el desplegable arranca en su
    // primera opción y el parámetro no viaja de más.
    campoFecha: CAMPOS_VALIDOS.includes(params.get("campo_fecha") ?? "")
      ? params.get("campo_fecha") ?? ""
      : "",
    // La pantalla tiene dos estados y no tres: el sugerido, o el número —que
    // es `""` desde el 18/11/2026—. Todo lo demás cae en el número, y ahí entra
    // el `orden=numero` de los enlaces viejos, que así siguen diciendo lo
    // mismo y además se limpian solos en la próxima escritura. Ver
    // `ORDENES_DEL_LISTADO`: la ruta lee ese mismo vacío al revés.
    orden: ordenDelListado(params.get("orden")) === "gut" ? "gut" : "",
    desde: laFecha(params, "desde"),
    hasta: laFecha(params, "hasta"),
    estado: losQueEstanEnLaLista(params, "estado", ESTADOS_DE_OT),
    especialidad: losQueEstanEnLaLista(params, "especialidad", ESPECIALIDADES),
    tipo: losQueEstanEnLaLista(params, "tipo", TIPOS_DE_OT),
    quien: losQueEstanEnLaLista(params, "quien", QUIENES_DE_OT),
    prioridad: losQueEstanEnLaLista(params, "prioridad", PRIORIDADES_DE_OT),
    proveedor: losQueEstanEnLaLista(params, "proveedor", catalogos.proveedores),
    sector: losQueEstanEnLaLista(params, "sector", catalogos.sectores),
    equipo: losQueEstanEnLaLista(params, "equipo", catalogos.equipos),
    reprogramacion: losQueEstanEnLaLista(params, "reprogramacion", VALORES_DE_REPROGRAMACION),
    atrasada: elSiONo(params, "atrasada"),
  };
}

/**
 * Si hay algo puesto. Sirve para saber si la tabla vacía es por los filtros.
 *
 * `campoFecha` no cuenta: elegir "fecha de cierre" sin poner ningún día no
 * filtra nada, y hacerlo contar dejaría el cartel diciendo que hay filtros
 * cuando no los hay.
 */
export const hayAlgunFiltro = (f: FiltrosOt): boolean =>
  hayAlguno({ ...f, campoFecha: "", orden: "" });

/** El orden en que van los filtros en la URL, y con qué nombre. */
const NOMBRES: readonly [keyof FiltrosOt, string][] = [
  ["busqueda", "q"],
  ["campoFecha", "campo_fecha"],
  ["orden", "orden"],
  ["desde", "desde"],
  ["hasta", "hasta"],
  ["estado", "estado"],
  ["especialidad", "especialidad"],
  ["tipo", "tipo"],
  ["quien", "quien"],
  ["prioridad", "prioridad"],
  ["proveedor", "proveedor"],
  ["sector", "sector"],
  ["equipo", "equipo"],
  ["reprogramacion", "reprogramacion"],
  ["atrasada", "atrasada"],
];

/**
 * Sin fechas puestas, `campoFecha` no viaja: no filtra nada y ensuciaría el
 * enlace que alguien copia con un parámetro que no hace nada.
 */
/**
 * Los filtros, y en qué página está parado el listado, como query string.
 *
 * La página se cuenta desde uno, igual que en la URL y que en los botones de
 * abajo de la tabla; acá adentro también, así que no hay nada que convertir, y
 * la primera no se escribe. Sin ella, entrar a una orden desde la página 3 y
 * volver dejaba la tabla filtrada pero cien filas más arriba de donde se
 * estaba.
 */
export const escribirFiltrosEnLaUrl = (f: FiltrosOt, pagina = 1): string =>
  conLaPagina(
    escribirEnLaUrl(f.desde || f.hasta ? f : { ...f, campoFecha: "" }, NOMBRES),
    pagina
  );

/**
 * Los filtros como los espera la ruta.
 *
 * Es el mismo query string que la barra de direcciones, y a propósito: lo que
 * se puede pegar en el navegador es lo que la API entiende, así que reproducir
 * lo que alguien ve no requiere traducir nada.
 *
 * La página se agrega aparte, con el nombre que espera la ruta y siempre,
 * aunque sea la primera. En la barra de direcciones va como `pagina` y sólo
 * cuando no es la primera: son dos cosas parecidas con reglas distintas, una
 * para pedirle datos al servidor y otra para que un enlace se pueda leer y
 * compartir. Por eso acá se piden los filtros sin página y se pega la propia.
 *
 * **El orden es el segundo de esos casos, y desde el 18/11/2026 es el que más
 * importa:** la pantalla calla el suyo cuando es el de siempre —por número—,
 * pero callarlo del lado de la ruta querría decir otra cosa, el sugerido, que
 * es lo que la ruta le sigue dando a los cuatro lugares que no piden ninguno.
 * Así que acá se dice en voz alta. Sin esta línea el listado arrancaría por
 * GUT y el desplegable diría «N° de OT»: nada fallaría y todo estaría mal. El
 * porqué completo está en `ORDENES_DEL_LISTADO`.
 */
export function consultaDeLaRuta(f: FiltrosOt, pagina: number): string {
  const query = escribirFiltrosEnLaUrl({ ...f, orden: f.orden || "numero" });
  return query ? `${query}&page=${pagina}` : `page=${pagina}`;
}
