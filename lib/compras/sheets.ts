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

const HOJA_MASTER = "Requerimientos internos";

type Admin = ReturnType<typeof createAdminClient>;

// ── Autenticación con Google ─────────────────────────────────

async function obtenerToken(escritura: boolean): Promise<string> {
  const crudo = process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "";
  if (!crudo) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON no configurado");

  const cuenta = JSON.parse(crudo);
  const ahora = Math.floor(Date.now() / 1000);
  const carga = {
    iss: cuenta.client_email,
    scope: escritura
      ? "https://www.googleapis.com/auth/spreadsheets"
      : "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: ahora,
    exp: ahora + 3600,
  };

  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const sinFirmar = `${b64({ alg: "RS256", typ: "JWT" })}.${b64(carga)}`;
  const pem = cuenta.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, "");

  const clave = await crypto.subtle.importKey(
    "pkcs8",
    Buffer.from(pem, "base64"),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const firma = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", clave, Buffer.from(sinFirmar));
  const jwt = `${sinFirmar}.${Buffer.from(firma).toString("base64url")}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const datos = await res.json();
  if (!datos.access_token) throw new Error(`Google OAuth: ${JSON.stringify(datos)}`);
  return datos.access_token;
}

const idPlanilla = () => {
  const id = process.env.GOOGLE_SHEETS_COMPRAS_ID ?? "";
  if (!id) throw new Error("GOOGLE_SHEETS_COMPRAS_ID no configurado");
  return id;
};

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

const norm = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .trim().toUpperCase().replace(/[°º.]/g, "").replace(/\s+/g, " ");

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
  solicita: ["SOLICITA"],
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

/** La API de Sheets devuelve las fechas como texto formateado, no como serial. */
function fechaISO(v: unknown): string | null {
  const s = texto(v);
  if (!s) return null;

  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    const [, a, b, anio] = m;
    // Si el primer número no puede ser un mes, es D/M; si no, M/D, que es el
    // formato de la mayoría de las filas de la planilla.
    const dia = Number(a) > 12 ? Number(a) : Number(b);
    const mes = Number(a) > 12 ? Number(b) : Number(a);
    const anioCompleto = anio.length === 2 ? 2000 + Number(anio) : Number(anio);
    const d = new Date(anioCompleto, mes - 1, dia);
    if (isNaN(d.getTime())) return null;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

const PRIORIDADES_VALIDAS = new Set(["URGENTE", "1 SEMANA", "2 SEMANAS", "NORMAL", "LEVE"]);
const prioridadDe = (v: unknown) => {
  const s = norm(v);
  return PRIORIDADES_VALIDAS.has(s) ? s : "NORMAL";
};

function partirEstado(valor: unknown) {
  const s = norm(valor);
  if (!s) return { base: null as string | null, quien: null as string | null };
  const m = s.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  return m ? { base: m[1].trim(), quien: m[2].trim() } : { base: s, quien: null };
}

/** "APROBADA (NICO)" → el paréntesis es quién aprobó, no otro estado. */
export function estadoAprobacionDe(valor: unknown) {
  const { base, quien } = partirEstado(valor);
  if (!base) return { estado: "PENDIENTE", aprobador: null as string | null };
  if (base.startsWith("APROBAD")) return { estado: "APROBADA", aprobador: quien };
  if (base.startsWith("DENEGAD") || base.startsWith("RECHAZ")) return { estado: "DENEGADA", aprobador: quien };
  if (base.includes("REVISI")) return { estado: "EN_REVISION", aprobador: null };
  return { estado: "PENDIENTE", aprobador: null };
}

export function estadoCompraDe(valor: unknown) {
  const { base, quien } = partirEstado(valor);
  if (!base) return { estado: "SIN_INICIAR", aprobador: null as string | null };
  if (base === "PEDIDO") return { estado: "PEDIDO", aprobador: null };
  if (base === "RECIBIDO") return { estado: "RECIBIDO", aprobador: null };
  if (base.startsWith("DENEGAD")) return { estado: "DENEGADO", aprobador: null };
  if (base.includes("COMPARATIVA") || base.startsWith("EN PROCESO")) {
    return { estado: "EN_COMPARATIVA", aprobador: null };
  }
  if (base.startsWith("PARA COMPRAR")) {
    // "(POR APROBAR)" no nombra a una persona: dice que falta la aprobación.
    const esPersona = quien && !/POR APROBAR/i.test(quien);
    return { estado: "PARA_COMPRAR", aprobador: esPersona ? quien : null };
  }
  if (base.startsWith("APROBAD")) return { estado: "PARA_COMPRAR", aprobador: quien };
  return { estado: "SIN_INICIAR", aprobador: null };
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
            empresa: norm(val(fila, "empresa")),
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
    const idUbicacion = await asegurarUbicaciones(admin, registros.map((r) => r.datos.ubicacion));

    // Los RI ya gestionados desde la app no se pisan.
    //
    // Va paginado: PostgREST corta en 1000 filas, y con la tabla más grande que
    // eso el resguardo dejaba de aplicar sobre el resto — la planilla revertía
    // aprobaciones y proveedores cargados desde el sistema, sin ruido alguno.
    const existentes = await traerTodo<{ nro_ri: number; editado_en_app: boolean }>(
      (desde, hasta) =>
        admin
          .from("compras_requerimientos")
          .select("nro_ri, editado_en_app")
          .range(desde, hasta)
    );
    const estado = new Map(existentes.map((r) => [r.nro_ri, r.editado_en_app]));

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
        prioridad: d.prioridad ?? "NORMAL",
        // "AMBAS" no es una empresa: queda en null.
        empresa_id: porEmpresa.get(String(d.empresa ?? "")) ?? null,
        solicitante_nombre: d.solicitante_nombre ?? null,
        estado_aprobacion: d.estado_aprobacion ?? "PENDIENTE",
        aprobador: d.aprobador ?? null,
        estado_compra: d.estado_compra ?? "SIN_INICIAR",
        comparativa_url: d.comparativa_url ?? null,
        proveedor_id: d.proveedor
          ? idProveedor.get(claveProveedor(String(d.proveedor))) ?? null
          : null,
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

// ── Exportar: app → planilla ─────────────────────────────────

/** Columnas de la hoja de área que gestiona Compras. */
const COLUMNAS_COMPRA = ["comparativa", "proveedor", "estado", "costo_iva", "costo_envio"] as const;

/** Columna del master donde vive el estado de aprobación. */
const COLUMNA_APROBACION = "estado";

const ETIQUETA_ESTADO_COMPRA: Record<string, string> = {
  SIN_INICIAR: "",
  PARA_COMPRAR: "PARA COMPRAR",
  EN_COMPARATIVA: "EN PROCESO (COMPARATIVA)",
  PEDIDO: "PEDIDO",
  RECIBIDO: "RECIBIDO",
  DENEGADO: "DENEGADO",
};

const letraColumna = (i: number) => String.fromCharCode(65 + i);

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
export async function opcionesAprobacion(): Promise<string[]> {
  const encabezado = await leerPestana(`${HOJA_MASTER}!A1:R1`);
  const idx = indexarColumnas(encabezado[0] ?? []);
  const col = idx[COLUMNA_APROBACION];
  if (col < 0) return [];

  const letra = letraColumna(col);
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

/** Busca en qué fila del master está un RI. */
async function filaEnMaster(nroRi: number): Promise<number | null> {
  const filas = await leerPestana(`${HOJA_MASTER}!A:A`);
  for (let i = 1; i < filas.length; i++) {
    const n = Number(String(filas[i]?.[0] ?? "").replace(/[^0-9]/g, ""));
    if (n === nroRi) return i + 1;
  }
  return null;
}

/** Escribe una celda. Devuelve null si salió bien, o el motivo si no. */
async function escribirCelda(token: string, rango: string, valor: string): Promise<string | null> {
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${idPlanilla()}` +
    `/values/${encodeURIComponent(rango)}?valueInputOption=USER_ENTERED`;

  const res = await fetch(url, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: [[valor]] }),
  });
  if (res.ok) return null;

  const cuerpo = await res.text();
  // La planilla tiene rangos protegidos: la aprobación sólo la pueden tocar
  // ciertas cuentas, y un script bloquea el Estado de cada fila al aprobarla.
  if (cuerpo.includes("protected")) return "celda protegida en la planilla";
  return `error ${res.status}`;
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
export async function exportarRequerimiento(requerimientoId: string): Promise<ResultadoExportacion> {
  const vacio: ResultadoExportacion = { escritas: [], bloqueadas: [] };
  if (!process.env.GOOGLE_SHEETS_COMPRAS_ID || !process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return vacio;

  const admin = createAdminClient();
  const { data: r } = await admin
    .from("compras_requerimientos")
    .select("*, proveedores(nombre)")
    .eq("id", requerimientoId)
    .single();

  if (!r) return vacio;

  const token = await obtenerToken(true);
  const escritas: string[] = [];
  const bloqueadas: string[] = [];

  // ── Estado de aprobación, en el master ──
  if (r.estado_aprobacion !== "PENDIENTE") {
    // El alias es con el que la persona figura en el desplegable de la planilla.
    const { data: aprobador } = r.aprobado_por
      ? await admin
          .from("compras_aprobadores")
          .select("alias_planilla")
          .eq("usuario_id", r.aprobado_por)
          .maybeSingle()
      : { data: null };

    const { valor, motivo } = textoAprobacion(
      r.estado_aprobacion as string,
      aprobador?.alias_planilla ?? null,
      await opcionesAprobacion()
    );

    if (!valor) {
      if (motivo) bloqueadas.push(`aprobación (${motivo})`);
    } else {
      const fila = r.hoja_origen === HOJA_MASTER && r.sheets_fila
        ? (r.sheets_fila as number)
        : await filaEnMaster(r.nro_ri as number);

      if (fila) {
        const encabezado = await leerPestana(`${HOJA_MASTER}!A1:R1`);
        const idx = indexarColumnas(encabezado[0] ?? []);
        if (idx[COLUMNA_APROBACION] >= 0) {
          const fallo = await escribirCelda(
            token,
            `${HOJA_MASTER}!${letraColumna(idx[COLUMNA_APROBACION])}${fila}`,
            valor
          );
          if (fallo) bloqueadas.push(`aprobación (${fallo})`);
          else escritas.push("aprobación");
        }
      }
    }
  }

  // ── Columnas de compra, en la hoja del área ──
  if (r.hoja_origen && r.sheets_fila && r.hoja_origen !== HOJA_MASTER) {
    const encabezado = await leerPestana(`${r.hoja_origen}!A1:R1`);
    if (encabezado.length > 0) {
      const idx = indexarColumnas(encabezado[0]);
      const valores: Record<string, string> = {
        comparativa: (r.comparativa_url as string) ?? "",
        proveedor: (r.proveedores as { nombre: string } | null)?.nombre ?? "",
        estado: ETIQUETA_ESTADO_COMPRA[r.estado_compra as string] ?? "",
        costo_iva: r.costo_iva !== null ? String(r.costo_iva) : "",
        costo_envio: r.costo_envio !== null ? String(r.costo_envio) : "",
      };

      for (const clave of COLUMNAS_COMPRA) {
        if (idx[clave] < 0) continue;
        const motivo = await escribirCelda(
          token,
          `${r.hoja_origen}!${letraColumna(idx[clave])}${r.sheets_fila}`,
          valores[clave]
        );
        if (motivo) bloqueadas.push(`${clave} (${motivo})`);
        else escritas.push(clave);
      }
    }
  }

  if (escritas.length > 0) {
    await admin
      .from("compras_requerimientos")
      .update({ sheets_sincronizado_en: new Date().toISOString() })
      .eq("id", requerimientoId);
  }

  return { escritas, bloqueadas };
}