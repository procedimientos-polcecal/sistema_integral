/**
 * Autenticación con Google, compartida por los módulos que hablan con Sheets y
 * Drive —hoy Compras y Mantenimiento—.
 *
 * Es un JWT firmado a mano en vez de la librería `googleapis`: son 40 líneas,
 * no arrastra dependencias y funciona igual en el runtime de Vercel.
 *
 * Es una sola cuenta de servicio para todo: necesita permiso sobre cada
 * planilla y carpeta que se quiera leer, y de EDITOR sobre las que se escriben.
 */

export const SCOPE_SHEETS = "https://www.googleapis.com/auth/spreadsheets";
export const SCOPE_SHEETS_LECTURA = "https://www.googleapis.com/auth/spreadsheets.readonly";
export const SCOPE_DRIVE_LECTURA = "https://www.googleapis.com/auth/drive.readonly";
/*
 * Escritura en Drive: sólo sirve contra una UNIDAD COMPARTIDA.
 *
 * Una cuenta de servicio **no tiene cuota de Drive**: aunque la carpeta esté
 * compartida como editor, subir un archivo a "Mi unidad" de alguien falla con
 * "Service Accounts do not have storage quota". En una unidad compartida el
 * dueño de los archivos es la unidad y no quien sube, así que ahí sí funciona
 * —hay que pasar `supportsAllDrives=true` en la llamada—.
 *
 * Por eso las fotos de Mantenimiento van a Supabase Storage y no a Drive. El
 * único que usa este scope es el backup de la base, que sube a una unidad
 * compartida a propósito.
 */
export const SCOPE_DRIVE = "https://www.googleapis.com/auth/drive";

export function hayCredencialesGoogle(): boolean {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
}

/**
 * Los tokens que ya se pidieron, por juego de scopes.
 *
 * POR QUÉ HACE FALTA
 *
 * Pedir un token no es gratis: se firma un JWT con RSA y se hace un viaje a
 * `oauth2.googleapis.com`. Y se pedía **uno por llamada**: hay 21 lugares que
 * llaman a `obtenerToken`, y `lib/core/sheets.ts` y `lib/compras/drive.ts` lo
 * hacían en cada función, así que escribir cinco celdas eran cinco autentica-
 * ciones antes de las cinco escrituras. Con ~13 escrituras por RI, eso es la
 * mitad de la latencia de la sincronización y una buena parte de los 429.
 *
 * `lib/compras/sheets.ts` ya hacía lo correcto —lo pide una vez y lo pasa hacia
 * abajo—; esto lleva ese comportamiento a todos los demás sin tocarlos.
 *
 * QUÉ TIENE DE SEGURO
 *
 * El caché vive en memoria del proceso, o sea de una instancia de función de
 * Vercel: no cruza usuarios —el token es de la cuenta de servicio, el mismo
 * para todos— ni sobrevive a un redeploy. Se guarda por juego de scopes,
 * porque un token de `spreadsheets.readonly` no sirve para escribir.
 *
 * Se descarta un minuto antes de que Google lo venza: si se apurara justo en el
 * borde, la llamada volvería con un 401 que nadie sabría leer.
 */
const MARGEN_SEGUNDOS = 60;
const tokensEnMemoria = new Map<string, { token: string; vence: number }>();

