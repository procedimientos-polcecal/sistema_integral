/**
 * Hablar con el Odoo del grupo (https://polcecal.odoo.com).
 *
 * Es **Odoo 17.0 Enterprise en Odoo Online (SaaS)**. Eso decide todo lo demás:
 *
 * - Se habla por **JSON-RPC** (`/jsonrpc`). La API nueva con `Authorization:
 *   Bearer` (la JSON-2, `/json/2/<modelo>/<metodo>`) es de la 19: acá no existe.
 * - Se autentica con **API key**, no con contraseña. La genera el usuario bot en
 *   su perfil de Odoo → Seguridad de la cuenta → API Keys.
 * - **No hay módulos propios ni acceso al Postgres de Odoo**: es SaaS. Todo sale
 *   por los modelos estándar del ORM.
 *
 * Igual que `lib/core/google.ts`, es `fetch` a mano en vez de una librería:
 * JSON-RPC son dos llamadas contadas y no vale arrastrar una dependencia (menos
 * todavía una de XML-RPC, que obligaría a parsear XML en el runtime de Vercel).
 *
 * Quién manda sobre qué dato está escrito en `docs/ODOO-INTEGRACION.md`, y no es
 * un detalle: la contabilidad la escribe Odoo, el SdG la lee.
 */

/** Odoo Online no es rápido. Treinta segundos es esperar de más, no de menos. */
const TIEMPO_LIMITE_MS = 30_000;

/**
 * Contexto que va en toda llamada salvo que se pida otro.
 *
 * La zona horaria no es cosmética: Odoo guarda los `datetime` en UTC y los
 * convierte con la tz del contexto. Sin esto, agrupar pagos "por día" corre los
 * de la noche al día siguiente — el mismo error que ya costó corregir 885
 * registros en Compras, pero del otro lado.
 */
const CONTEXTO_BASE = { lang: "es_AR", tz: "America/Argentina/Buenos_Aires" } as const;

export interface CredencialesOdoo {
  url: string;
  db: string;
  usuario: string;
  clave: string;
}

/** Un registro de Odoo: siempre trae `id`, el resto depende de los campos pedidos. */
export interface Registro {
  id: number;
  [campo: string]: unknown;
}

/**
 * Un many2one llega como `[id, nombre]`, o `false` si está vacío.
 * (Odoo no usa `null`: usa `false` para todo lo ausente.)
 */
export type Many2One = [number, string] | false;

/** Un dominio de Odoo: `[["state", "=", "purchase"], ["amount_total", ">", 0]]`. */
export type Dominio = unknown[];

export function hayCredencialesOdoo(): boolean {
  return credencialesQueFaltan().length === 0;
}

/** Qué variables faltan, para poder decirlo en pantalla en vez de reventar. */
export function credencialesQueFaltan(): string[] {
  return (["ODOO_URL", "ODOO_DB", "ODOO_USER", "ODOO_API_KEY"] as const).filter(
    (v) => !process.env[v]
  );
}

/**
 * La URL base, sin barra final.
 *
 * Se normaliza porque pegar `https://polcecal.odoo.com/` con la barra deja
 * `//jsonrpc`, y Odoo contesta con un 404 en HTML que no explica nada.
 */
function urlDeOdoo(): string {
  const url = process.env.ODOO_URL;
  if (!url) throw new Error("Falta configurar ODOO_URL");
  return url.trim().replace(/\/+$/, "");
}

function credenciales(): CredencialesOdoo {
  const faltan = credencialesQueFaltan();
  if (faltan.length) {
    throw new Error(`Faltan variables de entorno de Odoo: ${faltan.join(", ")}`);
  }
  return {
    url: urlDeOdoo(),
    db: process.env.ODOO_DB!.trim(),
    usuario: process.env.ODOO_USER!.trim(),
    clave: process.env.ODOO_API_KEY!.trim(),
  };
}

// ── El transporte ────────────────────────────────────────────

interface ErrorDeOdoo {
  code?: number;
  message?: string;
  data?: {
    name?: string;
    message?: string;
    debug?: string;
    arguments?: unknown[];
  };
}

/**
 * Una llamada JSON-RPC cruda.
 *
 * Ojo con lo que no se ve: **Odoo devuelve los errores con HTTP 200** y el
 * detalle adentro, en `error`. Chequear `res.ok` no alcanza; si no se mira el
 * cuerpo, un fallo de permisos pasa por respuesta válida y el `result` llega
 * `undefined` mucho más tarde, en otro lugar.
 */
