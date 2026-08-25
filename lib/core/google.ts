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

export function hayCredencialesGoogle(): boolean {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
}

export async function obtenerToken(scopes: string[]): Promise<string> {
  const crudo = process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "";
  if (!crudo) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON no configurado");

  const cuenta = JSON.parse(crudo);
  const ahora = Math.floor(Date.now() / 1000);
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
  return datos.access_token;
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

/** El mail de la cuenta de servicio, para poder nombrarlo en los avisos. */
export function cuentaDeServicio(): string | undefined {
  try {
    return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "{}").client_email;
  } catch {
    return undefined;
  }
}
