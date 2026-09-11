/**
 * Sincronización con la planilla "PEDIDOS DE COMPRA" de Google Sheets.
 *
 * Convivencia durante la transición:
 *   - La planilla manda en el ALTA: los RI nuevos siguen entrando por el
 *     formulario de Google y la app los incorpora.
 *   - La app manda en lo que GESTIONA: apenas se aprueba, se elige proveedor o
 *     se carga un costo desde el sistema, un trigger marca `editado_en_app` y
 *     la importación deja de pisar ese requerimiento.
 *
 * La cuenta de servicio de Google necesita permiso de EDITOR sobre la planilla.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { traerTodo } from "@/lib/core/paginado";
import { letraDeColumna } from "@/lib/core/columnaDeSheets";
import { fechaDeTexto } from "@/lib/core/fechas";
import { norm } from "@/lib/compras/texto";
import { esFilaPlantilla } from "@/lib/compras/constants";
import { linkDeCelda, planillasPorRi } from "@/lib/compras/vincular";
import { fusionarConLoQueYaHabia } from "@/lib/compras/fusionDeLaPlanilla";
import { punterosARefrescar, type DondeEsta } from "@/lib/compras/punteroDeLaPlanilla";
// Ciclo de imports a propósito: `formulario.ts` toma `empresaParaPlanilla` e
// `indexarColumnas` de acá. Las cuatro son funciones y ninguna se llama al
// cargar el módulo, así que en ESM el ciclo se resuelve solo. Se deja anotado
// para que el día que alguien agregue una constante de módulo que llame a la
// otra punta sepa por qué explota: la salida sería mover lo compartido a un
// archivo que no dependa de nada de Sheets (`lib/compras/texto.ts`).
import { exportarAltaAlFormulario } from "@/lib/compras/formulario";
import type { EstadoAprobacion, EstadoCompra, Prioridad } from "@/lib/compras/types";
import {
  obtenerToken as tokenGoogle, SCOPE_SHEETS, SCOPE_SHEETS_LECTURA,
} from "@/lib/core/google";

const HOJA_MASTER = "Requerimientos internos";

/**
 * Si una pestaña es la de un área.
 *
 * Las hojas por área se llaman `RI <ÁREA>` —`RI MANTENIMIENTO`, `RI ALMACÉN`— y
 * el criterio es **ese prefijo**, no "cualquiera que no sea el master".
 * Preguntar por la negativa daba verdadero para cualquier hoja ajena, y
 * `hoja_origen` puede guardar el nombre de una hoja de **otra** planilla: el
 * alta anota la hoja de respuestas del formulario, donde las columnas N a R no
 * son las de compra sino las que escribe Google. Escribir proveedor, estado y
 * costos ahí sería pisar datos del formulario.
 *
 * Es el mismo prefijo con el que la importación elige qué pestañas leer, y eso
 * es a propósito: la importación es quien escribe `hoja_origen`, así que las dos
 * puntas coinciden por construcción y no por casualidad.
 */
export const esPestanaDeArea = (pestana: string) => pestana.startsWith("RI ");

type Admin = ReturnType<typeof createAdminClient>;

// ── Autenticación con Google ─────────────────────────
// El JWT vive en google.ts: listar la carpeta de comparativas necesita un
// scope que este archivo no pide.

const obtenerToken = (escritura: boolean) =>
  tokenGoogle([escritura ? SCOPE_SHEETS : SCOPE_SHEETS_LECTURA]);

const idPlanilla = () => {
  const id = process.env.GOOGLE_SHEETS_COMPRAS_ID ?? "";
  if (!id) throw new Error("GOOGLE_SHEETS_COMPRAS_ID no configurado");
  return id;
};

/**
 * Lo que no cambia durante una corrida de escrituras.
 *
 * Escribir un RI en la planilla cuesta unas 13 llamadas a la API de Sheets, y
 * cinco de ellas son idénticas para todos los RI de la misma corrida: las
 * opciones del desplegable de aprobación, los encabezados de cada pestaña y la
 * columna de N° del master —que además son 1885 filas cada vez—.
 *
 * Con doce pendientes eso daban ~156 llamadas en pocos segundos y Google
 * devolvía 429: el reintento se autoinfligía el límite de cuota y anotaba el
 * 429 como si la planilla hubiera rechazado los cambios.
 *
 * El cache vive lo que dura la corrida, no más. Sin cache la función se
 * comporta igual que antes: cada llamada suelta arma el suyo.
 */
export interface CacheSheets {
  opciones?: string[];
  encabezados: Map<string, string[]>;
  filasDelMaster?: Map<number, number>;
}

export function nuevoCacheSheets(): CacheSheets {
  return { encabezados: new Map() };
}

async function leerPestana(pestana: string): Promise<string[][]> {
  const token = await obtenerToken(false);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${idPlanilla()}/values/${encodeURIComponent(pestana)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Sheets API ${res.status}: ${await res.text()}`);
  return ((await res.json()).values ?? []) as string[][];
}

async function listarPestanas(): Promise<string[]> {
  const token = await obtenerToken(false);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${idPlanilla()}?fields=sheets.properties.title`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Sheets API ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return (json.sheets ?? []).map((s: { properties: { title: string } }) => s.properties.title);
}

// ── Normalización ────────────────────────────────────────────

/**
 * Los encabezados no son idénticos entre pestañas: la cantidad viene como
 * `CAN` o `CANTIDAD`, y el proveedor como `PROVEEDOR` o `PROVEEDOR ELEGIDO`.
 */
const ALIAS: Record<string, string[]> = {
  nro_ri: ["N RI", "NRO RI", "N  RI"],
  fecha: ["FECHA"],
  area: ["AREA"],
  descripcion: ["DESCRIPCION"],
  codigo: ["CODIGO"],
  cantidad: ["CANTIDAD", "CAN"],
  ubicacion: ["DONDE SE NECESITA"],
  fecha_necesidad: ["FECHA DE REQUERIMIENTO"],
  detalle_extra: ["DETALLE EXTRA"],
  imagen: ["IMAGEN COMPLEMENTARIA", "IMAGEN"],
  prioridad: ["PRIORIDAD"],
  empresa: ["EMPRESA", "PAGA"],
  // El encabezado se compara **entero**, no por contenido: "QUIEN SOLICITA" no
  // entra por "SOLICITA". Con ese único alias, los 1.947 requerimientos
  // importados quedaron sin solicitante —ni uno—, y sin solicitante la pantalla
  // de Mis pedidos no le puede mostrar a nadie lo que pidió. Van las formas en
  // que suele estar escrita esa columna; la que exista gana y el resto no
  // molesta.
  solicita: [
    "SOLICITA", "SOLICITANTE", "QUIEN SOLICITA", "QUIEN LO SOLICITA",
    "SOLICITADO POR", "PEDIDO POR", "QUIEN PIDE",
  ],
  comparativa: ["COMPARATIVA PROVEEDORES"],
  proveedor: ["PROVEEDOR ELEGIDO", "PROVEEDOR"],
  estado: ["ESTADO"],
  costo_iva: ["COSTO + IVA", "COSTO IVA"],
  costo_envio: ["COSTO ENVIO"],
};

/**
 * En qué columna está cada cosa, según el encabezado de la pestaña.
 *
 * Exportada porque el alta —`lib/compras/formulario.ts`— escribe PRIORIDAD y
 * EMPRESA en la misma hoja y tenía su propia tabla de alias para esas dos
 * columnas. Coincidían, pero eran dos dueños que no se hablaban: el día que
 * alguien sume un alias acá, allá no se enteraba. Ese archivo ya importa de
 * éste, así que compartir el indexador no agrega acoplamiento nuevo.
 */
export function indexarColumnas(encabezado: string[]): Record<string, number> {
  const normalizado = encabezado.map(norm);
  const idx: Record<string, number> = {};
  for (const [clave, alias] of Object.entries(ALIAS)) {
    idx[clave] = -1;
    for (const a of alias) {
      const i = normalizado.indexOf(norm(a));
      if (i >= 0) { idx[clave] = i; break; }
    }
  }
  // En todas las pestañas la primera columna es el N° de RI, aunque el
  // encabezado venga con un formato raro.
  if (idx.nro_ri < 0) idx.nro_ri = 0;
  return idx;
}

const texto = (v: unknown) => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};

