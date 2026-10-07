import { describe, it, expect } from "vitest";
import { agruparPorLegajo } from "./agrupar";
import { toUtcDateOnly } from "../dates";
import type { MarcacionLenox } from "./tipos";

function dia(y: number, m: number, d: number) {
  return toUtcDateOnly(y, m - 1, d);
}

function marca(legajo: string, fecha: string, hora: string): MarcacionLenox {
  return {
    nombre: "A", apellido: "B", legajo,
    marcacion: `${fecha} ${hora}`, marcacionFecha: fecha, marcacionHora: hora,
    tipoMarcacion: "BIOMETRICO", comentario: null, reloj: "Reloj 1",
  };
}

describe("agruparPorLegajo", () => {
  it("agrupa por legajo y por día, y arma los tokens en orden de hora", () => {
    const porLegajo = agruparPorLegajo(
      [
        marca("PC_204", "2026-10-02", "16:03:00"),
        marca("PC_204", "2026-10-02", "07:58:00"),
        marca("PS_010", "2026-10-02", "06:00:00"),
      ],
      dia(2026, 10, 2),
      dia(2026, 10, 2)
    );

    expect([...porLegajo.keys()].sort()).toEqual(["PC_204", "PS_010"]);
    expect(porLegajo.get("PC_204")).toEqual([
      { fecha: dia(2026, 10, 2), tokens: [{ tipo: "E", hora: "07:58" }, { tipo: "S", hora: "16:03" }] },
    ]);
  });

  it("alterna E/S por posición: la letra la pone el agrupador, no Lenox", () => {
    const porLegajo = agruparPorLegajo(
      [
        marca("PC_001", "2026-10-02", "08:00:00"),
        marca("PC_001", "2026-10-02", "12:00:00"),
        marca("PC_001", "2026-10-02", "13:00:00"),
        marca("PC_001", "2026-10-02", "17:00:00"),
      ],
      dia(2026, 10, 2),
      dia(2026, 10, 2)
    );
    expect(porLegajo.get("PC_001")![0].tokens.map((t) => t.tipo)).toEqual(["E", "S", "E", "S"]);
  });

  it("genera los días del rango que no tienen ninguna marcación", () => {
    const porLegajo = agruparPorLegajo(
      [marca("PC_001", "2026-10-01", "08:00:00"), marca("PC_001", "2026-10-03", "08:00:00")],
      dia(2026, 10, 1),
      dia(2026, 10, 3)
    );
    const dias = porLegajo.get("PC_001")!;
    expect(dias).toHaveLength(3);
    expect(dias[1]).toEqual({ fecha: dia(2026, 10, 2), tokens: [] });
  });

  it("los días salen ordenados ascendente, que es lo que espera reconciliarTokens", () => {
    const porLegajo = agruparPorLegajo(
      [marca("PC_001", "2026-10-03", "08:00:00"), marca("PC_001", "2026-10-01", "08:00:00")],
      dia(2026, 10, 1),
      dia(2026, 10, 3)
    );
    expect(porLegajo.get("PC_001")!.map((d) => d.fecha.getTime())).toEqual([
      dia(2026, 10, 1).getTime(), dia(2026, 10, 2).getTime(), dia(2026, 10, 3).getTime(),
    ]);
  });

  it("descarta una marcación con fecha ilegible en vez de inventarle un día", () => {
    const porLegajo = agruparPorLegajo(
      [{ ...marca("PC_001", "2026-10-01", "08:00:00"), marcacionFecha: "", marcacionHora: "" }],
      dia(2026, 10, 1),
      dia(2026, 10, 1)
    );
    expect(porLegajo.get("PC_001")).toEqual([{ fecha: dia(2026, 10, 1), tokens: [] }]);
  });
});
