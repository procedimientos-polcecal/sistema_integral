import { describe, it, expect } from "vitest";
import { filaParte, type ParteParaPlanilla } from "./planilla";

const PARTE: ParteParaPlanilla = {
  fecha: "2026-09-18",
  estado: "opero",
  material: "PIEDRA 6-20",
  origen: "Cantera propia",
  horaInicio: "7:30",
  horaFin: "15:30",
  horasMantenimiento: 1,
  horasFaltaPiedra: 0,
  horasProduccion: 7,
  horasOtro: 0,
  camionesLlegados: 12,
  toneladasProcesadas: 340,
  observaciones: "se cambio la malla",
};

/*
 * `escribirCeldas` y `agregarFila` mandan `USER_ENTERED`, asi que la planilla
 * interpreta lo que llega. El precedente es del 19/10/2026: un lazo de
 * IMPORTRANGE dejo las once pestanas de Compras en blanco todo el dia, y
 * nadie habia escrito una formula mala a mano — alcanzo con duplicar una
 * pestana. Un `=` tipeado en una observacion hace lo mismo a proposito.
 */
describe("el parte no deja entrar una formula", () => {
  it("escapa el material, el origen y las observaciones", () => {
    const fila = filaParte({
      ...PARTE,
      material: "-PIEDRA 6-20",
      origen: "@Cantera propia",
      observaciones: '=IMPORTRANGE("https://x";"A1")',
    });

    expect(fila[2]).toBe("'-PIEDRA 6-20");
    expect(fila[3]).toBe("'@Cantera propia");
    expect(fila[19]).toBe('\'=IMPORTRANGE("https://x";"A1")');
  });

  it("un texto normal no cambia", () => {
    const fila = filaParte(PARTE);
    expect(fila[2]).toBe("PIEDRA 6-20");
    expect(fila[19]).toBe("se cambio la malla");
  });

  /*
   * La otra mitad de la regla, y la que se olvida. Las dos horas las tipea
   * una persona igual que las observaciones, pero tienen que entrar como
   * hora: de ahi sale la cuenta de horas teoricas de la planilla. La fecha va
   * como serial y las toneladas como numero por lo mismo.
   */
  it("las horas, la fecha y los numeros no se escapan", () => {
    const fila = filaParte(PARTE);

    expect(fila[4]).toBe("7:30");
    expect(fila[5]).toBe("15:30");
    expect(typeof fila[0]).toBe("number");
    expect(fila[15]).toBe(340);
  });
});