function numero(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  // Conviven "$1.234.567,89" y "1,234,567.89"
  const limpio = String(v).replace(/[^0-9.,-]/g, "");
  if (!limpio) return null;
  const ultimaComa = limpio.lastIndexOf(",");
  const ultimoPunto = limpio.lastIndexOf(".");
  const normalizado = ultimaComa > ultimoPunto
    ? limpio.replace(/\./g, "").replace(",", ".")
    : limpio.replace(/,/g, "");
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

/**
 * Fechas de la planilla, que las escribe en d/m/aaaa.
 *
 * La regla vive en `lib/core/fechas.ts`: por qué no se adivina el orden de día
 * y mes, y por qué una fecha imposible se descarta en vez de dejar que
 * `new Date` la haga rodar. Estaba acá y repetida —sin validar— en
 * `compras/comparativa.ts`.
 *
 * Lo que se pierde al unificar: la versión de acá tenía un `new Date(s)` de
 * último recurso para cualquier texto que Node pudiera interpretar. Se saca a
 * propósito. Esa rama es justamente por donde entra la ambigüedad de locale que
 * ya dio vuelta el día y el mes en el 39% de los requerimientos, y la planilla
 * escribe un solo formato.
 */
export const fechaISO = fechaDeTexto;

const PRIORIDADES_VALIDAS = new Set(["URGENTE", "1 SEMANA", "2 SEMANAS", "NORMAL", "LEVE"]);

/** Sin valor por defecto: la celda vacía significa "todavía no se decidió". */
const prioridadDe = (v: unknown) => {
  const s = norm(v);
  return PRIORIDADES_VALIDAS.has(s) ? s : null;
};

/**
 * Qué dice la planilla sobre quién paga. `null` cuando la celda vino vacía:
 * es la ausencia de una decisión, no una decisión ("ninguna de las dos").
 * Antes `pagaDe("")` devolvía `{empresa: null, ambas: false}` —el mismo
 * objeto que un valor no reconocido o que "ninguna de las dos" explícita—,
 * así que vacío y decisión se confundían.
 */
export const pagaDe = (v: unknown): { empresa: string | null; ambas: boolean } | null => {
  const s = norm(v);
  if (!s) return null;
  if (s === "AMBAS") return { empresa: null, ambas: true };
  if (s === "POLCECAL" || s === "POLYSAN") return { empresa: s, ambas: false };
  return { empresa: null, ambas: false };
};


function partirEstado(valor: unknown) {
  const s = norm(valor);
  if (!s) return { base: null as string | null, quien: null as string | null };
  const m = s.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  return m ? { base: m[1].trim(), quien: m[2].trim() } : { base: s, quien: null };
}

/**
 * "APROBADA (NICO)" → el paréntesis es quién aprobó, no otro estado.
 *
 * Devuelve `null` cuando no se puede leer: la celda vacía o con algo inesperado
 * significa "no sé", no "pendiente". Devolver el valor por defecto hacía que la
 * sincronización pisara aprobaciones ya dadas.
 */
export function estadoAprobacionDe(valor: unknown) {
  const { base, quien } = partirEstado(valor);
  if (!base) return { estado: null as string | null, aprobador: null as string | null };
  if (base.startsWith("APROBAD")) return { estado: "APROBADA", aprobador: quien };
  if (base.startsWith("DENEGAD") || base.startsWith("RECHAZ")) return { estado: "DENEGADA", aprobador: quien };
  if (base.includes("REVISI")) return { estado: "EN_REVISION", aprobador: null };
  return { estado: null, aprobador: null };
}

/**
 * El estado de compra que dice la hoja del área.
 *
 * Devuelve `null` cuando no se puede leer, por la misma razon que arriba: en una
 * sola corrida, tomar la celda ilegible como SIN_INICIAR mandó 15 requerimientos
 * de PEDIDO a foja cero.
 */
export function estadoCompraDe(valor: unknown) {
  const { base, quien } = partirEstado(valor);
  if (!base) return { estado: null as string | null, aprobador: null as string | null };
  if (base === "PEDIDO") return { estado: "PEDIDO", aprobador: null };
  // Un pedido frenado a propósito. Va antes que el resto porque "EN ESPERA"
  // empieza igual que "EN PROCESO" y ese chequeo se lo llevaría puesto.
  if (base.startsWith("EN ESPERA")) return { estado: "EN_ESPERA", aprobador: null };
  if (base === "RECIBIDO") return { estado: "RECIBIDO", aprobador: null };
  if (base.startsWith("DENEGAD")) return { estado: "DENEGADO", aprobador: null };
  if (base.includes("COMPARATIVA") || base.startsWith("EN PROCESO")) {
    return { estado: "EN_COMPARATIVA", aprobador: null };
  }
  if (base.startsWith("PARA COMPRAR")) {
    // El paréntesis dice a quién le toca aprobar la compra. "(POR APROBAR)" no
    // nombra a nadie: sólo marca que falta.
    const esPersona = quien && !/POR APROBAR/i.test(quien);
    return { estado: "PARA_COMPRAR", aprobador: esPersona ? quien : null };
  }
  if (base.startsWith("APROBAD")) return { estado: "APROBADO", aprobador: quien };
  return { estado: null, aprobador: null };
}

/** "MORC SRL" y "MORC" son el mismo proveedor. */
export function claveProveedor(nombre: string) {
  return nombre
    .toUpperCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/["'.]/g, "")
    .replace(/\b(S\s?R\s?L|SA|S\s?A|SAS|SACIF|SRL)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Importar: planilla → app ─────────────────────────────────

export interface ResultadoSync {
  filas_leidas: number;
  filas_nuevas: number;
  filas_actualizadas: number;
  filas_omitidas: number;
}

/**
 * Lo mismo, más lo que se pudo hacer con la columna de comparativa.
 *
 * Va aparte porque `ResultadoSync` es exactamente lo que entra en
 * `compras_sincronizaciones`, y esa tabla no tiene estas columnas. Esto es lo
 * que ve quien aprieta el botón.
 */
export interface ResultadoSyncCompleto extends ResultadoSync {
  /** Requerimientos a los que la planilla les enlazó una planilla de comparativa. */
  comparativas: number;
  /** Links de comparativa que no son una planilla: no se pueden abrir como tal. */
  comparativas_sin_planilla: number;
  /** Si no se pudieron leer los links, por qué. La importación siguió igual. */
  comparativas_error?: string;
  /**
   * Cuántos de los RI salteados cambiaron de lugar en la planilla.
   *
   * Va **aparte de `filas_omitidas`** y no sumado a `filas_actualizadas`: esas
   * dos cuentas significan "no se pisó el dato" y "se pisó el dato", y esto no
   * es ninguna de las dos —se movió el puntero de una fila que igual no se
   * pisó—. Se informa porque es la única señal de que los RI congelados se
   * están reacomodando: en régimen tiene que dar 0, y un número alto corrida
   * tras corrida diría que hay filas bailando en la planilla.
   */
  punteros_actualizados: number;
  /**
   * Si algún puntero no se pudo guardar, por qué. La importación siguió igual:
   * lo que se pierde es que ese RI exporte a la celda que le toca, no el alta
   * de los nuevos. Se devuelve en vez de quedar en un `console.warn` porque un
   * fallo de escritura que no se distingue del silencio no es un diagnóstico.
   */
  punteros_error?: string;
}

interface FilaPlanilla {
  nro_ri: number;
  hoja: string;
  fila: number;
  datos: Record<string, unknown>;
}

export async function importarDesdeSheets(origen = "cron"): Promise<ResultadoSyncCompleto> {
  const comenzo = Date.now();
  const admin = createAdminClient();

  try {
    const pestanas = await listarPestanas();
    const aLeer = [
      ...(pestanas.includes(HOJA_MASTER) ? [HOJA_MASTER] : []),
      ...pestanas.filter(esPestanaDeArea),
    ];

    const porRi = new Map<number, FilaPlanilla>();
    let leidas = 0;

    for (const pestana of aLeer) {
      const filas = await leerPestana(pestana);
      if (filas.length < 2) continue;

      const idx = indexarColumnas(filas[0]);
      const val = (fila: string[], clave: string) => (idx[clave] >= 0 ? fila[idx[clave]] : undefined);

      for (let f = 1; f < filas.length; f++) {
        const fila = filas[f];
        const nro = Number(String(val(fila, "nro_ri") ?? "").replace(/[^0-9]/g, ""));
        if (!nro || isNaN(nro)) continue;
        // La fila plantilla tiene número de RI pero no es un requerimiento: son
        // las fórmulas que la planilla arrastra al resto. Ni se lee ni se
        // cuenta, así que tampoco se la puede crear de nuevo.
        if (esFilaPlantilla(nro)) continue;
        leidas++;

        const esMaster = pestana === HOJA_MASTER;
        const previo = porRi.get(nro);
        const datos: Record<string, unknown> = { ...(previo?.datos ?? {}) };

        // El alta la define el master. Si un RI sólo aparece en la pestaña de
        // área, esa pestaña aporta también los datos del alta.
        if (esMaster || !previo) {
          const apro = estadoAprobacionDe(val(fila, "estado"));
          Object.assign(datos, {
            fecha: fechaISO(val(fila, "fecha")),
            area: texto(val(fila, "area")),
            descripcion: texto(val(fila, "descripcion")) ?? "(sin descripción)",
            codigo: texto(val(fila, "codigo")),
            cantidad: numero(val(fila, "cantidad")),
            ubicacion: texto(val(fila, "ubicacion")),
            fecha_necesidad: fechaISO(val(fila, "fecha_necesidad")),
            detalle_extra: texto(val(fila, "detalle_extra")),
            imagen_url: texto(val(fila, "imagen")),
            prioridad: prioridadDe(val(fila, "prioridad")),
            // `pagaDe` ya distingue la celda vacía (`null`) de una decisión
            // explícita: confundirlas borraba la empresa que eligió quien
            // pidió.
            paga: pagaDe(val(fila, "empresa")),
            solicitante_nombre: texto(val(fila, "solicita")),
            estado_aprobacion: apro.estado,
            aprobador: apro.aprobador,
          });
        }

        // La etapa de compra la definen las pestañas por área.
        if (!esMaster) {
          const compra = estadoCompraDe(val(fila, "estado"));
          Object.assign(datos, {
            estado_compra: compra.estado,
            // La celda de comparativa NO se lee por acá: la API de valores
            // devuelve el texto visible, que dice "LINK", y eso es lo que
            // durante meses quedó guardado como si fuera la dirección. El link
            // de verdad lo trae `leerLinksDeComparativa`, más abajo.
            proveedor: texto(val(fila, "proveedor")),
            costo_iva: numero(val(fila, "costo_iva")),
            costo_envio: numero(val(fila, "costo_envio")),
          });
          if (compra.estado === "DENEGADO") datos.estado_aprobacion = "DENEGADA";
          datos.aprobador ??= compra.aprobador;
          // El paréntesis de "PARA COMPRAR (NICO)" dice a quién le toca aprobar
          // esa compra. Se guarda para resolverlo contra los alias más abajo.
          datos.asignado_alias = compra.aprobador;
        }

        porRi.set(nro, {
          nro_ri: nro,
          // Se recuerda la pestaña de área: es donde se escribe de vuelta.
          hoja: esMaster ? previo?.hoja ?? HOJA_MASTER : pestana,
          fila: esMaster ? previo?.fila ?? f + 1 : f + 1,
          datos,
        });
      }
    }

    const registros = [...porRi.values()];

    // ── La comparativa que anotó la planilla ──
    //
    // Entra por la sincronización y no sólo por el botón de Configuración: es
    // un dato de la planilla como el proveedor o el costo, y mientras fue una
    // operación aparte se quedó a mitad de camino —1.473 requerimientos con
    // comparativa en la planilla y 684 enlazados en el sistema—. El que carga
    // la comparativa allá no tiene por qué venir a apretar un botón acá.
    //
    // Lo que se guarda es el `comparativa_drive_id` y NUNCA `comparativa_url`,
    // porque esa columna **se exporta a la celda de la planilla**: llenarla con
    // el link que la planilla ya tiene haría que la próxima exportación
    // reemplace el "LINK" de la celda por una URL de cien caracteres, en 1.473
    // filas, sin que nadie lo haya pedido. La columna es lo que decidió la app;
    // el vínculo que trajo la planilla es el id, y el link se deriva de él.
    //
    // (El trigger de `editado_en_app` no es problema acá: desde la 027 no marca
    // cuando la escritura actualiza `sheets_sincronizado_en`, que es lo que hace
    // este upsert. Sí lo es para la vinculación en tanda, que no lo toca.)
    //
    // Si Google falla, la importación sigue: el alta de los RI nuevos es lo que
    // no puede quedarse esperando. Queda dicho en el resultado, no en un
    // console.warn.
    let planillas = new Map<number, string>();
    let sinPlanilla: number[] = [];
    let errorDeLinks: string | undefined;
    try {
      const links = await leerLinksDeComparativa();
      const resuelto = planillasPorRi(links);
      planillas = resuelto.ids;
      sinPlanilla = resuelto.sinPlanilla;
    } catch (e) {
      errorDeLinks = e instanceof Error ? e.message : String(e);
    }

    // Catálogos y referencias
    const idArea = await asegurarAreas(admin, registros.map((r) => r.datos.area));
    const idProveedor = await asegurarProveedores(admin, registros.map((r) => r.datos.proveedor));
    const porEmpresa = await mapaEmpresas(admin);
    const porAlias = await mapaAlias(admin);
    const idUbicacion = await asegurarUbicaciones(admin, registros.map((r) => r.datos.ubicacion));

    // Los RI ya gestionados desde la app no se pisan.
    //
    // Va paginado: PostgREST corta en 1000 filas, y con la tabla más grande que
    // eso el resguardo dejaba de aplicar sobre el resto — la planilla revertía
    // aprobaciones y proveedores cargados desde el sistema, sin ruido alguno.
    const existentes = await traerTodo<{
      nro_ri: number;
      editado_en_app: boolean;
      estado_aprobacion: EstadoAprobacion;
      estado_compra: EstadoCompra;
      compra_asignada_a: string | null;
      solicitante_nombre: string | null;
      comparativa_drive_id: string | null;
      prioridad: Prioridad | null;
      empresa_id: string | null;
      paga_ambas: boolean;
      origen: string;
      // El puntero de posición, para no reescribirlo cuando no se movió.
      hoja_origen: string | null;
      sheets_fila: number | null;
    }>((desde, hasta) =>
      admin
        .from("compras_requerimientos")
        .select("nro_ri, editado_en_app, estado_aprobacion, estado_compra, compra_asignada_a, solicitante_nombre, comparativa_drive_id, prioridad, empresa_id, paga_ambas, origen, hoja_origen, sheets_fila")
        .range(desde, hasta)
    );
    const estado = new Map(existentes.map((r) => [r.nro_ri, r.editado_en_app]));
    // Lo que ya sabemos de cada RI, para no pisarlo con un valor por defecto
    // cuando la planilla no dice nada.
    const previo = new Map(existentes.map((r) => [r.nro_ri, r]));

    const aEscribir: Record<string, unknown>[] = [];
    /**
     * Dónde encontró la planilla a los RI que esta corrida NO pisa.
     *
     * La hoja y la fila ya vienen calculadas en el `registro` del bucle de
     * arriba, así que no hace falta volver a leer la planilla para saberlo: la
     * fila se saltea después de haberla leído, no antes.
     */
    const salteadas: DondeEsta[] = [];
    let omitidas = 0;
    let nuevas = 0;

    for (const registro of registros) {
      const yaExiste = estado.has(registro.nro_ri);
      if (yaExiste && estado.get(registro.nro_ri)) {
        omitidas++;
        salteadas.push({ nro_ri: registro.nro_ri, hoja: registro.hoja, fila: registro.fila });
        continue;
      }
      if (!yaExiste) nuevas++;

      const d = registro.datos;
      const ubicacion = d.ubicacion ? String(d.ubicacion) : null;
      const clave = ubicacion ? norm(ubicacion) : null;
      const yaHabia = previo.get(registro.nro_ri);
      const paga = d.paga as { empresa: string | null; ambas: boolean } | null;
      // `null` cuando la celda vino vacía o cuando nombró una empresa que el
      // catálogo no tiene. Igual que el alias sin registrar en
      // /compras/configuracion: si el nombre se reconoció pero no se pudo
      // resolver, no es que "no paga ninguna" — es que no se pudo resolver.
      // Tratarlo como decisión borraría en silencio la empresa que había si
      // alguna vez se renombra el catálogo.
      const pagaResuelta = !paga
        ? null
        : !paga.empresa
          ? { empresa_id: null, ambas: paga.ambas }
          : porEmpresa.has(paga.empresa)
            ? { empresa_id: porEmpresa.get(paga.empresa)!, ambas: false }
            : null;
      const fusion = fusionarConLoQueYaHabia(
        {
          prioridad: (d.prioridad as Prioridad | null) ?? null,
          estado_aprobacion: (d.estado_aprobacion as EstadoAprobacion | null) ?? null,
          estado_compra: (d.estado_compra as EstadoCompra | null) ?? null,
          solicitante_nombre: (d.solicitante_nombre as string | null) ?? null,
          compra_asignada_a: d.asignado_alias
            ? porAlias.get(norm(d.asignado_alias as string)) ?? null
            : null,
          comparativa_drive_id: planillas.get(registro.nro_ri) ?? null,
          paga: pagaResuelta,
        },
        yaHabia
      );

      aEscribir.push({
        nro_ri: registro.nro_ri,
        fecha: d.fecha ?? new Date().toISOString(),
        area_id: d.area ? idArea.get(String(d.area)) ?? null : null,
        descripcion: d.descripcion ?? "(sin descripción)",
        codigo: d.codigo ?? null,
        cantidad: d.cantidad ?? null,
        // Se guarda el texto original como respaldo; ubicacion_id es el dato bueno.
        ubicacion_raw: ubicacion,
        ubicacion_id: clave ? idUbicacion.get(clave) ?? null : null,
        fecha_necesidad: d.fecha_necesidad ?? null,
        detalle_extra: d.detalle_extra ?? null,
        imagen_url: d.imagen_url ?? null,
        aprobador: d.aprobador ?? null,
        proveedor_id: d.proveedor
          ? idProveedor.get(claveProveedor(String(d.proveedor))) ?? null
          : null,
        costo_iva: d.costo_iva ?? null,
        costo_envio: d.costo_envio ?? null,
        hoja_origen: registro.hoja,
        sheets_fila: registro.fila,
        sheets_sincronizado_en: new Date().toISOString(),
        // Las nueve columnas que la planilla puede no traer. La regla —y por
        // qué cada una está en la lista— vive en `fusionarConLoQueYaHabia`.
        ...fusion,
      });
    }

    for (let i = 0; i < aEscribir.length; i += 500) {
      const lote = aEscribir.slice(i, i + 500);
      const { error } = await admin
        .from("compras_requerimientos")
        .upsert(lote, { onConflict: "nro_ri" });
      if (error) throw new Error(error.message);
    }

    // ── Dónde quedó la fila de los RI que no se pisaron ──
    //
    // `editado_en_app` protege **el dato** —el estado, el proveedor, los
    // costos— de un RI ya gestionado acá. No tiene por qué proteger **la
    // posición**: `hoja_origen` y `sheets_fila` son punteros, y saltear la fila
    // entera los congelaba. El agujero completo, con la medición, está en
    // `punteroDeLaPlanilla.ts`; el resumen es que aprobar desde el sistema pone
    // la marca y la aprobación es lo que hace que el `FILTER` lleve el RI a la
    // pestaña de su área, así que el puntero se congelaba en el master justo
    // antes de servir para algo y las columnas de compra no se escribían nunca.
    //
    // Se escribe **sólo** `hoja_origen` y `sheets_fila`, y eso no dispara el
    // trigger de `editado_en_app`: la 027 mira `estado_aprobacion`,
    // `estado_compra`, `proveedor_id`, `costo_iva`, `costo_envio` y
    // `comparativa_url`, ninguna de las cuales viaja acá. Tampoco haría falta la
    // guarda de `sheets_sincronizado_en` de esa función, que es la otra manera
    // de no marcar.
    //
    // Y `sheets_sincronizado_en` NO se toca a propósito, aunque esta escritura
    // sí venga de la planilla. Esa columna es lo que se mira para saber si el
    // espejo de un RI quedó viejo, y para estos RI el espejo **está** viejo: de
    // la fila se leyó dónde está, no lo que dice. Refrescarla haría que un RI
    // congelado desde agosto pareciera sincronizado hace un minuto, que es
    // justo la pregunta que esa columna contesta.
    //
    // Cada puntero va en su propio `update`: un `upsert` en lote tendría que
    // traer las columnas `not null` de la tabla —`descripcion`, `fecha`—, que es
    // exactamente lo que acá no se puede pisar. No es un `.in()` con muchos ids
    // (que armaría una URL que PostgREST rechaza con un 400 mudo) ni un lote de
    // 200, porque cada fila lleva un par de valores distinto. Lo que acota el
    // costo es que `punterosARefrescar` devuelve sólo las que se movieron: hoy
    // son 12 la primera vez y 0 en cada corrida siguiente.
    const punteros = punterosARefrescar(salteadas, previo);
    let punterosMovidos = 0;
    let errorDePunteros: string | undefined;

    for (const p of punteros) {
      const { error } = await admin
        .from("compras_requerimientos")
        .update({ hoja_origen: p.hoja_origen, sheets_fila: p.sheets_fila })
        .eq("nro_ri", p.nro_ri);
      // No se corta la corrida por esto: el puntero de un RI ya gestionado no
      // vale lo que el alta de los que entraron nuevos. Se guarda el primer
      // motivo para decirlo en el resultado y se sigue.
      if (error) errorDePunteros ??= `RI ${p.nro_ri}: ${error.message}`;
      else punterosMovidos++;
    }

    const resultado: ResultadoSync = {
      filas_leidas: leidas,
      filas_nuevas: nuevas,
      filas_actualizadas: aEscribir.length - nuevas,
      filas_omitidas: omitidas,
    };

    await admin.from("compras_sincronizaciones").insert({
      direccion: "importar", origen, ...resultado, duracion_ms: Date.now() - comenzo,
    });

    return {
      ...resultado,
      // Cuántos de los que se escribieron quedaron con su planilla enlazada.
      comparativas: aEscribir.filter((f) => f.comparativa_drive_id).length,
      comparativas_sin_planilla: sinPlanilla.length,
      ...(errorDeLinks ? { comparativas_error: errorDeLinks } : {}),
      punteros_actualizados: punterosMovidos,
      ...(errorDePunteros ? { punteros_error: errorDePunteros } : {}),
    };
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : String(e);
    await admin.from("compras_sincronizaciones").insert({
      direccion: "importar", origen, error: mensaje, duracion_ms: Date.now() - comenzo,
    });
    throw e;
  }
}

/** Da de alta las áreas nuevas que aparezcan y devuelve nombre → id. */
async function asegurarAreas(admin: Admin, valores: unknown[]) {
  const nombres = [...new Set(valores.filter(Boolean).map(String))];
  if (nombres.length > 0) {
    await admin
      .from("compras_areas")
      .upsert(nombres.map((nombre) => ({ nombre })), { onConflict: "nombre", ignoreDuplicates: true });
  }
  const { data } = await admin.from("compras_areas").select("id, nombre");
  return new Map((data ?? []).map((f) => [f.nombre as string, f.id as string]));
}

/** Igual, pero unificando variantes del nombre del proveedor. */
async function asegurarProveedores(admin: Admin, valores: unknown[]) {
  const { data: actuales } = await admin.from("proveedores").select("id, nombre");
  const porClave = new Map(
    (actuales ?? []).map((p) => [claveProveedor(p.nombre as string), p.id as string])
  );

  const nuevos = [...new Set(valores.filter(Boolean).map(String))]
    .filter((n) => claveProveedor(n) && !porClave.has(claveProveedor(n)));

  if (nuevos.length > 0) {
    const { data: creados } = await admin
      .from("proveedores")
      .upsert(nuevos.map((nombre) => ({ nombre })), { onConflict: "nombre", ignoreDuplicates: true })
      .select("id, nombre");
    for (const p of creados ?? []) porClave.set(claveProveedor(p.nombre as string), p.id as string);
  }
  return porClave;
}

/** "AMBAS" no es una empresa: los RI compartidos quedan con empresa_id en null. */
/**
 * Alias de la planilla → usuario. "NICO" y "MAXI" son como los nombra la
 * planilla; el sistema necesita el id para saber quién puede aprobar.
 */
async function mapaAlias(admin: Admin) {
  const { data } = await admin
    .from("compras_aprobadores")
    .select("usuario_id, alias_planilla");

  return new Map(
    (data ?? [])
      .filter((a) => a.alias_planilla)
      .map((a) => [norm(a.alias_planilla), a.usuario_id as string])
  );
}

async function mapaEmpresas(admin: Admin) {
  const { data } = await admin.from("empresas").select("id, nombre");
  return new Map((data ?? []).map((e) => [norm(e.nombre), e.id as string]));
}

/**
 * Da de alta las ubicaciones nuevas que traiga la planilla y devuelve el mapa
 * normalizado -> id. El enlace de cada ubicación a un sector o equipo del
 * núcleo se administra desde el catálogo, no acá.
 */
async function asegurarUbicaciones(admin: Admin, valores: unknown[]) {
  const nombres = [...new Set(valores.filter(Boolean).map(String))];
  if (nombres.length > 0) {
    await admin
      .from("compras_ubicaciones")
      .upsert(nombres.map((nombre) => ({ nombre })), { onConflict: "nombre", ignoreDuplicates: true });
  }
  const { data } = await admin.from("compras_ubicaciones").select("id, nombre");
  return new Map((data ?? []).map((u) => [norm(u.nombre as string), u.id as string]));
}

// ── Los links de comparativa que esconde la planilla ────

interface CeldaConLink {
  formattedValue?: string;
  userEnteredValue?: { formulaValue?: string };
  hyperlink?: string;
  textFormatRuns?: { format?: { link?: { uri?: string } } }[];
}

/**
 * A qué planilla de comparativa apunta cada requerimiento.
 *
 * La celda muestra "LINK" y esconde el hipervínculo detrás, así que leerla con
 * la API de valores —que devuelve el texto visible— no sirve: por eso en la base
 * quedó guardado el texto "LINK" y no la URL. Acá se pide la grilla con la
 * fórmula y el hipervínculo de cada celda, que cubre las dos formas de cargarlo.
 *
 * Se lee una vez por pestaña, no una por requerimiento.
 */
export async function leerLinksDeComparativa(): Promise<Map<number, string>> {
  const token = await obtenerToken(false);
  const pestanas = (await listarPestanas()).filter((p) => p !== HOJA_MASTER);

  const campos =
    "sheets(properties(title),data(rowData(values(" +
    "formattedValue,userEnteredValue(formulaValue),hyperlink," +
    "textFormatRuns(format(link(uri)))))))";

  const rangos = pestanas.map((p) => `ranges=${encodeURIComponent(`${p}!A:R`)}`).join("&");
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${idPlanilla()}` +
    `?${rangos}&fields=${encodeURIComponent(campos)}`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Sheets API ${res.status}: ${await res.text()}`);

  const json = await res.json();
  const porRi = new Map<number, string>();

  for (const hoja of json.sheets ?? []) {
    const filas: { values?: CeldaConLink[] }[] = hoja.data?.[0]?.rowData ?? [];
    if (filas.length === 0) continue;

    const encabezado = (filas[0].values ?? []).map((c) => norm(c?.formattedValue));
    const idx = indexarColumnas(encabezado);
    if (idx.comparativa < 0) continue;

    for (let f = 1; f < filas.length; f++) {
      const celdas = filas[f].values ?? [];
      const nro = Number(String(celdas[idx.nro_ri]?.formattedValue ?? "").replace(/[^0-9]/g, ""));
      if (!nro || isNaN(nro)) continue;

      const celda = celdas[idx.comparativa];
      if (!celda) continue;

      const link = linkDeCelda(
        celda.userEnteredValue?.formulaValue ?? celda.formattedValue,
        celda.hyperlink ?? celda.textFormatRuns?.[0]?.format?.link?.uri
      );
      if (link) porRi.set(nro, link);
    }
  }

  return porRi;
}

// ── Exportar: app → planilla ─────────────────────────────────

/**
 * Columnas de la hoja de área que gestiona Compras.
 *
 * `solicita` no es de la compra pero se escribe acá porque es el único lugar de
 * la planilla donde figura quién pidió: el `QUERY` del master saltea las
 * columnas de nombre y apellido de la hoja de respuestas. Para los RI que
 * vinieron de la planilla es el mismo valor que ya está; para los cargados en
 * el sistema, la diferencia entre un pedido con dueño y uno anónimo.
 */
const COLUMNAS_COMPRA = [
  "solicita", "comparativa", "proveedor", "estado", "costo_iva", "costo_envio",
] as const;

/** La columna del master que escribe la app al aprobar. */
const COLUMNA_APROBACION = "estado";

/**
 * Las columnas del master que la app escribe a mano.
 *
 * Se llamaban "las del aprobador", y el nombre era el defecto: son las dos
 * únicas del master que **no** salen del `QUERY(IMPORTRANGE())`, y en un pedido
 * cargado en el sistema las elige quien pide, en el alta. Creer que las decidía
 * el aprobador las dejó escondidas detrás del estado de aprobación, y así no
 * se escribieron nunca para un RI nuevo, que nace PENDIENTE.
 */
const COLUMNAS_A_MANO = ["prioridad", "empresa"] as const;

/**
 * De las dos columnas a mano, cuáles se pueden escribir y cuáles no tienen dónde.
 *
 * Pura y aparte del I/O para poder probarla: es la que corre **en producción**
 * —en cada exportación y en cada reintento—, mientras que
 * `celdasDePrioridadYEmpresa` de `lib/compras/formulario.ts` hace lo mismo para
 * el camino del alta. Son dos copias a propósito: el alta escribe otra planilla
 * y no pasa por acá. Si se toca una hay que mirar la otra.
 *
 * Dos reglas, las dos ya pagadas:
 *
 *   - una celda que no tenemos con qué llenar **no se pisa con vacío** ni se
 *     anota. Es el mismo criterio que la celda de comparativa, que borraba el
 *     link que la planilla sí tenía;
 *   - si hay valor y al master le falta **esa** columna, se anota. Escribir la
 *     que sí está y contestar que todo salió bien es exactamente lo que hacía
 *     esta escritura cuando la hacía el alta.
 */
export function columnasAManoAEscribir(
  idx: Record<string, number>,
  valores: Record<string, string>
): {
  aEscribir: { clave: string; columna: number; valor: string }[];
  sinColumna: string[];
} {
  const aEscribir: { clave: string; columna: number; valor: string }[] = [];
  const sinColumna: string[] = [];

  for (const clave of COLUMNAS_A_MANO) {
    const valor = valores[clave] ?? "";
    if (valor === "") continue;
    const columna = idx[clave] ?? -1;
    if (columna < 0) {
      sinColumna.push(`${clave} (el master no tiene esa columna)`);
      continue;
    }
    aEscribir.push({ clave, columna, valor });
  }

  return { aEscribir, sinColumna };
}

/**
 * La base guarda las empresas en mayúsculas (POLCECAL) y el desplegable de la
 * planilla las espera capitalizadas (Polcecal). Sin null = "Ambas".
 */
export function empresaParaPlanilla(
  nombre: string | null | undefined,
  pagaAmbas = false
): string {
  // Sin definir se escribe vacío: la planilla también distingue el caso.
  if (!nombre) return pagaAmbas ? "Ambas" : "";
  const n = nombre.trim().toUpperCase();
  if (n === "POLCECAL") return "Polcecal";
  if (n === "POLYSAN") return "Polysan";
  return nombre;
}

/**
 * Cómo se llama cada estado en el desplegable de la planilla.
 *
 * PARA_COMPRAR se arma aparte: lleva entre paréntesis a quién le toca aprobar.
 * RECIBIDO no está en el desplegable —el seguimiento de la recepción todavía no
 * se definió— así que no se escribe.
 */
const ETIQUETA_ESTADO_COMPRA: Record<string, string | null> = {
  SIN_INICIAR: "",
  EN_COMPARATIVA: "EN PROCESO (COMPARATIVA)",
  APROBADO: "APROBADO",
  PEDIDO: "PEDIDO",
  DENEGADO: "DENEGADO",
  RECIBIDO: null,
  EN_ESPERA: "EN ESPERA",
};

/** "PARA COMPRAR (NICO)" según a quién se le asignó. */
export function textoParaComprar(alias: string | null): { valor: string | null; motivo?: string } {
  if (!alias) {
    return {
      valor: null,
      motivo: "falta asignar a quién le toca aprobar la compra",
    };
  }
  return { valor: `PARA COMPRAR (${alias.trim().toUpperCase()})` };
}

export interface ResultadoExportacion {
  escritas: string[];
  /**
   * Lo que la planilla **rechazó**: alguien tiene que ir a hacer algo.
   *
   * Es lo único que se le muestra a quien hizo la acción, y por eso el
   * significado tiene que ser exactamente ése. Cuando lo esperable —una fila del
   * master que todavía no bajó— entraba también acá, las cuatro rutas que
   * consumen este campo terminaban diciéndole a quien cargaba un presupuesto de
   * un RI recién dado de alta que «la planilla no dejó actualizar el estado» y
   * que «hay que corregirlo a mano ahí»: atribuía el problema al estado —que se
   * había escrito bien— y mandaba a arreglar a mano algo que se arregla solo.
   */
  bloqueadas: string[];
  /**
   * Lo que **todavía** no se pudo escribir y se va a poder solo.
   *
   * Hoy es un caso: prioridad y empresa de un alta cuya fila del master no
   * existe porque el `IMPORTRANGE` entre las dos planillas no refrescó —tarda
   * minutos y no se puede forzar desde la API—. Va a la cola del reintento
   * (`sheets_pendiente`) y **no se muestra**: un cartel que aparece siempre y se
   * arregla solo enseña a ignorar los carteles.
   */
  enEspera: string[];
}

/**
 * Opciones válidas del desplegable de aprobación del master.
 *
 * Se leen de la planilla y no se escriben a mano: si mañana suman un tercer
 * aprobador, la lista cambia sola. La validación es estricta, así que escribir
 * algo que no esté acá deja la celda fuera de rango y rompe las fórmulas y
 * filtros que dependen de esos textos exactos.
 */
export async function opcionesAprobacion(cache?: CacheSheets): Promise<string[]> {
  if (cache?.opciones) return cache.opciones;

  const encabezado = await leerEncabezado(HOJA_MASTER, cache);
  if (encabezado.length === 0) return [];
  const idxEnc = indexarColumnas(encabezado);
  const colEnc = idxEnc[COLUMNA_APROBACION];
  if (colEnc < 0) return [];
  const opciones = await leerOpcionesDelDesplegable(colEnc);
  if (cache) cache.opciones = opciones;
  return opciones;
}

/** El encabezado de una pestaña, una sola vez por corrida. */
async function leerEncabezado(pestana: string, cache?: CacheSheets): Promise<string[]> {
  const guardado = cache?.encabezados.get(pestana);
  if (guardado) return guardado;

  const filas = await leerPestana(`${pestana}!A1:R1`);
  const encabezado = filas[0] ?? [];
  cache?.encabezados.set(pestana, encabezado);
  return encabezado;
}

/** Lee la lista del desplegable de una columna del master. */
async function leerOpcionesDelDesplegable(col: number): Promise<string[]> {
  const letra = letraDeColumna(col);
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${idPlanilla()}` +
    `?ranges=${encodeURIComponent(`${HOJA_MASTER}!${letra}2:${letra}2`)}` +
    `&fields=sheets(data(rowData(values(dataValidation))))&includeGridData=true`;

  const token = await obtenerToken(false);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return [];

  const json = await res.json();
  const dv = json.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values?.[0]?.dataValidation;
  return (dv?.condition?.values ?? [])
    .map((v: { userEnteredValue?: string }) => v.userEnteredValue)
    .filter((v: string | undefined): v is string => Boolean(v));
}

/**
 * Arma el texto de aprobación tal como lo espera la planilla.
 *
 * Devuelve null cuando no se puede armar un valor válido: es preferible avisar
 * que la celda no se pudo escribir antes que meterle un texto fuera de la lista.
 */
export function textoAprobacion(
  estado: string,
  alias: string | null,
  opciones: string[]
): { valor: string | null; motivo?: string } {
  const buscar = (texto: string) =>
    opciones.find((o) => norm(o) === norm(texto)) ?? null;

  if (estado === "DENEGADA") {
    const v = buscar("DENEGADA");
    return v ? { valor: v } : { valor: null, motivo: "la planilla no ofrece DENEGADA" };
  }
  if (estado === "EN_REVISION") {
    const v = buscar("EN REVISIÓN");
    return v ? { valor: v } : { valor: null, motivo: "la planilla no ofrece EN REVISIÓN" };
  }
  if (estado !== "APROBADA") return { valor: null };

  const limpio = (alias ?? "").trim();
  if (!limpio) {
    return {
      valor: null,
      motivo: "falta el alias del aprobador; cargalo en Configuración de Compras",
    };
  }

  const v = buscar(`APROBADA (${limpio})`);
  return v
    ? { valor: v }
    : {
        valor: null,
        motivo: `la planilla no tiene la opción «APROBADA (${limpio.toUpperCase()})»`,
      };
}

/** Un aprobador, como hace falta para reconocerlo por lo que quedó escrito. */
export interface CandidatoAprobador {
  alias_planilla: string | null;
  usuarios: { nombre: string; apellido: string } | null;
}

/**
 * Reconoce al aprobador por el texto que quedó guardado en el RI.
 *
 * Ese texto tiene dos orígenes distintos y hay que aceptar los dos:
 *
 *  - los 1810 RI que vienen de la planilla guardaron el **alias** —dice
 *    "NICO", no "Nicolas Lenzetti"—, porque es lo que la planilla escribe;
 *  - los aprobados en la app antes de que existiera `aprobado_por` guardaron
 *    el nombre y apellido.
 *
 * Buscar sólo por nombre, como se hacía, no acertaba nunca con los primeros:
 * comparaba "NICO" contra "Nicolas Lenzetti" y devolvía null, así que la
 * sincronización informaba que faltaba un alias que en realidad estaba
 * cargado. El alias va primero porque es el caso masivo.
 */
export function aliasSegunLoEscrito(
  candidatos: CandidatoAprobador[],
  textoGuardado: string | null
): string | null {
  if (!textoGuardado) return null;
  const buscado = norm(textoGuardado);

  for (const c of candidatos) {
    if (c.alias_planilla && norm(c.alias_planilla) === buscado) return c.alias_planilla;
  }
  for (const c of candidatos) {
    const u = c.usuarios;
    if (u && norm(`${u.nombre} ${u.apellido}`) === buscado) return c.alias_planilla;
  }
  return null;
}

/**
 * Alias del aprobador en la planilla.
 *
 * Lo normal es resolverlo por `aprobado_por`. Cuando no está —que es casi
 * siempre, porque el histórico entró por importación— se lo reconoce por el
 * texto que quedó guardado.
 */
async function aliasDelAprobador(
  admin: Admin,
  aprobadoPor: string | null,
  nombreGuardado: string | null
): Promise<string | null> {
  if (aprobadoPor) {
    const { data } = await admin
      .from("compras_aprobadores")
      .select("alias_planilla")
      .eq("usuario_id", aprobadoPor)
      .maybeSingle();
    if (data?.alias_planilla) return data.alias_planilla as string;
  }

  const { data: candidatos } = await admin
    .from("compras_aprobadores")
    .select("alias_planilla, usuarios(nombre, apellido)");

  return aliasSegunLoEscrito(
    (candidatos ?? []).map((c) => ({
      alias_planilla: c.alias_planilla as string | null,
      usuarios: c.usuarios as unknown as { nombre: string; apellido: string } | null,
    })),
    nombreGuardado
  );
}

/**
 * En qué fila del master está cada RI.
 *
 * Se arma una vez y se reusa: son 1885 filas y antes se leían enteras por cada
 * requerimiento que se escribía.
 */
async function filaEnMaster(nroRi: number, cache?: CacheSheets): Promise<number | null> {
  let mapa = cache?.filasDelMaster;

  if (!mapa) {
    mapa = new Map<number, number>();
    const filas = await leerPestana(`${HOJA_MASTER}!A:A`);
    for (let i = 1; i < filas.length; i++) {
      const n = Number(String(filas[i]?.[0] ?? "").replace(/[^0-9]/g, ""));
      if (n) mapa.set(n, i + 1);
    }
    if (cache) cache.filasDelMaster = mapa;
  }

  return mapa.get(nroRi) ?? null;
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Escribe una celda. Devuelve null si salió bien, o el motivo si no.
 *
 * Ante un 429 espera y reintenta, porque un 429 no es un rechazo: es "no
 * ahora". Tratarlo como rechazo dejaba doce RI anotados con "error 429" y hacía
 * pensar que la planilla no los quería, cuando en realidad no se había llegado
 * a intentar.
 *
 * La cuota de Sheets se cuenta por minuto, así que las esperas son de segundos
 * y no de milisegundos: reintentar rápido sólo gasta el intento.
 */
async function escribirCelda(token: string, rango: string, valor: string): Promise<string | null> {
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${idPlanilla()}` +
    `/values/${encodeURIComponent(rango)}?valueInputOption=USER_ENTERED`;

  const DEMORAS = [2000, 6000];

  for (let intento = 0; ; intento++) {
    const res = await fetch(url, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ values: [[valor]] }),
    });
    if (res.ok) return null;

    const cuerpo = await res.text();

    if (res.status === 429 && intento < DEMORAS.length) {
      await espera(DEMORAS[intento]);
      continue;
    }
    if (res.status === 429) {
      // Se dice como lo que es, para que no se confunda con un rechazo: esto se
      // arregla solo en la próxima corrida, sin tocar la planilla.
      return "la planilla no dio lugar por cuota; se reintenta solo";
    }

    // El motivo se guarda con lo que dijo Google, no traducido.
    //
    // Antes cualquier error que contuviera "protected" se anotaba como "celda
    // protegida en la planilla" y el mensaje real se tiraba. Eso mandó a
    // revisar los permisos de 946 protecciones que ya estaban bien: la cuenta
    // tenía acceso y la escritura fallaba por otra cosa, pero el cartel decía
    // lo mismo en los dos casos. Un diagnóstico que no se puede distinguir de
    // otro no es un diagnóstico.
    console.error(`Sheets rechazó ${rango}: ${res.status} ${cuerpo}`);
    return `${etiquetaDeError(res.status, cuerpo)} — Sheets dijo: ${detalleDeGoogle(cuerpo)}`;
  }
}

