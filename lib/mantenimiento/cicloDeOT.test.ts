import { describe, it, expect } from "vitest";
import {
  queSigueEnElCiclo, caraDeLaVuelta, descripcionDeLaOT,
  type CicloParaDecidir, type OTDelCiclo,
} from "./cicloDeOT";

const CICLO: CicloParaDecidir = {
  id: "c1", repeticiones: 3, periodo_dias: 3,
  desde: "2026-11-03", vuelta_desde: 0,
};

const ot = (p: Partial<OTDelCiclo>): OTDelCiclo => ({
  ot_number: 1, ciclo_vuelta: 1, estado: "POR_HACER",
  fecha_cierre: null, fecha_ejecucion: "2026-11-06",
  created_at_app: "2026-11-03T12:00:00Z", ...p,
});

describe("queSigueEnElCiclo", () => {
  it("sin arranque no hace nada", () => {
    expect(queSigueEnElCiclo({ ...CICLO, desde: null, vuelta_desde: null }, []))
      .toEqual({ que: "sin_arrancar" });
  });

  it("sin OT propias arranca en la vuelta siguiente a la cargada", () => {
    expect(queSigueEnElCiclo(CICLO, []))
      .toEqual({ que: "crear", vuelta: 1, fecha_ejecucion: "2026-11-06" });
  });

  // Review Focus 3: el caso de Filler 2, que hoy está en 4ª cara.
  it("con la ultima vuelta hecha, lo que sigue es la madre", () => {
    expect(queSigueEnElCiclo({ ...CICLO, vuelta_desde: 3 }, []))
      .toEqual({ que: "crear", vuelta: 0, fecha_ejecucion: "2026-11-06" });
  });

  it("una hija cerrada genera la siguiente desde su cierre", () => {
    const filas = [ot({ ot_number: 10, ciclo_vuelta: 1, estado: "REALIZADO", fecha_cierre: "2026-11-07" })];
    expect(queSigueEnElCiclo(CICLO, filas))
      .toEqual({ que: "crear", vuelta: 2, fecha_ejecucion: "2026-11-10" });
  });

  it("la ultima hija cerrada genera la madre", () => {
    const filas = [ot({ ot_number: 10, ciclo_vuelta: 3, estado: "REALIZADO", fecha_cierre: "2026-11-07" })];
    expect(queSigueEnElCiclo(CICLO, filas))
      .toEqual({ que: "crear", vuelta: 0, fecha_ejecucion: "2026-11-10" });
  });

  it("la madre cerrada no genera: el corte lo mueve quien la ve cerrada", () => {
    const filas = [ot({ ot_number: 11, ciclo_vuelta: 0, estado: "REALIZADO", fecha_cierre: "2026-11-05" })];
    expect(queSigueEnElCiclo(CICLO, filas)).toEqual({ que: "esperar", ot: 11 });
  });

  it("una OT abierta hace esperar", () => {
    expect(queSigueEnElCiclo(CICLO, [ot({ ot_number: 12 })]))
      .toEqual({ que: "esperar", ot: 12 });
  });

  it("una ATRASADA tambien hace esperar: sigue abierta", () => {
    expect(queSigueEnElCiclo(CICLO, [ot({ ot_number: 19, estado: "ATRASADO" })]))
      .toEqual({ que: "esperar", ot: 19 });
  });

  // El corte. Es lo que hace que el botón de reinicio no reviva la orden que
  // acaba de suspender.
  it("ignora las OT creadas antes de desde", () => {
    const filas = [ot({
      ot_number: 13, ciclo_vuelta: 2, estado: "REALIZADO",
      fecha_cierre: "2026-10-30", created_at_app: "2026-10-25T12:00:00Z",
    })];
    expect(queSigueEnElCiclo(CICLO, filas))
      .toEqual({ que: "crear", vuelta: 1, fecha_ejecucion: "2026-11-06" });
  });

  it("una creada el mismo dia que desde si cuenta", () => {
    const filas = [ot({
      ot_number: 20, ciclo_vuelta: 1, estado: "REALIZADO",
      fecha_cierre: "2026-11-07", created_at_app: "2026-11-03T23:30:00Z",
    })];
    expect(queSigueEnElCiclo(CICLO, filas))
      .toEqual({ que: "crear", vuelta: 2, fecha_ejecucion: "2026-11-10" });
  });

  // Review Focus 1
  it("sin periodo_dias queda trabado y lo dice", () => {
    const d = queSigueEnElCiclo({ ...CICLO, periodo_dias: null }, []);
    expect(d.que).toBe("trabado");
    expect(d.que === "trabado" && d.porque).toContain("cada cuántos días");
  });

  // Review Focus 2
  it("REALIZADO sin fecha de cierre usa la de ejecucion", () => {
    const filas = [ot({
      ot_number: 14, ciclo_vuelta: 1, estado: "REALIZADO",
      fecha_cierre: null, fecha_ejecucion: "2026-11-07",
    })];
    expect(queSigueEnElCiclo(CICLO, filas))
      .toEqual({ que: "crear", vuelta: 2, fecha_ejecucion: "2026-11-10" });
  });

  it("REALIZADO sin ninguna fecha queda trabado", () => {
    const filas = [ot({
      ot_number: 15, ciclo_vuelta: 1, estado: "REALIZADO",
      fecha_cierre: null, fecha_ejecucion: null,
    })];
    expect(queSigueEnElCiclo(CICLO, filas).que).toBe("trabado");
  });

  it("una SUSPENDIDA detiene el ciclo", () => {
    const filas = [ot({ ot_number: 16, estado: "SUSPENDIDA" })];
    const d = queSigueEnElCiclo(CICLO, filas);
    expect(d.que).toBe("trabado");
    expect(d.que === "trabado" && d.porque).toContain("suspendida");
  });

  // Review Focus 4
  it("con dos abiertas no crea una tercera", () => {
    const filas = [ot({ ot_number: 17, ciclo_vuelta: 1 }), ot({ ot_number: 18, ciclo_vuelta: 2 })];
    expect(queSigueEnElCiclo(CICLO, filas).que).toBe("esperar");
  });
});

describe("caraDeLaVuelta", () => {
  it("la vuelta n lleva a la cara n+1", () => {
    expect([1, 2, 3].map(caraDeLaVuelta)).toEqual(["2ª", "3ª", "4ª"]);
  });
});

describe("descripcionDeLaOT", () => {
  it("la hija dice la cara, la vuelta y cuando se cambiaron", () => {
    expect(descripcionDeLaOT({
      tarea: "Rotación de Martillos", componente: "Martillos",
      vuelta: 2, repeticiones: 3, ultimoCambio: "2026-10-23",
    })).toBe("Rotación de Martillos — a 3ª cara (2 de 3). Martillos cambiados el 23/10/2026.");
  });

  it("sin fecha de cambio no inventa la frase", () => {
    expect(descripcionDeLaOT({
      tarea: "Rotación de Martillos", componente: "Martillos",
      vuelta: 1, repeticiones: 3, ultimoCambio: null,
    })).toBe("Rotación de Martillos — a 2ª cara (1 de 3).");
  });

  it("la madre dice que las vueltas estan hechas", () => {
    expect(descripcionDeLaOT({
      tarea: "Cambio de Martillos", componente: "Martillos",
      vuelta: 0, repeticiones: 3, ultimoCambio: "2026-10-17",
    })).toBe("Cambio de Martillos — las 3 rotaciones están hechas. Martillos cambiados el 17/10/2026.");
  });
});