async function jsonrpc<T>(
  servicio: "common" | "object",
  metodo: string,
  args: unknown[]
): Promise<T> {
  const url = `${urlDeOdoo()}/jsonrpc`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "call",
        params: { service: servicio, method: metodo, args },
        id: null,
      }),
      signal: AbortSignal.timeout(TIEMPO_LIMITE_MS),
    });
  } catch (e) {
    // Un timeout o un DNS caído no llegan como respuesta: llegan como throw.
    const detalle = e instanceof Error ? e.message : String(e);
    throw new Error(`No se pudo llegar a Odoo (${url}): ${detalle}`);
  }

  const cuerpo = await res.text();

  if (!res.ok && !cuerpo.trimStart().startsWith("{")) {
    // 502 del proxy, mantenimiento de Odoo Online, URL equivocada: HTML, no JSON.
    throw new Error(`Odoo respondió ${res.status} y no era JSON: ${cuerpo.slice(0, 200)}`);
  }

  let json: { result?: T; error?: ErrorDeOdoo };
  try {
    json = JSON.parse(cuerpo);
  } catch {
    throw new Error(`Odoo devolvió algo que no es JSON: ${cuerpo.slice(0, 200)}`);
  }

  if (json.error) {
    // El traceback de Python es útil, pero en el log del servidor, no en pantalla.
    if (json.error.data?.debug) console.error("[odoo]", json.error.data.debug);
    throw new Error(mensajeDeOdoo(json.error));
  }

  return json.result as T;
}

// ── Sesión ───────────────────────────────────────────────────

/**
 * El `uid` del usuario bot, cacheado mientras viva la instancia.
 *
 * Autenticar es un viaje de red completo y el uid de un usuario no cambia
 * nunca, así que repetirlo en cada llamada es regalar latencia. No es un caché
 * entre usuarios: acá hay un solo usuario, el de la integración.
 */
let uidCacheado: number | null = null;

export async function autenticar(): Promise<number> {
  if (uidCacheado !== null) return uidCacheado;

  const { db, usuario, clave } = credenciales();
  const uid = await jsonrpc<number | false>("common", "authenticate", [db, usuario, clave, {}]);

  /*
   * Credenciales malas **no** son un error de JSON-RPC: `authenticate` devuelve
   * `false` y sigue de largo. Si no se corta acá, el `false` viaja como uid y el
   * error aparece recién en la llamada siguiente, hablando de otra cosa.
   */
  if (!uid) {
    throw new Error(
      `Odoo rechazó las credenciales de ${usuario} en la base "${db}". ` +
        `Revisar: que ODOO_DB sea el nombre real de la base (en Odoo Online suele ser el subdominio), ` +
        `que ODOO_USER sea el email exacto del usuario, y que ODOO_API_KEY sea una API key vigente ` +
        `(perfil del usuario en Odoo → Seguridad de la cuenta → API Keys), no la contraseña.`
    );
  }

  uidCacheado = uid;
  return uid;
}

/** Tirar la sesión cacheada. Hace falta al rotar la API key, y en los tests. */
export function olvidarSesionOdoo(): void {
  uidCacheado = null;
}

// ── Llamadas al ORM ──────────────────────────────────────────

/**
 * Cualquier método del ORM sobre cualquier modelo.
 *
 * Todo lo demás de este archivo es azúcar sobre esto. Y va por el ORM a
 * propósito: escribir "directo" saltea las reglas de Odoo, que en contabilidad
 * son justamente lo que no hay que saltear.
 */
export async function llamar<T>(
  modelo: string,
  metodo: string,
  args: unknown[] = [],
  kwargs: Record<string, unknown> = {}
): Promise<T> {
  const { db, clave } = credenciales();
  const uid = await autenticar();

  const conContexto = {
    ...kwargs,
    context: { ...CONTEXTO_BASE, ...((kwargs.context as object) ?? {}) },
  };

  return jsonrpc<T>("object", "execute_kw", [db, uid, clave, modelo, metodo, args, conContexto]);
}

export interface OpcionesDeLectura {
  limite?: number;
  desplazamiento?: number;
  /** Como en Odoo: `"date_order desc"`, `"name asc"`. */
  orden?: string;
  contexto?: Record<string, unknown>;
}

/**
 * Buscar y leer en una sola llamada.
 *
 * Los campos van siempre explícitos: sin `fields`, Odoo devuelve *todos* los
 * del modelo, y `account.move` tiene más de doscientos. Con el throttling de
 * Odoo Online eso es la diferencia entre una sync que corre y una que no.
 */
export async function buscarLeer<T = Registro>(
  modelo: string,
  dominio: Dominio,
  campos: string[],
  opciones: OpcionesDeLectura = {}
): Promise<T[]> {
  const kwargs: Record<string, unknown> = { fields: campos };
  if (opciones.limite !== undefined) kwargs.limit = opciones.limite;
  if (opciones.desplazamiento !== undefined) kwargs.offset = opciones.desplazamiento;
  if (opciones.orden !== undefined) kwargs.order = opciones.orden;
  if (opciones.contexto) kwargs.context = opciones.contexto;

  return llamar<T[]>(modelo, "search_read", [dominio], kwargs);
}

