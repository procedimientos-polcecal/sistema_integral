import { describe, it, expect, vi, afterEach } from "vitest";
import { enviarCorreo } from "./correo";

/**
 * Un solo test, y es el que protege el día del deploy.
 *
 * Entre que esto se despliega y el día que alguien publique el Apps Script va
 * a pasar tiempo — igual que con las migraciones, que las aplica una persona.
 * En ese rato las dos variables no existen, y lo que no puede pasar es que
 * cada carga rechazada intente salir a la red o deje un error en los registros
 * todos los días.
 *
 * El resto del archivo no lleva tests: es una llamada HTTP sin decisiones,
 * igual que `enviarPush`.
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

    expect(resultado).toBe("sin-configurar");
    expect(fetchDoble).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
