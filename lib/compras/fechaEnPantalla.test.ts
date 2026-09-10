import { describe, it, expect } from "vitest";
import { fecha, fechaHora } from "./constants";

/**
 * El dia que se ve tiene que ser el dia que fue.
 *
 * Los RI traidos de la planilla se guardan con la fecha a medianoche UTC —
 * `fechaISO` devuelve "2026-09-10" y Postgres lo guarda como
 * 2026-09-10T00:00:00+00 en una columna timestamptz—. Formatear eso como
 * instante los mostraba un dia antes, porque medianoche UTC son las 21 del dia
 * anterior en Argentina: los 1.958 requerimientos aparecian con la fecha de
 * ayer. Lo reporto el usuario con el RI 1958, cargado el 10/9 y mostrado como
 * 09/09/2026.
 *
 * Los tests corren con TZ=America/Argentina/Buenos_Aires puesto en el propio
 * archivo: sin fijarla, pasarian o fallarian segun donde corran, que es
 * exactamente el error que se esta arreglando.
 */
process.env.TZ = "America/Argentina/Buenos_Aires";

describe("la fecha como se muestra", () => {
  it("una fecha de calendario guardada a medianoche UTC no se corre un dia", () => {
    expect(fecha("2026-09-10T00:00:00+00:00")).toBe("10/09/2026");
    expect(fecha("2026-09-10T00:00:00Z")).toBe("10/09/2026");
    expect(fecha("2026-09-10T00:00:00.000Z")).toBe("10/09/2026");
  });

  it("una columna date sin hora tampoco", () => {
    // new Date("2026-09-11") es medianoche UTC: en Argentina ya es el 10.
    expect(fecha("2026-09-11")).toBe("11/09/2026");
  });

  it("un instante de verdad se muestra en hora local, que es la que se vivio", () => {
    // 14:40 UTC son las 11:40 de aca: el mismo dia.
    expect(fecha("2026-09-10T14:40:56.398704+00:00")).toBe("10/09/2026");
    // Y 01:30 UTC son las 22:30 del dia anterior: ahi el dia local es el 9, y
    // corresponde, porque quien lo cargo lo cargo un martes a la noche.
    expect(fecha("2026-09-10T01:30:00Z")).toBe("09/09/2026");
  });

  it("sin valor y con basura no inventa una fecha", () => {
    expect(fecha(null)).toBe("—");
    expect(fecha("")).toBe("—");
    expect(fecha("cualquier cosa")).toBe("—");
  });

  it("fechaHora sigue mostrando el instante completo en hora local", () => {
    // No se toca: ahi la hora es el dato, no un artefacto de como se guardo.
    expect(fechaHora("2026-09-10T14:40:00Z")).toContain("10/09/2026");
    expect(fechaHora("2026-09-10T14:40:00Z")).toMatch(/11:40/);
  });
});
