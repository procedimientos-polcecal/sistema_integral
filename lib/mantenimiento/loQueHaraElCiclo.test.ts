import { describe, expect, test } from "vitest";
import { loQueHaraElCiclo, type CicloCompleto } from "./loQueHaraElCiclo";
import type { OTDelCiclo } from "./cicloDeOT";
import type { CerradaParaMirar } from "./sospechaDeCambio";

/**
 * Lo que esta función agrega sobre `queSigueEnElCiclo()`, que es por lo que
 * existe: los cinco casos de abajo **no** los da la función pura sola. Dos son
 * motivos de `trabado` que hasta hoy vivían sueltos en `generarEncadenadas.ts`,
 * y los otros tres son el resultado de componer los tres pasos en orden.
 *
 * Los números son los de Hidratación (PO-C1-04) del 24/11/2026: período 3 días,
 * tres rotaciones, y la OT 3166 como la madre.
 */

const EQUIPO = "eq-po-c1-04";

const ciclo = (cambios: Partial<CicloCompleto> = {}): CicloCompleto => ({
  id: "ciclo-1",
  equipment_id: EQUIPO,
  repeticiones: 3,
  desde: "2026-11-17",
  vuelta_desde: 0,
  creado_en: "2026-11-13T09:00:00Z",
  equipoActivo: true,
  equipoCode: "PO-C1-04",
  madre: { nombre: "Cambio de Martillos", componente: "Martillos", periodo_dias: null },
  hija: { nombre: "Rotación de Martillos", componente: "Martillos", periodo_dias: 3 },
  ...cambios,
});

const madreCerrada = (ot_number: number, cerradaEl: string, nacidaEl: string): OTDelCiclo => ({
  ot_number,
  ciclo_vuelta: 0,
  estado: "REALIZADO",
  fecha_cierre: cerradaEl,
  fecha_ejecucion: cerradaEl,
  created_at_app: `${nacidaEl}T10:00:00Z`,
});

const cerrada = (
  ot_number: number,
  fecha_cierre: string,
  descripcion: string
): CerradaParaMirar => ({
  ot_number,
  equipment_id: EQUIPO,
  descripcion,
  fecha_cierre,
  ciclo_id: null,
});

describe("loQueHaraElCiclo", () => {
  test("un equipo inactivo traba el ciclo", () => {
    const r = loQueHaraElCiclo(ciclo({ equipoActivo: false }), [], []);

    expect(r.decision).toEqual({
      que: "trabado",
      porque: expect.stringContaining("inactivo"),
    });
  });

  test("sin tarea madre o hija traba el ciclo", () => {
    const r = loQueHaraElCiclo(ciclo({ hija: null }), [], []);

    expect(r.decision).toEqual({
      que: "trabado",
      porque: expect.stringContaining("catálogo"),
    });
  });

  test("la madre recién cerrada mueve el corte y crea la hija 1, no espera", () => {
    // `queSigueEnElCiclo` sola diría «espera la OT 3166»: lo que destraba un
    // ciclo cuya madre se cerró es mover el corte, y eso es el segundo paso.
    const r = loQueHaraElCiclo(
      ciclo({ desde: "2026-11-17", vuelta_desde: 0 }),
      [madreCerrada(3166, "2026-11-24", "2026-11-21")],
      []
    );

    expect(r.corte).toEqual({ desde: "2026-11-24", vuelta_desde: 0 });
    expect(r.decision).toEqual({ que: "crear", vuelta: 1, fecha_ejecucion: "2026-11-27" });
  });

  test("un ciclo sin arrancar cuyo cambio ya se cerró arranca, no dice «sin arrancar»", () => {
    const r = loQueHaraElCiclo(
      ciclo({ desde: null, vuelta_desde: null, creado_en: "2026-11-01T09:00:00Z" }),
      [],
      [cerrada(3100, "2026-11-14", "Cambio de martillos")]
    );

    expect(r.arranque).toEqual({ desde: "2026-11-14", ot_number: 3100 });
    expect(r.decision.que).toBe("crear");
  });

  test("un ciclo sin arrancar y sin ningún cambio posterior sigue sin arrancar", () => {
    const r = loQueHaraElCiclo(ciclo({ desde: null, vuelta_desde: null }), [], []);

    expect(r.arranque).toBeNull();
    expect(r.decision).toEqual({ que: "sin_arrancar" });
  });

  /**
   * `alDecidir` es el corte **ya movido**, y la orden que nace lo escribe
   * adentro como «el último cambio fue el …». Sin él, el generador tendría que
   * volver a derivarlo de `arranque` y `corte` por su cuenta, que es la
   * segunda derivación que esta función existe para que no haya.
   */
  test("dice contra qué corte decidió, con el arranque y el corte ya aplicados", () => {
    const conCorte = loQueHaraElCiclo(
      ciclo({ desde: "2026-11-17", vuelta_desde: 0 }),
      [madreCerrada(3166, "2026-11-24", "2026-11-21")],
      []
    );
    expect(conCorte.alDecidir).toEqual({ desde: "2026-11-24", vuelta_desde: 0 });

    const conArranque = loQueHaraElCiclo(
      ciclo({ desde: null, vuelta_desde: null, creado_en: "2026-11-01T09:00:00Z" }),
      [],
      [cerrada(3100, "2026-11-14", "Cambio de martillos")]
    );
    expect(conArranque.alDecidir).toEqual({ desde: "2026-11-14", vuelta_desde: 0 });

    const sinMover = loQueHaraElCiclo(ciclo({ desde: "2026-11-17", vuelta_desde: 2 }), [], []);
    expect(sinMover.alDecidir).toEqual({ desde: "2026-11-17", vuelta_desde: 2 });
  });
});
