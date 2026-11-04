import { describe, expect, it } from "vitest";
import { baseEnMemoria } from "./baseEnMemoria.testhelper";
import { elegirElDuenoDeLaOT } from "./duenoDeLaOT";
import { CASILLA_DE_MANTENIMIENTO } from "./evento";

describe("elegirElDuenoDeLaOT: el mismo dueño para el modal y para la ruta", () => {
  it("con created_by, es el correo de quien la generó", async () => {
    const { cliente } = baseEnMemoria({ usuarios: [{ id: "u1", email: "Soporte.Mantenimiento@polcecal.com" }] });
    expect(await elegirElDuenoDeLaOT(cliente, "u1")).toEqual({
      ok: true, id: "u1", casilla: "soporte.mantenimiento@polcecal.com", delArea: false,
    });
  });

  it("sin created_by, es mantenimiento@ y no lee nada", async () => {
    const { cliente } = baseEnMemoria({ usuarios: [] }, { falla: { usuarios: { select: "no se debería leer" } } });
    expect(await elegirElDuenoDeLaOT(cliente, null)).toEqual({
      ok: true, id: null, casilla: CASILLA_DE_MANTENIMIENTO, delArea: true,
    });
  });

  it("con created_by de un usuario que ya no existe, también cae en mantenimiento@", async () => {
    const { cliente } = baseEnMemoria({ usuarios: [] });
    expect(await elegirElDuenoDeLaOT(cliente, "borrado")).toMatchObject({ ok: true, delArea: true });
  });

  it("si la lectura falla lo dice, con lo que contestó la base", async () => {
    const { cliente } = baseEnMemoria({ usuarios: [] }, { falla: { usuarios: { select: "boom" } } });
    const r = await elegirElDuenoDeLaOT(cliente, "u1");
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain("boom");
  });
});
