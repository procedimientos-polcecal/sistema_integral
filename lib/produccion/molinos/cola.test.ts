import { describe, it, expect } from "vitest";
import type { TurnoDeRobot } from "./turnos";
import type { EstadoDeTurno, TurnoDeMolino } from "./types";
import { minutosDeParada, turnosSinExplicar } from "./cola";
import { AltaDeParada, BajaDeParada, EdicionDeParada } from "./paradas";
import { validar } from "@/lib/core/validar";

function turno(
  o: { fecha?: string; turno?: TurnoDeMolino; marcha?: number; teorica?: number; estado?: EstadoDeTurno } = {},
): TurnoDeRobot {
  const estado = o.estado ?? "normal";
  const teorica = o.teorica ?? 480;
  return {
    fecha: o.fecha ?? "2026-10-12",
    turno: o.turno ?? "04_12",
    kg: estado === "huerfano" ? 0 : 10_000,
    minutosMarcha: estado === "huerfano" ? 0 : (o.marcha ?? 0),
    minutosTeoricos: estado === "huerfano" ? 0 : teorica,
    estado,
    porMaterial: {},
  };
}

const losCuatroDelDia: TurnoDeRobot[] = (["00_04", "04_12", "12_20", "20_00"] as const).map((t) =>
  turno({ turno: t, marcha: 0, teorica: t === "04_12" || t === "12_20" ? 480 : 240 }),
);

describe("turnosSinExplicar", () => {
  it("pide motivo recien a partir del umbral", () => {
    expect(turnosSinExplicar([turno({ marcha: 239, teorica: 240 })], [], 5, "2026-01-01")).toHaveLength(0);
  });

  it("el umbral exacto ya pide motivo: 4 minutos no, 5 si", () => {
    expect(turnosSinExplicar([turno({ marcha: 236, teorica: 240 })], [], 5, "2026-01-01")).toHaveLength(0);
    expect(turnosSinExplicar([turno({ marcha: 235, teorica: 240 })], [], 5, "2026-01-01")).toHaveLength(1);
  });

  it("el umbral es el que llega, no un 5 fijo", () => {
    const t = [turno({ marcha: 225, teorica: 240 })]; // 15 min de parada
    expect(turnosSinExplicar(t, [], 15, "2026-01-01")).toHaveLength(1);
    expect(turnosSinExplicar(t, [], 16, "2026-01-01")).toHaveLength(0);
  });

  it("no pide motivo antes de la puesta en servicio", () => {
    const t = [turno({ fecha: "2026-03-01", marcha: 0, teorica: 480 })];
    expect(turnosSinExplicar(t, [], 5, "2026-10-29")).toHaveLength(0);
  });

  it("el mismo dia de la puesta en servicio ya cuenta", () => {
    const t = [turno({ fecha: "2026-10-29", marcha: 0, teorica: 480 })];
    expect(turnosSinExplicar(t, [], 5, "2026-10-29")).toHaveLength(1);
  });

  it("una parada marcada a nivel dia tapa los cuatro turnos", () => {
    const r = turnosSinExplicar(losCuatroDelDia, [{ fecha: "2026-10-12", turno: null }], 5, "2026-01-01");
    expect(r).toHaveLength(0);
  });

  it("sin esa parada, los cuatro turnos del dia estan en la cola", () => {
    expect(turnosSinExplicar(losCuatroDelDia, [], 5, "2026-01-01")).toHaveLength(4);
  });

  it("una parada de dia entero tapa solo ese dia", () => {
    const manana = turno({ fecha: "2026-10-13", marcha: 0 });
    const r = turnosSinExplicar([...losCuatroDelDia, manana], [{ fecha: "2026-10-12", turno: null }], 5, "2026-01-01");
    expect(r).toEqual([manana]);
  });

  it("una parada propia tapa ese turno y no los otros tres", () => {
    const r = turnosSinExplicar(losCuatroDelDia, [{ fecha: "2026-10-12", turno: "04_12" }], 5, "2026-01-01");
    expect(r.map((t) => t.turno)).toEqual(["00_04", "12_20", "20_00"]);
  });

  it("una parada propia de otro dia no tapa nada", () => {
    const r = turnosSinExplicar([turno({ turno: "04_12" })], [{ fecha: "2026-10-11", turno: "04_12" }], 5, "2026-01-01");
    expect(r).toHaveLength(1);
  });

  it("un turno huerfano no entra en la cola", () => {
    expect(turnosSinExplicar([turno({ estado: "huerfano" })], [], 5, "2026-01-01")).toHaveLength(0);
  });

  it("el huerfano lo decide su estado y no sus ceros: aunque trajera teorica, no es una parada", () => {
    // `armarTurnos` hoy lo guarda con teorica 0, y por eso su parada ya da 0.
    // Si algun dia se guarda con la teorica del bloque, la regla tiene que seguir en pie.
    const h: TurnoDeRobot = { ...turno({ estado: "huerfano" }), minutosTeoricos: 480, minutosMarcha: 0 };
    expect(turnosSinExplicar([h], [], 5, "2026-01-01")).toHaveLength(0);
  });

  it("un inconsistente no entra: su marcha excede la teorica y no hay parada que explicar", () => {
    const t = turno({ estado: "inconsistente", marcha: 258, teorica: 240 });
    expect(turnosSinExplicar([t], [], 5, "2026-01-01")).toHaveLength(0);
  });

  it("un acumulado se mide contra su teorica de racha, no contra la de un turno", () => {
    // 480 de marcha sobre una racha teorica de 720: faltan 240 min.
    const t = turno({ estado: "acumulado", marcha: 480, teorica: 720 });
    expect(turnosSinExplicar([t], [], 5, "2026-01-01")).toEqual([t]);
  });

  it("conserva el orden en que llegan", () => {
    const a = turno({ fecha: "2026-10-12", turno: "20_00", marcha: 0, teorica: 240 });
    const b = turno({ fecha: "2026-10-13", turno: "00_04", marcha: 0, teorica: 240 });
    expect(turnosSinExplicar([a, b], [], 5, "2026-01-01")).toEqual([a, b]);
  });
});

