import { describe, it, expect } from "vitest";
import {
  datosDeAusenciaDeVacaciones,
  cambiosParaLaAusencia,
  hayAlgoQueCambiar,
  nadaCambioDeVerdad,
  rangoAlReves,
} from "./periodoDeVacaciones";

describe("datosDeAusenciaDeVacaciones", () => {
  it("fija el tipo y la justificación, que son lo que hace existir al período", () => {
    const d = datosDeAusenciaDeVacaciones(
      { employeeId: "e1", anioCorrespondiente: 2025, fechaDesde: "2026-07-27", fechaHasta: "2026-08-03" },
      "u1",
    );
    expect(d.tipo).toBe("VACACIONES");
    expect(d.justificada).toBe(true);
    expect(d.anioCorrespondiente).toBe(2025);
    expect(d.cargadoPorId).toBe("u1");
    expect(d.fechaDesde).toBe("2026-07-27");
    expect(d.fechaHasta).toBe("2026-08-03");
  });

  // Review Focus 3: el año no se inventa. `altaDeAusencia` devuelve 400 si no es
  // entero, y eso es lo correcto: antes la ruta ponía el año actual por defecto
  // y descontaba del balance equivocado sin decir nada.
  it("no inventa el año cuando no vino", () => {
    const d = datosDeAusenciaDeVacaciones(
      { employeeId: "e1", fechaDesde: "2026-07-27", fechaHasta: "2026-08-03" },
      "u1",
    );
    expect(d.anioCorrespondiente).toBeUndefined();
  });

  it("no inventa el año cuando llegó NaN", () => {
    const d = datosDeAusenciaDeVacaciones(
      { employeeId: "e1", anioCorrespondiente: NaN, fechaDesde: "a", fechaHasta: "b" },
      "u1",
    );
    expect(d.anioCorrespondiente).toBeUndefined();
  });

  // `Number("")` es **0**, no NaN. Las dos pantallas mandan
  // `Number(campoDeAño)`, y el año de Balance no tiene `required`: vaciarlo
  // posteaba un período cargado al año 0, que `Number.isInteger` aceptaba.
  it("no acepta el año 0, que es lo que manda un campo de año vacío", () => {
    expect(Number("")).toBe(0); // la premisa, fijada acá para que no se vuelva a suponer
    const d = datosDeAusenciaDeVacaciones(
      { employeeId: "e1", anioCorrespondiente: Number(""), fechaDesde: "a", fechaHasta: "b" },
      "u1",
    );
    expect(d.anioCorrespondiente).toBeUndefined();
  });

  it("no acepta un año anterior a 1900, que no es un año de vacaciones de nadie", () => {
    const d = datosDeAusenciaDeVacaciones(
      { employeeId: "e1", anioCorrespondiente: 202, fechaDesde: "a", fechaHasta: "b" },
      "u1",
    );
    expect(d.anioCorrespondiente).toBeUndefined();
  });

  it("acepta un año de verdad", () => {
    const d = datosDeAusenciaDeVacaciones(
      { employeeId: "e1", anioCorrespondiente: 1999, fechaDesde: "a", fechaHasta: "b" },
      "u1",
    );
    expect(d.anioCorrespondiente).toBe(1999);
  });
});

/*
 * El freno contra la fila de auditoría que miente.
 *
 * `hayAlgoQueCambiar` sólo mira si vinieron campos, y la ficha del empleado
 * manda los cuatro **siempre**: abrir «Editar», no tocar nada y guardar pasaba
 * ese freno y escribía un `corregir` con `valor_anterior` idéntico a
 * `valor_nuevo`. `auditoria` no tiene policy de update ni de delete y un
 * trigger las rechaza, así que esa fila queda para siempre diciendo que alguien
 * corrigió algo que no corrigió.
 */
describe("nadaCambioDeVerdad", () => {
  const igual = "Vacaciones 2025 del 2026-07-27 al 2026-08-03 (8 días)";

  it("dice que sí cuando el período queda igual y el empleado no vino", () => {
    expect(nadaCambioDeVerdad(igual, igual, "e1", undefined)).toBe(true);
  });

  it("dice que sí cuando el empleado vino pero es el mismo", () => {
    expect(nadaCambioDeVerdad(igual, igual, "e1", "e1")).toBe(true);
  });

  // El empleado NO entra en el texto del período, así que sin esta condición un
  // cambio de persona quedaría sin registro y sin escribirse.
  it("dice que no cuando cambia el empleado, aunque el texto sea idéntico", () => {
    expect(nadaCambioDeVerdad(igual, igual, "e1", "e2")).toBe(false);
  });

  it("dice que no cuando el período queda distinto", () => {
    expect(
      nadaCambioDeVerdad(igual, "Vacaciones 2026 del 2026-07-27 al 2026-08-03 (8 días)", "e1", "e1"),
    ).toBe(false);
  });
});

describe("cambiosParaLaAusencia", () => {
  it("traduce sólo los campos que vinieron", () => {
    expect(cambiosParaLaAusencia({ fechaHasta: "2026-08-10" })).toEqual({ fecha_hasta: "2026-08-10" });
  });

  // Review Focus 1: el año NO es un campo de la ausencia. Que no aparezca acá es
  // lo que obliga a la ruta a tratarlo aparte en vez de abortar por "sin cambios".
  it("deja el año afuera: vive en el período, no en la ausencia", () => {
    expect(cambiosParaLaAusencia({ anioCorrespondiente: 2026 })).toEqual({});
  });

  // Review Focus 5: una pestaña vieja todavía manda diasTomados.
  it("ignora diasTomados aunque venga en el cuerpo", () => {
    expect(cambiosParaLaAusencia({ fechaDesde: "2026-07-27", diasTomados: 3 })).toEqual({
      fecha_desde: "2026-07-27",
    });
  });

  it("un cuerpo vacío no produce cambios", () => {
    expect(cambiosParaLaAusencia({})).toEqual({});
  });

  it("observaciones vacío se guarda como null y no como cadena vacía", () => {
    expect(cambiosParaLaAusencia({ observaciones: "" })).toEqual({ observaciones: null });
  });
});

// Review Focus 1 y 2 juntos: lo que la ruta del PUT tiene que poder distinguir.
describe("hayAlgoQueCambiar", () => {
  it("un cuerpo vacío no tiene nada que cambiar", () => {
    expect(hayAlgoQueCambiar({})).toBe(false);
  });
  it("sólo el año sí tiene algo que cambiar, aunque no toque la ausencia", () => {
    expect(hayAlgoQueCambiar({ anioCorrespondiente: 2026 })).toBe(true);
  });
  it("sólo diasTomados no es nada que cambiar: se ignora", () => {
    expect(hayAlgoQueCambiar({ diasTomados: 9 })).toBe(false);
  });
});

// Review Focus 4: nadie validaba esto, y `diasEntre` devolvía un negativo que
// terminaba en `dias_tomados`.
describe("rangoAlReves", () => {
  it("dice que sí cuando hasta es anterior a desde", () => {
    expect(rangoAlReves("2026-08-03", "2026-07-27")).toBe(true);
  });
  it("un solo día no está al revés", () => {
    expect(rangoAlReves("2026-07-27", "2026-07-27")).toBe(false);
  });
});