/** Cómo se llama este rechazo, en una palabra. */
function etiquetaDeError(status: number, cuerpo: string): string {
  if (cuerpo.includes("protected")) return "celda protegida en la planilla";
  if (status === 403) return "sin permiso sobre esa celda";
  if (status === 400) return "la planilla rechazó el valor";
  return `error ${status}`;
}

/**
 * El mensaje de Google, corto y en una línea.
 *
 * Va al cartel de la app, así que tiene que entrar en una fila de la tabla de
 * pendientes: se busca el `message` del JSON de error y se recorta.
 */
function detalleDeGoogle(cuerpo: string): string {
  let texto = cuerpo;
  try {
    const json = JSON.parse(cuerpo);
    texto = json?.error?.message ?? cuerpo;
  } catch {
    // No era JSON: se usa el cuerpo tal cual.
  }
  const limpio = texto.replace(/\s+/g, " ").trim();
  return limpio.length > 160 ? limpio.slice(0, 157) + "…" : limpio;
}

/**
 * Refleja en la planilla lo que se gestionó desde el sistema.
 *
 * Cada celda se escribe por separado y no en un solo lote: la planilla tiene
 * 841 rangos protegidos —el Estado de cada fila ya aprobada, y la columna de
 * aprobación del master, reservada a ciertas cuentas—. Con un batch único, una
 * sola celda protegida hacía fallar la escritura entera y no se guardaba
 * tampoco el proveedor ni los costos, que sí están permitidos.
 *
 * Lo que no se pudo escribir se devuelve para avisarlo, en vez de dar por
 * hecho que la planilla quedó al día — y se devuelve **en dos listas**, porque
 * no es lo mismo un rechazo de la planilla (`bloqueadas`, que es lo único que se
 * le muestra a la persona) que algo que todavía no se pudo escribir y se va a
 * poder solo (`enEspera`). Ver `ResultadoExportacion`.
 *
 * **No toca el `sheets_pendiente` de un pedido cuyo alta todavía no llegó a la
 * planilla** (`hoja_origen` nulo): ese pendiente es del alta. Ver el
 * guardarraíl del final, que es el motivo por el que se lo dejó escrito.
 */
