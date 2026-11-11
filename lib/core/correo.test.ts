import { describe, it, expect, vi, afterEach } from "vitest";
import { enviarCorreo, estaConfigurado } from "./correo";

/**
 * El primer test protege el día del deploy.
 *
 * Entre que esto se despliega y el día que alguien publique el Apps Script va
 * a pasar tiempo — igual que con las migraciones, que las aplica una persona.
 * En ese rato las dos variables no existen, y lo que no puede pasar es que
 * cada carga rechazada intente salir a la red o deje un error en los registros
 * todos los días.
 *
 * El segundo bloque fija lo que `detalle` dice de un fallo (ver el encabezado de
 * `correo.ts`): es lo que la mensajería anota en la mención.
 */
describe("enviarCorreo", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("sin las variables configuradas no intenta nada y no loguea", async () => {
    vi.stubEnv("SDG_CORREO_URL", "");
    vi.stubEnv("SDG_CORREO_SECRET", "");
    const fetchDoble = vi.fn();
    vi.stubGlobal("fetch", fetchDoble);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const resultado = await enviarCorreo({
      para: "alguien@polcecal.com",
      asunto: "x",
      cuerpo: "y",
    });

    expect(resultado).toEqual({ estado: "sin-configurar" });
    expect(fetchDoble).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});

describe("enviarCorreo, con el script configurado", () => {
  const correo = { para: "alguien@polcecal.com", asunto: "x", cuerpo: "y" };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  function conScript(respuesta: () => Promise<Response>) {
    vi.stubEnv("SDG_CORREO_URL", "https://script.google.com/macros/s/x/exec");
    vi.stubEnv("SDG_CORREO_SECRET", "abc");
    vi.stubGlobal("fetch", vi.fn(respuesta));
    vi.spyOn(console, "error").mockImplementation(() => {});
  }

  it("si el script dice ok, está enviado y no hay detalle", async () => {
    conScript(async () => new Response(JSON.stringify({ ok: true })));
    expect(await enviarCorreo(correo)).toEqual({ estado: "enviado" });
  });

  it("si el script lo rechaza, el detalle es lo que contestó, sin traducir", async () => {
    // Un Apps Script contesta 200 aunque rechace: el motivo está en el cuerpo.
    const dijo = JSON.stringify({ ok: false, error: "dominio no permitido: gmail.com" });
    conScript(async () => new Response(dijo, { status: 200 }));
    expect(await enviarCorreo(correo)).toEqual({ estado: "fallo", detalle: dijo });
  });

  it("si contesta algo que no es su JSON, el detalle es ese texto", async () => {
    conScript(async () => new Response("<html>Iniciar sesión</html>"));
    expect(await enviarCorreo(correo)).toEqual({
      estado: "fallo",
      detalle: "<html>Iniciar sesión</html>",
    });
  });

  it("si contesta con el cuerpo vacío, el detalle al menos lleva el status", async () => {
    conScript(async () => new Response("", { status: 502 }));
    expect(await enviarCorreo(correo)).toEqual({
      estado: "fallo",
      detalle: "HTTP 502, sin cuerpo",
    });
  });

  it("si ni siquiera contesta, el detalle es el mensaje de la excepción", async () => {
    conScript(async () => { throw new Error("the operation was aborted due to timeout"); });
    expect(await enviarCorreo(correo)).toEqual({
      estado: "fallo",
      detalle: "the operation was aborted due to timeout",
    });
  });
});

/*
 * Se pregunta **antes** de buscar a quién mandarle. Sin esto, cada carga
 * rechazada hace una consulta a `usuarios` con el cliente admin para después
 * tirar el resultado, durante todo el tiempo que pase hasta que alguien
 * publique el Apps Script — que se espera largo.
 */
describe("estaConfigurado", () => {
  it("con las dos variables, sí", () => {
    vi.stubEnv("SDG_CORREO_URL", "https://script.google.com/macros/s/x/exec");
    vi.stubEnv("SDG_CORREO_SECRET", "abc");
    expect(estaConfigurado()).toBe(true);
  });

  it("con una sola, no: van juntas o no van", () => {
    vi.stubEnv("SDG_CORREO_URL", "https://script.google.com/macros/s/x/exec");
    vi.stubEnv("SDG_CORREO_SECRET", "");
    expect(estaConfigurado()).toBe(false);
  });

  it("sin ninguna, no", () => {
    vi.stubEnv("SDG_CORREO_URL", "");
    vi.stubEnv("SDG_CORREO_SECRET", "");
    expect(estaConfigurado()).toBe(false);
  });
});
