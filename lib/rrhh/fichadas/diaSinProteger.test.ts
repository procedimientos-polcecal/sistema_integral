import { describe, it, expect } from "vitest";
import { traeDiaSinProteger } from "./diaSinProteger";

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });

describe("traeDiaSinProteger", () => {
  it("lo detecta en el POST (201), el PUT (200) y el DELETE con aviso (200)", async () => {
    expect(await traeDiaSinProteger(json({ id: "1", diaSinProteger: true }, 201))).toBe(true);
    expect(await traeDiaSinProteger(json({ id: "1", diaSinProteger: true }))).toBe(true);
    expect(await traeDiaSinProteger(json({ diaSinProteger: true }))).toBe(true);
  });

  it("no lo inventa cuando el campo no viaja", async () => {
    expect(await traeDiaSinProteger(json({ id: "1" }, 201))).toBe(false);
    expect(await traeDiaSinProteger(json({ id: "1", diaSinProteger: false }))).toBe(false);
  });

  it("un 204 del DELETE no tiene cuerpo y no es un problema", async () => {
    expect(await traeDiaSinProteger(new Response(null, { status: 204 }))).toBe(false);
  });

  it("una respuesta que no es JSON no lo rompe", async () => {
    expect(await traeDiaSinProteger(new Response("<html>502</html>", { status: 502 }))).toBe(false);
  });

  it("deja el cuerpo legible para quien la llamó", async () => {
    const res = json({ error: "algo" }, 500);
    await traeDiaSinProteger(res);
    expect(await res.json()).toEqual({ error: "algo" });
  });
});
