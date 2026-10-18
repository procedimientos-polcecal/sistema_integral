import { describe, it, expect } from "vitest";
import { porQueNoLlegaALaPlanilla, filaDeLaOTenElMaster } from "./planillaDeOT";

/**
 * EL 16/10/2026, dos veces el mismo silencio.
 *
 * La OT 2796 se creo desde la app y se registro el trabajo -completada, 1 hora,
 * dos operarios-. Nada de eso llego a la planilla y la pantalla no dijo una
 * palabra: `escribirEnLaFilaDeLaOT` devolvia `null` cuando la OT todavia no
 * tenia fila, y `null` es el mismo valor que "salio bien".
 *
 * Despues volvio a morder al repararla a mano: un script sin
 * GOOGLE_SHEETS_OT_ID leyo ese mismo `null` como exito y reporto cinco celdas
 * escritas que nunca se escribieron.
 *
 * Un diagnostico que no se distingue de otro no es un diagnostico; uno que no
 * se distingue del exito es peor.
 */
describe("por que un cambio no llega a la planilla", () => {
  it("con la planilla configurada no hay nada que lo impida", () => {
    expect(porQueNoLlegaALaPlanilla("1aCMQl…")).toBeNull();
  });

  /** El caso del script: sin variable no se escribe, y hay que decirlo. */
  it("sin planilla configurada lo dice, y nombra la variable", () => {
    const r = porQueNoLlegaALaPlanilla("");
    expect(r).not.toBeNull();
    expect(r).toContain("GOOGLE_SHEETS_OT_ID");
  });
});

/**
 * La fila de una OT en el master se BUSCA. Calcularla dejo de valer el
 * 16/10/2026, cuando el master paso a ordenar por N° de OT: una cuenta que
 * deja de valer no avisa, sigue devolviendo un numero plausible y la escritura
 * se va a la fila de otra orden.
 */
describe("en que fila del master esta una OT", () => {
  const columna = [["N° OT"], ["2795"], ["2796"], ["2797"]];

  it("la encuentra por su numero, no por una cuenta", () => {
    expect(filaDeLaOTenElMaster(columna, 2796)).toBe(3);
    expect(filaDeLaOTenElMaster(columna, 2795)).toBe(2);
  });

  /**
   * No estar es lo NORMAL en el alta: el IMPORTRANGE del master tarda. Por eso
   * devuelve null y no algo plausible — quien llama tiene que poder distinguir
   * "todavia no llego" de "esta en la fila 3".
   */
  it("si no esta devuelve null y no una fila plausible", () => {
    expect(filaDeLaOTenElMaster(columna, 2800)).toBeNull();
    expect(filaDeLaOTenElMaster(columna, null)).toBeNull();
    expect(filaDeLaOTenElMaster([], 2796)).toBeNull();
  });

  it("no confunde 279 con 2796", () => {
    expect(filaDeLaOTenElMaster(columna, 279)).toBeNull();
  });

  /** Se compara como numero: la planilla devuelve "2796" y la base 2796. */
  it("el texto de la planilla y el numero de la base son lo mismo", () => {
    expect(filaDeLaOTenElMaster([[2796]], 2796)).toBe(1);
    expect(filaDeLaOTenElMaster([[" 2796 "]], 2796)).toBe(1);
  });

  /** La primera que coincide. Dos filas con el mismo N° es un problema de la
   * planilla, y adoptarlo en silencio seria elegir una al azar. */
  it("con dos iguales se queda con la primera", () => {
    expect(filaDeLaOTenElMaster([["2796"], ["2796"]], 2796)).toBe(1);
  });
});
