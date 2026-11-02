import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { obtenerToken, olvidarLosTokens, SCOPE_CALENDAR, SCOPE_SHEETS, SCOPE_SHEETS_LECTURA } from "./google";

/**
 * El caché de tokens.
 *
 * Se pedía uno por llamada: escribir cinco celdas eran cinco firmas RSA y cinco
 * viajes a `oauth2.googleapis.com` antes de las cinco escrituras. Estos casos
 * fijan que sea uno por juego de scopes mientras dure.
 *
 * La cuenta de servicio es de mentira pero tiene que ser una clave RSA de
 * verdad: `crypto.subtle.importKey` valida el PKCS#8 antes de firmar.
 */
const { privateKey } = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  true,
  ["sign", "verify"]
);
const pkcs8 = Buffer.from(await crypto.subtle.exportKey("pkcs8", privateKey)).toString("base64");

const CUENTA = JSON.stringify({
  client_email: "prueba@ejemplo.iam.gserviceaccount.com",
  private_key: `-----BEGIN PRIVATE KEY-----\n${pkcs8}\n-----END PRIVATE KEY-----\n`,
});

let pedidos = 0;
// El cuerpo de cada POST a oauth2.googleapis.com, para poder leer el JWT que viajó.
let cuerpos: string[] = [];

/** El payload del JWT (`cabecera.payload.firma`, en base64url) del pedido `n`. */
function cargaDelPedido(n: number): Record<string, unknown> {
  const assertion = new URLSearchParams(cuerpos[n]).get("assertion") ?? "";
  return JSON.parse(Buffer.from(assertion.split(".")[1], "base64url").toString());
}

beforeEach(() => {
  pedidos = 0;
  cuerpos = [];
  olvidarLosTokens();
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = CUENTA;
  vi.stubGlobal("fetch", async (_url: unknown, init?: { body?: unknown }) => {
    pedidos++;
    cuerpos.push(String(init?.body ?? ""));
    return new Response(
      JSON.stringify({ access_token: `token-${pedidos}`, expires_in: 3600 }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  olvidarLosTokens();
  delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
});

describe("obtenerToken", () => {
  it("pide uno solo y lo reusa mientras dure", async () => {
    expect(await obtenerToken([SCOPE_SHEETS])).toBe("token-1");
    expect(await obtenerToken([SCOPE_SHEETS])).toBe("token-1");
    expect(await obtenerToken([SCOPE_SHEETS])).toBe("token-1");
    expect(pedidos).toBe(1);
  });

  /**
   * Un token de `spreadsheets.readonly` no sirve para escribir: cada juego de
   * scopes tiene su entrada, o la escritura volvería con un 403.
   */
  it("cada juego de scopes tiene el suyo", async () => {
    await obtenerToken([SCOPE_SHEETS]);
    await obtenerToken([SCOPE_SHEETS_LECTURA]);
    expect(pedidos).toBe(2);

    await obtenerToken([SCOPE_SHEETS]);
    expect(pedidos).toBe(2);
  });

  it("el orden de los scopes no abre una entrada nueva", async () => {
    await obtenerToken([SCOPE_SHEETS, SCOPE_SHEETS_LECTURA]);
    await obtenerToken([SCOPE_SHEETS_LECTURA, SCOPE_SHEETS]);
    expect(pedidos).toBe(1);
  });

  /**
   * Con impersonación el token ya no es el mismo para todos: es el de esa
   * casilla. Si el caché ignorara a quién se impersona, a un usuario se le
   * entregaría el token de otro y la escritura iría al calendario equivocado
   * sin ningún error.
   */
  it("dos casillas distintas no comparten el token", async () => {
    await obtenerToken([SCOPE_CALENDAR], "a@polcecal.com");
    await obtenerToken([SCOPE_CALENDAR], "b@polcecal.com");
    expect(pedidos).toBe(2);
  });

  it("la misma casilla reusa el suyo", async () => {
    await obtenerToken([SCOPE_CALENDAR], "a@polcecal.com");
    await obtenerToken([SCOPE_CALENDAR], "a@polcecal.com");
    expect(pedidos).toBe(1);
  });

  it("impersonar y no impersonar son entradas distintas", async () => {
    await obtenerToken([SCOPE_CALENDAR]);
    await obtenerToken([SCOPE_CALENDAR], "a@polcecal.com");
    expect(pedidos).toBe(2);
  });

  /**
   * Los tres casos de arriba prueban que las claves del caché son distintas, no
   * que el JWT impersone: si `sub` no llegara al payload seguirían en verde y la
   * Agenda escribiría en el calendario de la cuenta de servicio, con el síntoma
   * —"los eventos no le aparecen a nadie"— lejos de la causa. Éste lee el JWT
   * que de verdad viajó a Google.
   */
  it("con comoQuien el JWT lleva sub, y sin él no", async () => {
    await obtenerToken([SCOPE_CALENDAR], "a@polcecal.com");
    await obtenerToken([SCOPE_CALENDAR]);

    expect(cargaDelPedido(0).sub).toBe("a@polcecal.com");

    // Sin la clave `sub` —no vacía— es lo que deja igual a los 21 llamadores
    // que no impersonan.
    expect("sub" in cargaDelPedido(1)).toBe(false);
  });

  /** Uno que ya vencio no se reusa: se pide de nuevo. */
  it("vuelve a pedirlo cuando vence", async () => {
    vi.stubGlobal("fetch", async () => {
      pedidos++;
      return new Response(
        JSON.stringify({ access_token: `token-${pedidos}`, expires_in: 1 }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    expect(await obtenerToken([SCOPE_SHEETS])).toBe("token-1");
    // Con `expires_in: 1` ya esta dentro del margen de un minuto: no se reusa.
    expect(await obtenerToken([SCOPE_SHEETS])).toBe("token-2");
    expect(pedidos).toBe(2);
  });

  it("sin credenciales no inventa un token", async () => {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    await expect(obtenerToken([SCOPE_SHEETS])).rejects.toThrow(/no configurado/);
  });

  /** Un error de OAuth no se guarda: el proximo intento tiene que reintentar. */
  it("un rechazo de Google no queda cacheado", async () => {
    vi.stubGlobal("fetch", async () => {
      pedidos++;
      return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
    });

    await expect(obtenerToken([SCOPE_SHEETS])).rejects.toThrow(/Google OAuth/);
    await expect(obtenerToken([SCOPE_SHEETS])).rejects.toThrow(/Google OAuth/);
    expect(pedidos).toBe(2);
  });
});
