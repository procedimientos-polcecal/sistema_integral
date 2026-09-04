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
import { linkDeCelda } from "@/lib/compras/vincular";
import {
  obtenerToken as tokenGoogle, SCOPE_SHEETS, SCOPE_SHEETS_LECTURA,
} from "@/lib/core/google";

const HOJA_MASTER = "Requerimientos internos";

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

function indexarColumnas(encabezado: string[]): Record<string, number> {
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
 * Qué dice la planilla sobre quién paga.
 *
 * La celda vacía ya no se toma como "Ambas": son cosas distintas —una es una
 * decisión y la otra su ausencia— y hasta ahora se confundían. "Ambas" sólo
 * cuando la planilla lo dice.
 */
const pagaDe = (v: unknown): { empresa: string | null; ambas: boolean } => {
  const s = norm(v);
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

interface FilaPlanilla {
  nro_ri: number;
  hoja: string;
  fila: number;
  datos: Record<string, unknown>;
}

export async function importarDesdeSheets(origen = "cron"): Promise<ResultadoSync> {
  const comenzo = Date.now();
  const admin = createAdminClient();

  try {
    const pestanas = await listarPestanas();
    const aLeer = [
      ...(pestanas.includes(HOJA_MASTER) ? [HOJA_MASTER] : []),
      ...pestanas.filter((p) => p.startsWith("RI ")),
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
            comparativa_url: texto(val(fila, "comparativa")),
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
      estado_aprobacion: string;
      estado_compra: string;
      compra_asignada_a: string | null;
      solicitante_nombre: string | null;
    }>((desde, hasta) =>
      admin
        .from("compras_requerimientos")
        .select("nro_ri, editado_en_app, estado_aprobacion, estado_compra, compra_asignada_a, solicitante_nombre")
        .range(desde, hasta)
    );
    const estado = new Map(existentes.map((r) => [r.nro_ri, r.editado_en_app]));
    // Lo que ya sabemos de cada RI, para no pisarlo con un valor por defecto
    // cuando la planilla no dice nada.
    const previo = new Map(existentes.map((r) => [r.nro_ri, r]));

    const aEscribir: Record<string, unknown>[] = [];
    let omitidas = 0;
    let nuevas = 0;

    for (const registro of registros) {
      const yaExiste = estado.has(registro.nro_ri);
      if (yaExiste && estado.get(registro.nro_ri)) { omitidas++; continue; }
      if (!yaExiste) nuevas++;

      const d = registro.datos;
      const ubicacion = d.ubicacion ? String(d.ubicacion) : null;
      const clave = ubicacion ? norm(ubicacion) : null;

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
        prioridad: d.prioridad ?? null,
        empresa_id: (d.paga as { empresa: string | null })?.empresa
          ? porEmpresa.get((d.paga as { empresa: string }).empresa) ?? null
          : null,
        paga_ambas: (d.paga as { ambas: boolean })?.ambas ?? false,
        // Se conserva lo que hubiera si la planilla no lo trae, igual que el
        // estado y la asignación de compra. Sin esto, un RI cargado en la app
        // —que sí sabe quién lo pidió— perdía el nombre en la primera
        // sincronización que releyera su fila, y su autor dejaba de verlo entre
        // los suyos. `solicitante_id` no viaja en este upsert, así que ese no
        // se toca.
        solicitante_nombre:
          d.solicitante_nombre ?? previo.get(registro.nro_ri)?.solicitante_nombre ?? null,
        // Que la planilla no diga nada no significa "sin aprobar" ni "sin
        // iniciar": significa que no se pudo leer. Pisar con el valor por
        // defecto revertia compras ya hechas —15 pasaron de PEDIDO a
        // SIN_INICIAR en una sola corrida—, asi que se conserva lo que habia y
        // el default queda solo para un RI que no existia.
        estado_aprobacion:
          d.estado_aprobacion ?? previo.get(registro.nro_ri)?.estado_aprobacion ?? "PENDIENTE",
        aprobador: d.aprobador ?? null,
        estado_compra:
          d.estado_compra ?? previo.get(registro.nro_ri)?.estado_compra ?? "SIN_INICIAR",
        comparativa_url: d.comparativa_url ?? null,
        proveedor_id: d.proveedor
          ? idProveedor.get(claveProveedor(String(d.proveedor))) ?? null
          : null,
        // Sin esto, un RI que la planilla marca "PARA COMPRAR (NICO)" llegaba a
        // la app sin asignar, y como aprobar la compra es de quien la tiene
        // asignada, no lo podía aprobar nadie.
        // Si el alias no está registrado en /compras/configuracion no se puede
        // resolver, y ahí se conserva lo que hubiera: no saber quién es no es
        // razon para dejar la compra sin nadie que pueda aprobarla.
        compra_asignada_a:
          (d.asignado_alias ? porAlias.get(norm(d.asignado_alias)) : null) ??
          previo.get(registro.nro_ri)?.compra_asignada_a ??
          null,
        costo_iva: d.costo_iva ?? null,
        costo_envio: d.costo_envio ?? null,
        origen: "sheets",
        hoja_origen: registro.hoja,
        sheets_fila: registro.fila,
        sheets_sincronizado_en: new Date().toISOString(),
      });
    }

    for (let i = 0; i < aEscribir.length; i += 500) {
      const lote = aEscribir.slice(i, i + 500);
      const { error } = await admin
        .from("compras_requerimientos")
        .upsert(lote, { onConflict: "nro_ri" });
      if (error) throw new Error(error.message);
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

    return resultado;
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

/** Columnas de la hoja de área que gestiona Compras. */
const COLUMNAS_COMPRA = ["comparativa", "proveedor", "estado", "costo_iva", "costo_envio"] as const;

/** Columnas del master que escribe la app al aprobar. */
const COLUMNA_APROBACION = "estado";
const COLUMNAS_DEL_APROBADOR = ["prioridad", "empresa"] as const;

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
  /** Celdas que la planilla no dejó tocar, con el motivo en lenguaje llano. */
  bloqueadas: string[];
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
 * hecho que la planilla quedó al día.
 */
export async function exportarRequerimiento(
  requerimientoId: string,
  cacheDeLaCorrida?: CacheSheets
): Promise<ResultadoExportacion> {
  // Sin cache se comporta como siempre: una llamada suelta arma el suyo y no
  // reusa nada. El reintento sí lo comparte entre todos los RI de la corrida.
  const cache = cacheDeLaCorrida ?? nuevoCacheSheets();
  const vacio: ResultadoExportacion = { escritas: [], bloqueadas: [] };
  if (!process.env.GOOGLE_SHEETS_COMPRAS_ID || !process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return vacio;

  const admin = createAdminClient();
  const { data: r } = await admin
    .from("compras_requerimientos")
    .select("*, proveedores(nombre), empresas(nombre)")
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
      const fila = r.hoja_origen === HOJA_MASTER && r.sheets_fila
        ? (r.sheets_fila as number)
        : await filaEnMaster(r.nro_ri as number, cache);

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

        // Prioridad y quién paga se deciden al aprobar, así que se escriben
        // junto con la aprobación y no antes.
        const valoresAprobador: Record<string, string> = {
          prioridad: (r.prioridad as string) ?? "",
          empresa: empresaParaPlanilla(
            (r.empresas as { nombre: string } | null)?.nombre,
            r.paga_ambas === true
          ),
        };

        for (const clave of COLUMNAS_DEL_APROBADOR) {
          if (idx[clave] < 0) continue;
          const fallo = await escribirCelda(
            token,
            `${HOJA_MASTER}!${letraDeColumna(idx[clave])}${fila}`,
            valoresAprobador[clave]
          );
          if (fallo) bloqueadas.push(`${clave} (${fallo})`);
          else escritas.push(clave);
        }
      }
    }
  }

  // ── Columnas de compra, en la hoja del área ──
  if (r.hoja_origen && r.sheets_fila && r.hoja_origen !== HOJA_MASTER) {
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
        comparativa: (r.comparativa_url as string) ?? "",
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
  await admin
    .from("compras_requerimientos")
    .update({
      sheets_pendiente: bloqueadas.length > 0 ? bloqueadas.join("; ") : null,
      sheets_intentado_en: new Date().toISOString(),
      ...(escritas.length > 0 ? { sheets_sincronizado_en: new Date().toISOString() } : {}),
    })
    .eq("id", requerimientoId);

  return { escritas, bloqueadas };
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
 * La cuota de Sheets se cuenta por minuto, y escribir un RI son hasta ocho
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
    .select("id")
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
      const { bloqueadas } = await exportarRequerimiento(r.id as string, cache);
      if (bloqueadas.length === 0) resueltos++;
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