export async function obtenerToken(scopes: string[]): Promise<string> {
  const crudo = process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "";
  if (!crudo) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON no configurado");

  const ahora = Math.floor(Date.now() / 1000);

  // Ordenados: pedir [SHEETS, DRIVE] y [DRIVE, SHEETS] es lo mismo y tiene que
  // dar en la misma entrada.
  const claveDeCache = [...scopes].sort().join(" ");
  const guardado = tokensEnMemoria.get(claveDeCache);
  if (guardado && guardado.vence > ahora + MARGEN_SEGUNDOS) return guardado.token;

  const cuenta = JSON.parse(crudo);
  const carga = {
    iss: cuenta.client_email,
    scope: scopes.join(" "),
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

  // `expires_in` viene en segundos y son 3600, pero se usa lo que diga Google
  // en vez de dar por sentado el número. Si no lo manda, se asume una hora.
  const dura = Number(datos.expires_in);
  tokensEnMemoria.set(claveDeCache, {
    token: datos.access_token,
    vence: ahora + (isFinite(dura) && dura > 0 ? dura : 3600),
  });

  return datos.access_token;
}

/**
 * Vacía el caché de tokens. Sólo para los tests: en producción no hace falta
 * —un token vencido se descarta solo— y llamarla no rompe nada.
 */
export function olvidarLosTokens(): void {
  tokensEnMemoria.clear();
}

// ── Errores ──────────────────────────────────────────────────

interface ErrorDeGoogle {
  code?: number;
  message?: string;
  errors?: { reason?: string }[];
  details?: {
    reason?: string;
    metadata?: { serviceTitle?: string; activationUrl?: string };
  }[];
}

/**
 * Traduce un error de Google a algo accionable.
 *
 * La API contesta con un JSON de treinta líneas que en pantalla no dice nada:
 * quien lo lee necesita saber qué ir a tocar, y casi siempre es una de tres
 * cosas —habilitar la API, compartir la carpeta, o corregir el ID—.
 */
export function mensajeDeGoogle(
  estado: number,
  cuerpo: string,
  cuentaDeServicio?: string
): string {
  let error: ErrorDeGoogle = {};
  try {
    error = (JSON.parse(cuerpo)?.error ?? {}) as ErrorDeGoogle;
  } catch {
    // Hay respuestas que ni siquiera son JSON (un 502 del proxy, por ejemplo).
  }

  const razones = new Set<string>();
  for (const e of error.errors ?? []) if (e.reason) razones.add(e.reason);
  for (const d of error.details ?? []) if (d.reason) razones.add(d.reason);

  if (razones.has("SERVICE_DISABLED") || razones.has("accessNotConfigured")) {
    const detalle = (error.details ?? []).find((d) => d.metadata?.activationUrl);
    const api = detalle?.metadata?.serviceTitle ?? "La API de Google";
    const url = detalle?.metadata?.activationUrl;

    return (
      `${api} no está habilitada en el proyecto de Google Cloud. ` +
      (url ? `Habilitala acá y esperá unos minutos a que propague: ${url}` : "Hay que habilitarla en la consola de Google Cloud.")
    );
  }

  if (estado === 403) {
    const quien = cuentaDeServicio ? `la cuenta de servicio ${cuentaDeServicio}` : "la cuenta de servicio";
    return `Google no dio acceso: lo más probable es que la carpeta no esté compartida con ${quien} como editor. (${error.message ?? estado})`;
  }

  if (estado === 404) {
    return `Google no encuentra ese archivo o carpeta: conviene revisar el ID configurado. (${error.message ?? estado})`;
  }

  return `Google respondió ${estado}: ${error.message ?? cuerpo.slice(0, 200)}`;
}

/**
 * El mail de la cuenta de servicio, para poder nombrarlo en los avisos.
 *
 * Se muestra en Configuración de Compras, y no es un dato de adorno: los rangos
 * protegidos de la planilla listan qué cuentas pueden editarlos, y si la que
 * figura ahí no es ésta, las escrituras vuelven rechazadas sin que se pueda
 * saber por qué mirando la planilla. Pasó: se revisaron 946 protecciones que
 * daban permiso a una cuenta distinta de la que escribe.
 *
 * El `client_email` no es secreto —es justamente el identificador que hay que
 * compartir para dar permiso—, a diferencia de la clave privada del mismo JSON.
 */
export function cuentaDeServicio(): string | undefined {
  try {
    return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "{}").client_email;
  } catch {
    return undefined;
  }
}