/** Cuántos registros cumplen el dominio, sin traerlos. */
export async function contar(modelo: string, dominio: Dominio = []): Promise<number> {
  return llamar<number>(modelo, "search_count", [dominio]);
}

/**
 * Sumas y conteos agrupados, calculados por Odoo (`read_group`).
 *
 * Es la única forma sensata de sacar los saldos de tesorería: sumar
 * `account.move.line` agrupando por diario. La alternativa —traerse los apuntes
 * y sumarlos acá— son decenas de miles de filas por la red.
 *
 * `lazy: false` va fijo: con el default `true`, Odoo agrupa sólo por el primer
 * campo y devuelve el resto sin desglosar, que casi nunca es lo que se pidió.
 */
export async function agrupar(
  modelo: string,
  dominio: Dominio,
  campos: string[],
  agrupadores: string[],
  opciones: { limite?: number; orden?: string } = {}
): Promise<Record<string, unknown>[]> {
  const kwargs: Record<string, unknown> = { lazy: false };
  if (opciones.limite !== undefined) kwargs.limit = opciones.limite;
  if (opciones.orden !== undefined) kwargs.orderby = opciones.orden;

  return llamar<Record<string, unknown>[]>(
    modelo,
    "read_group",
    [dominio, campos, agrupadores],
    kwargs
  );
}

/** Los campos de un modelo. Sirve para descubrir el esquema real antes de mapear. */
export async function camposDe(
  modelo: string
): Promise<
  Record<string, { string?: string; type?: string; required?: boolean; relation?: string }>
> {
  return llamar(modelo, "fields_get", [[]], {
    attributes: ["string", "type", "required", "relation"],
  });
}

/**
 * La versión del servidor, sin autenticar.
 *
 * No necesita credenciales —sólo la URL—, así que es la primera cosa que
 * conviene preguntar cuando algo no anda: si esto contesta, el problema está en
 * la API key y no en la red.
 */
export async function versionDeOdoo(): Promise<{ version: string; serie: string }> {
  const info = await jsonrpc<{ server_version: string; server_serie: string }>(
    "common",
    "version",
    []
  );
  return { version: info.server_version, serie: info.server_serie };
}

// ── Ayudantes ────────────────────────────────────────────────

/** El nombre de un many2one, o `null` si está vacío. */
export function nombreDeRelacion(valor: unknown): string | null {
  return Array.isArray(valor) && typeof valor[1] === "string" ? valor[1] : null;
}

/** El id de un many2one, o `null` si está vacío. */
export function idDeRelacion(valor: unknown): number | null {
  return Array.isArray(valor) && typeof valor[0] === "number" ? valor[0] : null;
}

// ── Errores ──────────────────────────────────────────────────

/**
 * Traduce un error de Odoo a algo accionable.
 *
 * Odoo contesta con la excepción de Python y un traceback de cuarenta líneas.
 * Lo que hace falta saber es otra cosa, y casi siempre es una de tres: falta un
 * permiso al usuario bot, falta una app instalada, o una regla de negocio dijo
 * que no. El traceback queda en el log del servidor.
 */
export function mensajeDeOdoo(error: ErrorDeOdoo): string {
  const nombre = error.data?.name ?? "";
  const detalle = (error.data?.message ?? error.message ?? "").trim();
  const corto = detalle.replace(/\s+/g, " ").slice(0, 300);

  if (nombre.includes("AccessDenied")) {
    return `Odoo rechazó las credenciales (revisar ODOO_USER y ODOO_API_KEY). ${corto}`;
  }

  if (nombre.includes("AccessError")) {
    return (
      `El usuario de integración no tiene permiso para eso: ${corto} ` +
      `Se arregla en Odoo, dándole el grupo que corresponda al módulo (Ajustes → Usuarios).`
    );
  }

  if (nombre.includes("MissingError")) {
    return `Ese registro ya no existe en Odoo (lo borraron, o el id que guardamos quedó viejo). ${corto}`;
  }

  if (nombre.includes("ValidationError")) {
    return `Odoo no aceptó los datos: ${corto}`;
  }

  if (nombre.includes("UserError")) {
    return `Una regla de Odoo lo impide: ${corto}`;
  }

  // Modelo inexistente: la app que lo define no está instalada en esta base.
  if (/doesn't exist|KeyError/i.test(`${nombre} ${detalle}`)) {
    return `Odoo no conoce ese modelo: lo más probable es que la app que lo trae no esté instalada en esta base. ${corto}`;
  }

  return `Odoo respondió con un error${nombre ? ` (${nombre})` : ""}: ${corto || "sin detalle"}`;
}
