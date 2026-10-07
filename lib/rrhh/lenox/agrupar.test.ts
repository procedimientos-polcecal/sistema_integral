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
    const { porLegajo } = agruparPorLegajo(
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
    const { porLegajo } = agruparPorLegajo(
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
    const { porLegajo } = agruparPorLegajo(
      [marca("PC_001", "2026-10-01", "08:00:00"), marca("PC_001", "2026-10-03", "08:00:00")],
      dia(2026, 10, 1),
      dia(2026, 10, 3)
    );
    const dias = porLegajo.get("PC_001")!;
    expect(dias).toHaveLength(3);
    expect(dias[1]).toEqual({ fecha: dia(2026, 10, 2), tokens: [] });
  });

  it("los días salen ordenados ascendente, que es lo que espera reconciliarTokens", () => {
    const { porLegajo } = agruparPorLegajo(
      [marca("PC_001", "2026-10-03", "08:00:00"), marca("PC_001", "2026-10-01", "08:00:00")],
      dia(2026, 10, 1),
      dia(2026, 10, 3)
    );
    expect(porLegajo.get("PC_001")!.map((d) => d.fecha.getTime())).toEqual([
      dia(2026, 10, 1).getTime(), dia(2026, 10, 2).getTime(), dia(2026, 10, 3).getTime(),
    ]);
  });

  it("una marca ilegible no hace desaparecer a su legajo, que queda con sus días vacíos", () => {
    const { porLegajo } = agruparPorLegajo(
      [{ ...marca("PC_001", "2026-10-01", "08:00:00"), marcacionFecha: "", marcacionHora: "" }],
      dia(2026, 10, 1),
      dia(2026, 10, 1)
    );
    expect(porLegajo.get("PC_001")).toEqual([{ fecha: dia(2026, 10, 1), tokens: [] }]);
  });

  it("normaliza la hora de un dígito a HH:MM: es lo único que defiende el orden del sort() de strings", () => {
    // Sin el padStart, "7:05" ordenaría después de "10:00" y el orden
    // cronológico que exige reconciliarTokens se rompería sin avisar.
    const { porLegajo } = agruparPorLegajo(
      [
        marca("PC_001", "2026-10-02", "16:00:00"),
        marca("PC_001", "2026-10-02", "10:00:00"),
        marca("PC_001", "2026-10-02", "7:05:00"),
      ],
      dia(2026, 10, 2),
      dia(2026, 10, 2)
    );
    expect(porLegajo.get("PC_001")![0].tokens.map((t) => t.hora)).toEqual(["07:05", "10:00", "16:00"]);
  });

  it("descarta una fecha que no existe en vez de moverla al día de al lado", () => {
    // "2026-02-31" se convertía en el 3 de marzo, "2026-13-01" en el 1 de enero de 2027.
    const { porLegajo, descartadas } = agruparPorLegajo(
      [
        marca("PC_001", "2026-02-31", "08:00:00"),
        marca("PC_001", "2026-13-01", "08:00:00"),
      ],
      dia(2026, 2, 1),
      dia(2026, 3, 5)
    );
    expect(porLegajo.get("PC_001")!.every((d) => d.tokens.length === 0)).toBe(true);
    expect(descartadas.fechaIlegible).toBe(2);
  });

  it("descarta una hora que no existe en vez de arrastrarla", () => {
    const { porLegajo, descartadas } = agruparPorLegajo(
      [marca("PC_001", "2026-10-01", "25:99:00"), marca("PC_001", "2026-10-01", "24:00:00")],
      dia(2026, 10, 1),
      dia(2026, 10, 1)
    );
    expect(porLegajo.get("PC_001")).toEqual([{ fecha: dia(2026, 10, 1), tokens: [] }]);
    expect(descartadas.horaIlegible).toBe(2);
  });

  it("cuenta las filas descartadas según el motivo, para que la sincronización no reporte éxito con basura", () => {
    const { descartadas } = agruparPorLegajo(
      [
        marca("PC_001", "2026-10-01", "08:00:00"), // buena
        marca("", "2026-10-01", "08:00:00"), // sin legajo
        marca("   ", "2026-10-01", "09:00:00"), // sin legajo
        marca("PC_001", "ayer", "08:00:00"), // fecha ilegible
        marca("PC_001", "2026-10-01", "mediodía"), // hora ilegible
        { ...marca("PC_001", "", ""), marcacionHora: "" }, // las dos: cuenta como fecha
      ],
      dia(2026, 10, 1),
      dia(2026, 10, 1)
    );
    expect(descartadas).toEqual({ sinLegajo: 2, fechaIlegible: 2, horaIlegible: 1, fueraDeRango: 0 });
  });

  it("una marca fuera del rango se descarta y se cuenta, y su legajo queda con los días vacíos", () => {
    const { porLegajo, descartadas } = agruparPorLegajo(
      [marca("PC_009", "2026-09-15", "08:00:00")],
      dia(2026, 10, 1),
      dia(2026, 10, 2)
    );
    expect(porLegajo.get("PC_009")).toEqual([
      { fecha: dia(2026, 10, 1), tokens: [] },
      { fecha: dia(2026, 10, 2), tokens: [] },
    ]);
    expect(descartadas).toEqual({ sinLegajo: 0, fechaIlegible: 0, horaIlegible: 0, fueraDeRango: 1 });
  });

  it("si todas las marcas caen fuera del rango (desfase de huso) no se carga nada pero se nota", () => {
    // Es el caso que `descartadas` existe para detectar: sin fueraDeRango
    // quedaría todo en cero y la sincronización reportaría éxito sobre nada.
    const marcas = [
      marca("PC_001", "2026-10-09", "08:00:00"),
      marca("PC_001", "2026-10-09", "16:00:00"),
      marca("PC_002", "2026-10-10", "07:00:00"),
    ];
    const { porLegajo, descartadas } = agruparPorLegajo(marcas, dia(2026, 10, 1), dia(2026, 10, 2));
    expect([...porLegajo.values()].every((dias) => dias.every((d) => d.tokens.length === 0))).toBe(true);
    expect(porLegajo.get("PC_001")).toHaveLength(2);
    expect(descartadas.fueraDeRango).toBe(marcas.length);
  });

  it("rechaza una hora con algo pegado detrás en vez de leerla a medias", () => {
    const { descartadas } = agruparPorLegajo(
      [marca("PC_001", "2026-10-01", "07:58 PM"), marca("PC_001", "2026-10-01", "07:581")],
      dia(2026, 10, 1),
      dia(2026, 10, 1)
    );
    expect(descartadas.horaIlegible).toBe(2);
  });

  it("acepta la hora en el límite (23:59), contraparte del 24:00 que se rechaza", () => {
    const { porLegajo } = agruparPorLegajo(
      [marca("PC_001", "2026-10-01", "23:59:59")],
      dia(2026, 10, 1),
      dia(2026, 10, 1)
    );
    expect(porLegajo.get("PC_001")![0].tokens).toEqual([{ tipo: "E", hora: "23:59" }]);
  });

  it("un legajo con espacios al borde se unifica con el mismo sin espacios", () => {
    const { porLegajo } = agruparPorLegajo(
      [marca(" PC_001 ", "2026-10-01", "08:00:00"), marca("PC_001", "2026-10-01", "16:00:00")],
      dia(2026, 10, 1),
      dia(2026, 10, 1)
    );
    expect([...porLegajo.keys()]).toEqual(["PC_001"]);
    expect(porLegajo.get("PC_001")![0].tokens).toHaveLength(2);
  });

  it("un legajo null cuenta como sin legajo y no como el legajo \"null\"", () => {
    // La API se parsea sin validar: el tipo dice string pero puede llegar null.
    const sinLegajo = { ...marca("x", "2026-10-01", "08:00:00"), legajo: null } as unknown as MarcacionLenox;
    const { porLegajo, descartadas } = agruparPorLegajo([sinLegajo], dia(2026, 10, 1), dia(2026, 10, 1));
    expect(porLegajo.size).toBe(0);
    expect(descartadas.sinLegajo).toBe(1);
  });

  it("un legajo numérico se lee como su texto", () => {
    const numerico = { ...marca("x", "2026-10-01", "08:00:00"), legajo: 204 } as unknown as MarcacionLenox;
    const { porLegajo } = agruparPorLegajo([numerico], dia(2026, 10, 1), dia(2026, 10, 1));
    expect([...porLegajo.keys()]).toEqual(["204"]);
  });

  it("con desde > hasta cada legajo queda sin días, sin aviso (comportamiento fijado a propósito)", () => {
    const { porLegajo } = agruparPorLegajo(
      [marca("PC_001", "2026-10-02", "08:00:00")],
      dia(2026, 10, 3),
      dia(2026, 10, 1)
    );
    expect(porLegajo.get("PC_001")).toEqual([]);
  });
});
