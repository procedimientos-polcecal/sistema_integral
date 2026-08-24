import { describe, it, expect } from "vitest";
import { mensajeDeGoogle } from "./google";

/**
 * Google contesta con un JSON largo que en pantalla no dice nada útil. Lo que
 * hace falta saber es qué hay que ir a tocar, que casi siempre es una de tres
 * cosas: habilitar la API, compartir la carpeta, o corregir el ID.
 */
const API_DESHABILITADA = JSON.stringify({
  error: {
    code: 403,
    message:
      "Google Drive API has not been used in project 214093608907 before or it is disabled.",
    errors: [{ message: "…", domain: "usageLimits", reason: "accessNotConfigured" }],
    status: "PERMISSION_DENIED",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
        reason: "SERVICE_DISABLED",
        domain: "googleapis.com",
        metadata: {
          serviceTitle: "Google Drive API",
          activationUrl:
            "https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=214093608907",
        },
      },
    ],
  },
});

describe("errores de Google, traducidos", () => {
  it("una API sin habilitar dice qué habilitar y dónde", () => {
    const m = mensajeDeGoogle(403, API_DESHABILITADA);
    expect(m).toContain("Google Drive API");
    expect(m).toContain("no está habilitada");
    expect(m).toContain(
      "https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=214093608907"
    );
    // Lo que no tiene que pasar: escupir el JSON crudo.
    expect(m).not.toContain("@type");
    expect(m.length).toBeLessThan(400);
  });

  it("un 403 sin más datos apunta a lo más probable: la carpeta sin compartir", () => {
    const m = mensajeDeGoogle(403, JSON.stringify({ error: { message: "Insufficient permission" } }));
    expect(m).toContain("compartida");
    expect(m).toContain("editor");
  });

  it("nombra la cuenta de servicio cuando se la pasan", () => {
    const m = mensajeDeGoogle(403, JSON.stringify({ error: { message: "x" } }), "bot@proyecto.iam.gserviceaccount.com");
    expect(m).toContain("bot@proyecto.iam.gserviceaccount.com");
  });

  it("un 404 manda a revisar el ID", () => {
    const m = mensajeDeGoogle(404, JSON.stringify({ error: { message: "File not found: abc" } }));
    expect(m).toContain("no encuentra");
    expect(m).toContain("ID");
  });

  it("lo que no reconoce lo pasa igual, sin tragarse el error", () => {
    const m = mensajeDeGoogle(500, JSON.stringify({ error: { message: "Backend error" } }));
    expect(m).toContain("500");
    expect(m).toContain("Backend error");
  });

  it("aguanta una respuesta que no sea JSON", () => {
    const m = mensajeDeGoogle(502, "<html>Bad Gateway</html>");
    expect(m).toContain("502");
  });
});
