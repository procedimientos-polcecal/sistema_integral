import { describe, expect, it } from "vitest";
import { partesDeFilaCruda, yacimientoDeDestape, type EquipoLiviano } from "./partes";
import type { EmpleadoLiviano } from "./operarios";

const EQUIPOS: EquipoLiviano[] = [
  { id: "eq-em3", code: "EM3" },
  { id: "eq-em6", code: "EM6" },
];
const EMPLEADOS: EmpleadoLiviano[] = [
  { id: "op-andrada", nombre: "JUAN JOSE", apellido: "ANDRADA" },
  { id: "op-farias", nombre: "ALBERTO MARTIN", apellido: "FARIAS" },
];

/** Una fila cruda con las 14 columnas reales, con defaults razonables. */
function fila(p: Partial<{
  marcaTemporal: string; fecha: string; operador: string;
  equipo1: string; sector1: string; inicio1: string; fin1: string; cargasteTodo1: string;
  equipo2: string; sector2: string; inicio2: string; fin2: string; cargasteTodo2: string;
  observaciones: string;
}> = {}): unknown[] {
  return [
    p.marcaTemporal ?? "22/9/2026 14:32:10",
    p.fecha ?? "22/9/2026",
    p.operador ?? "Juan Andrada",
    p.equipo1 ?? "EM3 - Doosan 225 I",
    p.sector1 ?? "Destape D1",
    p.inicio1 ?? "07:00",
    p.fin1 ?? "12:00",
    p.cargasteTodo1 ?? "Si, terminé",
    p.equipo2 ?? "",
    p.sector2 ?? "",
    p.inicio2 ?? "",
    p.fin2 ?? "",
    p.cargasteTodo2 ?? "",
    p.observaciones ?? "",
  ];
}

describe("yacimientoDeDestape", () => {
  it("reconoce los 4 yacimientos de destape", () => {
    expect(yacimientoDeDestape("Destape D1")).toBe("D1");
    expect(yacimientoDeDestape("Destape D6")).toBe("D6");
    expect(yacimientoDeDestape("Destape C1")).toBe("C1");
    expect(yacimientoDeDestape("Destape C3")).toBe("C3");
  });

  it("el yacimiento solo, sin 'Destape', no es destape", () => {
    expect(yacimientoDeDestape("D1")).toBeNull();
    expect(yacimientoDeDestape("C3")).toBeNull();
  });

  it("otros sectores no son destape", () => {
    expect(yacimientoDeDestape("Pezucchi")).toBeNull();
    expect(yacimientoDeDestape("Planta trituración 1")).toBeNull();
    expect(yacimientoDeDestape("Movimiento interno")).toBeNull();
  });

  it("un código que no es de los 4 yacimientos válidos no se inventa", () => {
    expect(yacimientoDeDestape("Destape D9")).toBeNull();
  });
});

describe("partesDeFilaCruda", () => {
  it("una fila con un solo bloque da un solo parte", () => {
    const partes = partesDeFilaCruda(fila(), { equipos: EQUIPOS, empleados: EMPLEADOS });
    expect(partes).toHaveLength(1);
    expect(partes[0]).toMatchObject({
      bloque: 1,
      fecha: "2026-09-22",
      operarioId: "op-andrada",
      equipoId: "eq-em3",
      yacimientoDestapeCodigo: "D1",
      horas: 5,
    });
  });

  it("con 'No, hice otra actividad' y el segundo bloque cargado, da dos partes", () => {
    const partes = partesDeFilaCruda(
      fila({
        cargasteTodo1: "No, hice otra actividad.",
        equipo2: "EM6 - Caterpillar 950 G",
        sector2: "Planta trituración 1",
        inicio2: "12:30",
        fin2: "16:00",
        cargasteTodo2: "Si, terminé",
        observaciones: "todo en orden",
      }),
      { equipos: EQUIPOS, empleados: EMPLEADOS }
    );
    expect(partes).toHaveLength(2);
    expect(partes[1]).toMatchObject({
      bloque: 2,
      equipoId: "eq-em6",
      sectorRaw: "Planta trituración 1",
      yacimientoDestapeCodigo: null,
      horas: 3.5,
      observaciones: "todo en orden",
    });
    // Las observaciones van sólo en el último bloque, no repetidas en el primero.
    expect(partes[0].observaciones).toBeNull();
  });

  it("equipo no reconocido (código EM inválido) queda sin equipoId, no rompe", () => {
    const partes = partesDeFilaCruda(fila({ equipo1: "Retro alquilada" }), { equipos: EQUIPOS, empleados: EMPLEADOS });
    expect(partes[0].equipoId).toBeNull();
    expect(partes[0].equipoRaw).toBe("Retro alquilada");
  });

  it("operario que no matchea ningún empleado queda sin operarioId, no rompe", () => {
    const partes = partesDeFilaCruda(fila({ operador: "Alguien Desconocido" }), { equipos: EQUIPOS, empleados: EMPLEADOS });
    expect(partes[0].operarioId).toBeNull();
  });

  it("horario que cruza medianoche (o mal cargado) da horas null, no un número negativo", () => {
    const partes = partesDeFilaCruda(fila({ inicio1: "22:00", fin1: "04:00" }), { equipos: EQUIPOS, empleados: EMPLEADOS });
    expect(partes[0].horas).toBeNull();
  });

  it("sin marca temporal, fecha u operador, la fila no se procesa", () => {
    expect(partesDeFilaCruda(fila({ marcaTemporal: "" }), { equipos: EQUIPOS, empleados: EMPLEADOS })).toEqual([]);
    expect(partesDeFilaCruda(fila({ fecha: "" }), { equipos: EQUIPOS, empleados: EMPLEADOS })).toEqual([]);
    expect(partesDeFilaCruda(fila({ operador: "" }), { equipos: EQUIPOS, empleados: EMPLEADOS })).toEqual([]);
  });
});
