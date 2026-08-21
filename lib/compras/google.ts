/**
 * Autenticación con Google para el módulo Compras.
 *
 * Es un JWT firmado a mano en vez de la librería `googleapis`: son 40 líneas,
 * no arrastra dependencias y funciona igual en el runtime de Vercel.
 *
 * La cuenta de servicio necesita permiso de EDITOR sobre la planilla
 * "PEDIDOS DE COMPRA" y sobre la carpeta de comparativas de Drive.
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