export async function exportarRequerimiento(
  requerimientoId: string,
  cacheDeLaCorrida?: CacheSheets
): Promise<ResultadoExportacion> {
  // Sin cache se comporta como siempre: una llamada suelta arma el suyo y no
  // reusa nada. El reintento sí lo comparte entre todos los RI de la corrida.
  const cache = cacheDeLaCorrida ?? nuevoCacheSheets();
  const vacio: ResultadoExportacion = { escritas: [], bloqueadas: [], enEspera: [] };
  if (!process.env.GOOGLE_SHEETS_COMPRAS_ID || !process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return vacio;

  const admin = createAdminClient();
  const { data: r } = await admin
    .from("compras_requerimientos")
    // `!empresa_id`: `compras_odoo_ordenes` abre un segundo camino hasta `empresas` (PGRST201).
    .select("*, proveedores!proveedor_id(nombre), empresas!empresa_id(nombre)")
    .eq("id", requerimientoId)
    .single();

  if (!r) return vacio;

  // Sobre la fila plantilla no se escribe nunca: escribirle la aprobación
  // pisaría las fórmulas que usa el resto de la planilla. Se limpia lo que
  // hubiera quedado encolado, porque si no el reintento la elige para siempre.
  if (esFilaPlantilla(r.nro_ri as number)) {
    if (r.sheets_pendiente) {
      await admin
        .from("compras_requerimientos")
        .update({ sheets_pendiente: null, sheets_intentado_en: null })
        .eq("id", requerimientoId);
    }
    return vacio;
  }

  const token = await obtenerToken(true);
  const escritas: string[] = [];
  const bloqueadas: string[] = [];
  const enEspera: string[] = [];

  // En qué fila del master está este RI. La comparten la aprobación y las dos
  // columnas a mano, así que se resuelve una vez y **sólo si alguna de las dos
  // tiene algo que escribir**: buscarla lee la columna de N° del master, que son
  // 1.885 filas, y hasta ahora un RI PENDIENTE no la pedía nunca.
  //
  // El atajo de `sheets_fila` vale sólo cuando `hoja_origen` es el master, y eso
  // no es una formalidad: esa pareja de valores la escribe la importación,
  // leyendo la columna A fila por fila, así que el número **está verificado**.
  // Para cualquier otro origen se busca por la columna A con `filaEnMaster`. El
  // alta guarda a propósito la hoja de respuestas del formulario y no el master
  // con la cuenta `fila − 2`: la cuenta es una suposición sobre lo que el
  // `QUERY` va a hacer, y escribirle prioridad a una fila que nadie comprobó es
  // ponerle la prioridad de este pedido a otro.
  let filaSabida: number | null | undefined;
  const filaDeEsteRi = async (): Promise<number | null> => {
    if (filaSabida === undefined) {
      filaSabida =
        r.hoja_origen === HOJA_MASTER && r.sheets_fila
          ? (r.sheets_fila as number)
          : await filaEnMaster(r.nro_ri as number, cache);
    }
    return filaSabida;
  };

  // ── Estado de aprobación, en el master ──
  if (r.estado_aprobacion !== "PENDIENTE") {
    // El alias es con el que la persona figura en el desplegable de la planilla.
    const alias = await aliasDelAprobador(
      admin,
      r.aprobado_por as string | null,
      r.aprobador as string | null
    );

    const { valor, motivo } = textoAprobacion(
      r.estado_aprobacion as string,
      alias,
      await opcionesAprobacion(cache)
    );

    if (!valor) {
      if (motivo) bloqueadas.push(`aprobación (${motivo})`);
    } else {
      const fila = await filaDeEsteRi();

      if (fila) {
        const encabezado = await leerEncabezado(HOJA_MASTER, cache);
        const idx = indexarColumnas(encabezado);

        if (idx[COLUMNA_APROBACION] >= 0) {
          const fallo = await escribirCelda(
            token,
            `${HOJA_MASTER}!${letraDeColumna(idx[COLUMNA_APROBACION])}${fila}`,
            valor
          );
          if (fallo) bloqueadas.push(`aprobación (${fallo})`);
          else escritas.push("aprobación");
        }
      }
    }
  }

  // ── Prioridad y empresa, en el master ──
  //
  // Fuera de la rama de la aprobación **a propósito**. Estaban adentro porque
  // "se deciden al aprobar", y eso dejaba sin escribir las de todo pedido
  // cargado en el sistema: ahí las elige quien pide, en el alta, y un RI nuevo
  // nace PENDIENTE. El alta escribe la hoja de respuestas del formulario y
  // estas dos columnas son las únicas del master que **no** salen de ese
  // `QUERY(IMPORTRANGE())`, así que si no se escriben acá no se escriben nunca:
  // medido, cada alta terminaba con un pendiente que decía que la planilla no
  // se había enterado y las dos celdas en blanco para siempre.
  //
  // Que el reintento pase por acá en cada corrida es lo que las acomoda solas:
  // el `IMPORTRANGE` entre las dos planillas tarda minutos y no se puede forzar
  // desde la API, así que en el alta la fila del master todavía no existe.
  //
  // RIESGO ASUMIDO, y la ventana es más larga de lo que decía este comentario:
  // para un RI que vino de la planilla, esto reescribe las dos celdas con lo que
  // sabe el sistema en **cada** exportación. Si alguien las cambió a mano allá,
  // se pisa con el valor viejo.
  //
  // Decía que la ventana era "una corrida del cron", y eso es falso justo para
  // el grupo más grande: la importación **saltea** los RI con
  // `editado_en_app = true`, así que a esos la base no les vuelve a leer estas
  // columnas nunca y el pisado es **permanente** —no hasta la próxima corrida—.
  // Y caer en ese grupo es fácil: cargar un presupuesto cambia `estado_compra`,
  // que es una de las columnas que marcan el trigger. La ventana de una corrida
  // vale sólo para el RI que todavía no se tocó desde el sistema.
  //
  // Se asume igual porque es la misma dirección que ya valía al aprobar —la app
  // manda en lo que gestiona— y porque no escribirlas dejaba las dos celdas en
  // blanco para siempre en todo pedido cargado en el sistema. Pero quien cambie
  // una prioridad a mano en la planilla de un RI ya gestionado acá tiene que
  // saber que la está perdiendo.
  {
    const valores: Record<string, string> = {
      prioridad: (r.prioridad as string | null) ?? "",
      empresa: empresaParaPlanilla(
        (r.empresas as { nombre: string } | null)?.nombre,
        r.paga_ambas === true
      ),
    };
    // Guarda antes de tocar la planilla: sin ninguna de las dos con qué llenar
    // no hay nada que buscar, y buscar la fila lee la columna de N° del master
    // —1.885 filas—. Qué se escribe y qué no lo decide `columnasAManoAEscribir`,
    // que además distingue la columna que al master le falta.
    if (COLUMNAS_A_MANO.some((clave) => valores[clave] !== "")) {
      const fila = await filaDeEsteRi();
      if (!fila) {
        // Esto NO es un rechazo de la planilla: es un alta que el
        // `IMPORTRANGE` todavía no bajó al master. Va a la cola del reintento
        // —que es lo que lo va a resolver, sin que nadie toque nada— y no se le
        // muestra a quien hizo la acción. Ponerlo en `bloqueadas` hacía que las
        // cuatro rutas le dijeran "hay que corregirlo a mano ahí" por algo que
        // se corrige solo, y encima atribuido al campo equivocado.
        enEspera.push(
          `prioridad y empresa (el RI ${r.nro_ri} todavía no aparece en el master; ` +
            `el IMPORTRANGE no refrescó y las escribe el próximo reintento)`
        );
      } else {
        const idx = indexarColumnas(await leerEncabezado(HOJA_MASTER, cache));
        const { aEscribir, sinColumna } = columnasAManoAEscribir(idx, valores);
        bloqueadas.push(...sinColumna);

        for (const { clave, columna, valor } of aEscribir) {
          const fallo = await escribirCelda(
            token,
            `${HOJA_MASTER}!${letraDeColumna(columna)}${fila}`,
            valor
          );
          if (fallo) bloqueadas.push(`${clave} (${fallo})`);
          else escritas.push(clave);
        }
      }
    }
  }

  // ── Columnas de compra, en la hoja del área ──
  //
  // El criterio es que `hoja_origen` sea una pestaña de área **de verdad**, y no
  // "cualquier cosa que no sea el master": ver `esPestanaDeArea`. Con la
  // negativa, el alta —que anota la hoja de respuestas del formulario— hacía
  // escribir proveedor, estado y costos en las columnas N a R de esa hoja, que
  // son de Google.
  if (r.hoja_origen && r.sheets_fila && esPestanaDeArea(r.hoja_origen as string)) {
    const encabezado = await leerEncabezado(r.hoja_origen as string, cache);
    if (encabezado.length > 0) {
      const idx = indexarColumnas(encabezado);
      // El estado se resuelve aparte porque PARA_COMPRAR necesita el alias de
      // quien tiene que aprobar, y RECIBIDO directamente no se escribe.
      let estadoTexto: string | null = null;
      if (r.estado_compra === "PARA_COMPRAR") {
        const alias = await aliasDelAprobador(admin, r.compra_asignada_a as string | null, null);
        const { valor, motivo } = textoParaComprar(alias);
        estadoTexto = valor;
        if (!valor && motivo) bloqueadas.push(`estado (${motivo})`);
      } else {
        estadoTexto = ETIQUETA_ESTADO_COMPRA[r.estado_compra as string] ?? "";
      }

      const valores: Record<string, string | null> = {
        // Sólo si el sistema lo sabe: pisar con vacío el nombre que alguien
        // escribió a mano allá sería perderlo.
        solicita: (r.solicitante_nombre as string | null) || null,
        // Sin comparativa cargada acá NO se escribe la celda —null es "no
        // corresponde"—, y no se escribe vacío. La celda de la planilla dice
        // "LINK" con el hipervínculo escondido detrás, así que pisarla con ""
        // borraba el link de la comparativa: el sistema no lo tenía, y la
        // planilla dejaba de tenerlo también. La planilla manda sobre esa celda
        // mientras la app no tenga nada mejor que poner.
        comparativa: (r.comparativa_url as string) ?? null,
        proveedor: (r.proveedores as { nombre: string } | null)?.nombre ?? "",
        estado: estadoTexto,
        costo_iva: r.costo_iva !== null ? String(r.costo_iva) : "",
        costo_envio: r.costo_envio !== null ? String(r.costo_envio) : "",
      };

      for (const clave of COLUMNAS_COMPRA) {
        if (idx[clave] < 0) continue;
        const valor = valores[clave];
        if (valor === null) continue;   // no corresponde escribir esta celda
        const motivo = await escribirCelda(
          token,
          `${r.hoja_origen}!${letraDeColumna(idx[clave])}${r.sheets_fila}`,
          valor
        );
        if (motivo) bloqueadas.push(`${clave} (${motivo})`);
        else escritas.push(clave);
      }
    }
  }

  // Se deja anotado qué quedó sin escribir. Sin esto, un rechazo de la planilla
  // se perdía apenas se cerraba el aviso: el RI ya estaba aprobado, la app no
  // volvía a ofrecer aprobarlo y no había manera de reintentar.
  //
  // Van las dos cosas, porque este campo **es** la cola del reintento y lo que
  // está en espera es justamente lo que el reintento acomoda solo. Pero van
  // separadas y rotuladas: es lo que se lee en /compras/configuracion para
  // decidir si hay que ir a la planilla, y con los dos motivos mezclados en una
  // sola lista no había forma de distinguir "la planilla lo rechazó" de "todavía
  // no bajó".
  const partes: string[] = [];
  if (bloqueadas.length > 0) partes.push(`la planilla rechazó: ${bloqueadas.join("; ")}`);
  if (enEspera.length > 0) partes.push(`se reintenta solo: ${enEspera.join("; ")}`);

  // GUARDARRAÍL: el pendiente de un pedido cuyo alta todavía no llegó a la
  // planilla NO se toca acá.
  //
  // Ese pendiente **es del alta** y sólo el alta lo puede resolver; pisarlo es
  // borrar la única pista de por qué el pedido no está en la planilla. Y esta
  // función lo pisaba de las dos maneras posibles, las dos peores:
  //
  //   - si el alta traía prioridad o empresa, el `enEspera` de más arriba
  //     —"el RI todavía no aparece en el master; el IMPORTRANGE no refrescó y
  //     las escribe el próximo reintento"— reemplazaba lo que había dicho
  //     Google por un mensaje que promete que se arregla solo, cuando no se va
  //     a arreglar nunca: el alta nunca se escribió. Quedaba rotando en la cola
  //     para siempre y /compras/configuracion lo mostraba bajo "se reintenta
  //     solo";
  //   - si no traía ninguna de las dos —el caso normal: la prioridad no tiene
  //     valor por defecto y "Quién paga" arranca sin definir— dejaba
  //     `sheets_pendiente = null`, lo contaba como resuelto, y el pedido no
  //     llegaba nunca a la planilla sin que quedara nada para mirar.
  //
  // El trabajo de arriba sí se hace igual, porque puede haber fila en el master
  // aunque `hoja_origen` esté nulo (el alta escribió la fila y se cortó antes de
  // guardarlo), y porque lo que quedó sin escribir se devuelve al que llamó y él
  // lo muestra. Lo único que se protege es la columna.
  //
  // RIESGO ASUMIDO: si esta corrida encuentra un rechazo nuevo de la planilla
  // para uno de estos pedidos, ese motivo no queda guardado —se lo lleva el
  // valor de retorno y el log, no la columna—. Se acepta porque el pedido sigue
  // en la cola por el pendiente del alta, así que va a volver a pasar por acá; y
  // porque la alternativa —concatenar detrás de lo que había— hace crecer el
  // campo sin techo en cada una de las corridas del cron.
  const cambios: Record<string, string | null> = {};
  if (r.hoja_origen) {
    cambios.sheets_pendiente = partes.length > 0 ? partes.join(" — ") : null;
    cambios.sheets_intentado_en = new Date().toISOString();
  } else if (partes.length > 0) {
    console.error(
      `RI ${r.nro_ri}: no se encoló "${partes.join(" — ")}" porque el alta todavía no ` +
        `llegó a la planilla y su pendiente no se pisa`
    );
  }
  if (escritas.length > 0) cambios.sheets_sincronizado_en = new Date().toISOString();

  // Un `update({})` es un PATCH sin cuerpo y PostgREST lo rechaza: con el
  // guardarraíl puesto y nada escrito, no queda nada que actualizar.
  if (Object.keys(cambios).length > 0) {
    await admin.from("compras_requerimientos").update(cambios).eq("id", requerimientoId);
  }

  return { escritas, bloqueadas, enEspera };
}

export interface ResultadoReintento {
  intentados: number;
  resueltos: number;
  siguenPendientes: number;
  /** Los que quedaron en la cola sin intentarse, por el tope de la corrida. */
  sinIntentar: number;
}

/**
 * Cuántos RI se escriben por corrida.
 *
 * La cuota de Sheets se cuenta por minuto, y escribir un RI son hasta nueve
 * celdas —cada una es una llamada, porque un lote entero falla si una sola
 * celda está protegida—. Con doce pendientes de una, Google devolvía 429 a
 * mitad de camino y el reintento anotaba el 429 como si la planilla hubiera
 * rechazado los cambios.
 *
 * Cinco por corrida entra cómodo en el límite. Lo que sobra espera la próxima,
 * que con el cron es en quince minutos.
 */
const POR_CORRIDA = 5;

/**
 * Reintenta las escrituras que la planilla había rechazado.
 *
 * Casi siempre el motivo es corregible desde afuera —se cargó el alias que
 * faltaba, o alguien sumó la cuenta de servicio a la protección—, así que el
 * reintento es lo que hace que las dos herramientas vuelvan a coincidir sin
 * tener que tocar el requerimiento de nuevo.
 *
 * **No todo pendiente es el mismo pendiente.** Hasta acá la cola se interpretaba
 * entera como "faltan las columnas de compra" y se reintentaba con
 * `exportarRequerimiento`, que para un pedido que nunca llegó a la planilla no
 * escribe nada: no tiene ninguna rama que escriba la hoja de respuestas, y no
 * hay fila del master donde escribir. Ese caso se reconoce por `hoja_origen`
 * nulo y se reintenta con el alta.
 */
export async function reintentarPendientes(limite = POR_CORRIDA): Promise<ResultadoReintento> {
  const admin = createAdminClient();

  // Cuántos hay en la cola, aparte de cuántos se van a intentar: si el tope
  // deja algunos afuera hay que decirlo, o la pantalla parece mentir cuando
  // sigue habiendo pendientes después de reintentar.
  const { count: enLaCola } = await admin
    .from("compras_requerimientos")
    .select("id", { count: "exact", head: true })
    .not("sheets_pendiente", "is", null);

  const { data: pendientes } = await admin
    .from("compras_requerimientos")
    // `hoja_origen` dice si el pedido llegó alguna vez a la planilla: al que no
    // llegó le falta el ALTA, y reintentarlo con las columnas de compra no
    // escribe nada. El `nro_ri` es sólo para que el log diga de qué RI habla.
    .select("id, nro_ri, hoja_origen")
    // Los que hace más que se intentaron van primero, así la cola rota y
    // ninguno queda esperando para siempre detrás de los mismos cinco.
    .order("sheets_intentado_en", { ascending: true, nullsFirst: true })
    .not("sheets_pendiente", "is", null)
    .limit(limite);

  const cache = nuevoCacheSheets();
  let resueltos = 0;
  let siguenPendientes = 0;

  for (const [i, r] of (pendientes ?? []).entries()) {
    // Un respiro entre RI: la cuota es por minuto y ocho escrituras seguidas
    // por cada uno la agotan en ráfaga.
    if (i > 0) await espera(1000);

    try {
      // Nunca llegó a la planilla: lo que falta es el alta, y sólo el alta lo
      // puede resolver. Es la otra punta del guardarraíl de
      // `exportarRequerimiento`, que para estos pedidos se niega a tocar
      // `sheets_pendiente`: si esta rama no existiera, quedarían en la cola
      // para siempre sin que nadie vuelva a intentar escribirlos.
      if (!r.hoja_origen) {
        const { pendiente } = await exportarAltaAlFormulario(r.id as string);

        // Se deja **lo que devolvió el alta**: el motivo nuevo si sigue sin
        // poder escribirse, o `null` si esta vez salió bien. Es la misma
        // escritura que hace `exportarRequerimiento` al final y por la misma
        // razón: este campo ES la cola.
        const { error: errorCola } = await admin
          .from("compras_requerimientos")
          .update({
            sheets_pendiente: pendiente,
            sheets_intentado_en: new Date().toISOString(),
          })
          .eq("id", r.id as string);

        if (errorCola) {
          // No se pudo mover la cola: el RI sigue con el pendiente que traía,
          // así que va a volver a aparecer en la próxima corrida. Eso está
          // bien —es lo que queremos— pero **no es "resuelto"**: contarlo así
          // haría que la pantalla diga que no queda nada mientras la cola dice
          // que sí, que es la contradicción que este contador ya tuvo una vez.
          console.error(
            `RI ${r.nro_ri ?? r.id}: el alta se reintentó pero no se pudo actualizar la cola`,
            errorCola
          );
          siguenPendientes++;
        } else if (pendiente) {
          siguenPendientes++;
        } else {
          resueltos++;
        }
        continue;
      }

      const { bloqueadas, enEspera } = await exportarRequerimiento(r.id as string, cache);
      // Un RI con algo en espera **sigue pendiente**: la fila del master no
      // existía todavía, así que prioridad y empresa no se escribieron y
      // `sheets_pendiente` quedó puesto. Contarlo como resuelto —que es lo que
      // pasaba mirando sólo `bloqueadas`— hacía que la pantalla de Configuración
      // dijera que no quedaba nada mientras seguía quedando, y encima con la
      // cuenta de la cola contradiciéndola.
      if (bloqueadas.length === 0 && enEspera.length === 0) resueltos++;
      else siguenPendientes++;
    } catch {
      // Si la planilla no responde, queda pendiente para la próxima.
      siguenPendientes++;
    }
  }

  const intentados = pendientes?.length ?? 0;
  return {
    intentados,
    resueltos,
    siguenPendientes,
    sinIntentar: Math.max(0, (enLaCola ?? intentados) - intentados),
  };
}