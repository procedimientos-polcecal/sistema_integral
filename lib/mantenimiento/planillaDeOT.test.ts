import { describe, it, expect } from "vitest";
import { porQueNoLlegaALaPlanilla } from "./planillaDeOT";

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
  const conFila = { ot_number: 2796, sheets_row: 2176 };

  it("con planilla y con fila, no hay nada que impida escribir", () => {
    expect(porQueNoLlegaALaPlanilla("1aCMQl…", conFila)).toBeNull();
  });

  /** El caso del script: sin variable no se escribe, y hay que decirlo. */
  it("sin planilla configurada lo dice, y nombra la variable", () => {
    const r = porQueNoLlegaALaPlanilla("", conFila);
    expect(r).not.toBeNull();
    expect(r).toContain("GOOGLE_SHEETS_OT_ID");
  });

  /**
   * El caso de la 2796: creada desde la app, la fila del master la pone la
   * sincronizacion, y hasta entonces cualquier cambio queda solo en el sistema.
   */
  it("sin fila lo dice, y explica que falta sincronizar", () => {
    const r = porQueNoLlegaALaPlanilla("1aCMQl…", { ot_number: 2796, sheets_row: null });
    expect(r).not.toBeNull();
    expect(r).toContain("sincroniz");
  });

  /** La fila 0 no existe en una planilla: cuenta como no tenerla. */
  it("una fila cero no es una fila", () => {
    expect(porQueNoLlegaALaPlanilla("1aCMQl…", { ot_number: 2796, sheets_row: 0 })).not.toBeNull();
  });

  /** Falta la variable y falta la fila: se dicen las dos, no la primera. */
  it("si faltan las dos cosas, se dicen las dos", () => {
    const r = porQueNoLlegaALaPlanilla("", { ot_number: 2796, sheets_row: null });
    expect(r).toContain("GOOGLE_SHEETS_OT_ID");
    expect(r).toContain("sincroniz");
  });
});