describe("minutosDeParada", () => {
  it("es lo que le falto a la marcha, y negativo si se paso", () => {
    expect(minutosDeParada({ minutosMarcha: 200, minutosTeoricos: 240 })).toBe(40);
    expect(minutosDeParada({ minutosMarcha: 250, minutosTeoricos: 240 })).toBe(-10);
  });
});

const UUID = "de32b113-b233-461a-882f-7a56160bb3d9";

describe("el cuerpo del alta", () => {
  const ok = { molino_id: UUID, fecha: "2026-10-12", turno: "04_12", motivo: "Cambio de martillos" };

  it("un alta correcta pasa y el motivo sale sin espacios sobrantes", () => {
    const r = validar(AltaDeParada, { ...ok, motivo: "  Cambio de martillos  " });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.datos.motivo).toBe("Cambio de martillos");
  });

  it("turno null es la planta parada y pasa", () => {
    expect(validar(AltaDeParada, { ...ok, turno: null }).ok).toBe(true);
  });

  it("un turno que no viene no es lo mismo que el dia entero", () => {
    const { turno: _omitido, ...sinTurno } = ok;
    void _omitido;
    const r = validar(AltaDeParada, sinTurno);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problemas).toEqual(["turno tiene que ser uno de: 00_04, 04_12, 12_20, 20_00."]);
  });

  it("informa todos los problemas juntos y en castellano", () => {
    const r = validar(AltaDeParada, { molino_id: "x", fecha: "2026-02-31", turno: "99", motivo: "   " });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problemas).toHaveLength(4);
      expect(r.problemas.join(" ")).toContain("Falta el motivo de la parada.");
      expect(r.problemas.join(" ")).toContain("La fecha tiene que existir");
    }
  });

  it("una OT que no es un identificador se rechaza, y una ausente no se confunde con null", () => {
    expect(validar(AltaDeParada, { ...ok, orden_trabajo_id: "2929" }).ok).toBe(false);
    const sin = validar(AltaDeParada, ok);
    const nula = validar(AltaDeParada, { ...ok, orden_trabajo_id: null });
    expect(sin.ok && "orden_trabajo_id" in sin.datos).toBe(false);
    expect(nula.ok && nula.datos.orden_trabajo_id).toBeNull();
  });
});

describe("el cuerpo de la edicion y de la baja", () => {
  it("pide el id y el motivo", () => {
    const r = validar(EdicionDeParada, {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problemas).toEqual(["Falta id.", "Falta motivo."]);
  });
  it("la baja pide solo el id", () => {
    expect(validar(BajaDeParada, { id: UUID }).ok).toBe(true);
    expect(validar(BajaDeParada, {}).ok).toBe(false);
  });
});
