import { describe, it, expect } from "vitest";
import {
  COLUMNAS,
  RANGO_QUE_SE_ESCRIBE,
  filaDeLaPlanilla,
  parsearHoraDePlanilla,
  horaComoSeEscribe,
  fechaComoSeEscribe,
  pestanaDelMes,
} from "./planilla";
import type { OrdenDeCarga } from "./types";

const ORDEN: OrdenDeCarga = {
  id: "una",
  numero: "13801",
  fecha: "2026-09-08",
  empresa_id: "emp-1",
  odoo_picking_id: 77045,
  odoo_picking_name: "0001-00077045",
  odoo_sale_name: "S08526",
  odoo_product_id: 2394,
  cliente_raw: "GT CONSTRUCCIONES S.A.",
  producto_raw: "FILLER A GRANEL",
  cantidad: 36.64,
  unidad: "Toneladas",
  entrada_predio: "2026-09-08T13:00:00.000Z", // 10:00
  inicio_carga: "2026-09-08T13:20:00.000Z", //  10:20
  fin_carga: "2026-09-08T14:00:00.000Z", //     11:00
  salida_predio: "2026-09-08T14:15:00.000Z", // 11:15
  notas: "portón 2",
  supervisor_raw: "Vecchio",
  supervisor_id: null,
  sheets_fila: 902,
  sheets_pendiente: null,
  sheets_pendiente_en: null,
};

describe("las columnas de la planilla", () => {
  it("están en el orden real del libro, que no es el orden de los hechos", () => {
    expect(COLUMNAS).toEqual([
      "Fecha Orden",
      "Nro de Orden",
      "Cliente",
      "Material",
      "Hora comienzo de Carga",
      "Hora Salida de carga",
      "Hora Ingreso al predio",
      "Hora Salida del Predio",
      "Observaciones",
      "Tiempo de Carga",
      "Tiempo en Predio",
    ]);
  });

  /**
   * Se escribe A:I y se dejan J y K, que en la planilla son fórmulas.
   * Pisarlas con un número las convertiría en dato y la planilla dejaría de
   * calcular sola — el mismo motivo por el que Inventario lee la columna de
   * stock en vez de recalcularla.
   */
  it("el rango que se escribe deja afuera las dos columnas calculadas", () => {
    expect(RANGO_QUE_SE_ESCRIBE).toEqual({ primera: "A", ultima: "I" });
  });
});

describe("pestanaDelMes", () => {
  /**
   * El libro tiene una hoja por mes y la pestaña es el mes de la orden. Escribir
   * en la pestaña equivocada no falla: deja el renglón en el mes que no es.
   */
  it("es el mes de la orden, como lo escribe el libro", () => {
    expect(pestanaDelMes("2026-09-08")).toBe("SEPTIEMBRE 2026");
    expect(pestanaDelMes("2026-04-15")).toBe("ABRIL 2026");
    expect(pestanaDelMes("2026-01-01")).toBe("ENERO 2026");
    expect(pestanaDelMes("2026-12-31")).toBe("DICIEMBRE 2026");
    expect(pestanaDelMes("2027-10-02")).toBe("OCTUBRE 2027");
  });

  it("una fecha que no es una fecha no da una pestaña inventada", () => {
    expect(pestanaDelMes("")).toBeNull();
    expect(pestanaDelMes("8/9/2026")).toBeNull();
    expect(pestanaDelMes("2026-13-01")).toBeNull();
  });
});

describe("filaDeLaPlanilla", () => {
  it("pone cada horario en su columna, que no es la del orden en que ocurren", () => {
    const fila = filaDeLaPlanilla(ORDEN, {
      material: "Filler",
      granulometria: null,
      envase: "A granel",
    });

    expect(fila).toEqual([
      "8/9/2026",
      "13801",
      "GT CONSTRUCCIONES S.A.",
      "Filler a granel",
      "10:20", // Hora comienzo de Carga → inicio_carga
      "11:00", // Hora Salida de carga   → fin_carga
      "10:00", // Hora Ingreso al predio → entrada_predio
      "11:15", // Hora Salida del Predio → salida_predio
      "portón 2",
    ]);
  });

  /**
   * La celda se escribe con la forma del libro y no con la del sistema: 1.714
   * renglones de historia dicen "Filler a granel" y "Calcio 0-2 en Bolsones".
   */
  it("escribe la columna Material con la ortografía del libro", () => {
    const conBolsones = filaDeLaPlanilla(ORDEN, {
      material: "Calcio",
      granulometria: "0-2",
      envase: "Bolsón",
    });
    expect(conBolsones[3]).toBe("Calcio 0-2 en Bolsones");

    const doscientos = filaDeLaPlanilla(ORDEN, {
      material: "Calcio",
      granulometria: "#200",
      envase: "Bolsa",
    });
    expect(doscientos[3]).toBe("Calcio 200 en Bolsa");

    const tolva = filaDeLaPlanilla(ORDEN, {
      material: "Cal",
      granulometria: null,
      envase: "Tolva",
    });
    expect(tolva[3]).toBe("Cal en Tolva");
  });

  it("sin clasificación cae al nombre crudo del producto, no a una celda vacía", () => {
    const fila = filaDeLaPlanilla(ORDEN, null);
    expect(fila[3]).toBe("FILLER A GRANEL");
  });

  it("un horario sin marcar deja la celda vacía y no un cero", () => {
    const fila = filaDeLaPlanilla({ ...ORDEN, fin_carga: null }, null);
    expect(fila[5]).toBe("");
  });
});

describe("parsearHoraDePlanilla", () => {
  it("lee la hora como texto, con o sin cero adelante", () => {
    expect(parsearHoraDePlanilla("07:35", "2026-09-08")).toBe("2026-09-08T10:35:00.000Z");
    expect(parsearHoraDePlanilla("7:35", "2026-09-08")).toBe("2026-09-08T10:35:00.000Z");
    expect(parsearHoraDePlanilla("07:35:00", "2026-09-08")).toBe("2026-09-08T10:35:00.000Z");
  });

  /** Una celda de hora de Sheets llega como fracción de día: 0.5 es mediodía. */
  it("lee el serial de Sheets, que es una fracción del día", () => {
    expect(parsearHoraDePlanilla(0.5, "2026-09-08")).toBe("2026-09-08T15:00:00.000Z");
    expect(parsearHoraDePlanilla(45900.5, "2026-09-08")).toBe("2026-09-08T15:00:00.000Z");
  });

  it("una celda vacía o ilegible es null, no medianoche", () => {
    expect(parsearHoraDePlanilla("", "2026-09-08")).toBeNull();
    expect(parsearHoraDePlanilla(null, "2026-09-08")).toBeNull();
    expect(parsearHoraDePlanilla("a la tarde", "2026-09-08")).toBeNull();
    expect(parsearHoraDePlanilla("25:00", "2026-09-08")).toBeNull();
  });

  /**
   * La trampa del importador. Las columnas de hora no traen fecha, así que hay
   * que pegarles la de la orden — y un camión que entra 23:40 y sale 00:30 daría
   * un tiempo en predio de menos catorce horas. Si un horario es menor que el
   * anterior, es del día siguiente.
   */
  it("un horario anterior al que lo precede es del día siguiente", () => {
    const entrada = parsearHoraDePlanilla("23:40", "2026-09-08");
    expect(entrada).toBe("2026-09-09T02:40:00.000Z");

    const salida = parsearHoraDePlanilla("00:30", "2026-09-08", entrada);
    expect(salida).toBe("2026-09-09T03:30:00.000Z");

    const minutos = (new Date(salida!).getTime() - new Date(entrada!).getTime()) / 60000;
    expect(minutos).toBe(50);
  });

  it("un horario posterior al anterior no se corre de día", () => {
    const inicio = parsearHoraDePlanilla("10:20", "2026-09-08");
    expect(parsearHoraDePlanilla("11:00", "2026-09-08", inicio)).toBe("2026-09-08T14:00:00.000Z");
  });
});

describe("cómo se escribe cada cosa", () => {
  it("la hora, en hora de Argentina y no en UTC", () => {
    expect(horaComoSeEscribe("2026-09-08T13:20:00.000Z")).toBe("10:20");
    // 00:30 de Argentina es 03:30 UTC del mismo día: el día no se corre.
    expect(horaComoSeEscribe("2026-09-09T03:30:00.000Z")).toBe("00:30");
    expect(horaComoSeEscribe(null)).toBe("");
  });

  it("la fecha, en d/m como la planilla", () => {
    expect(fechaComoSeEscribe("2026-09-08")).toBe("8/9/2026");
    expect(fechaComoSeEscribe("2026-12-25")).toBe("25/12/2026");
  });
});

describe("el cruce de medianoche contra el error de tipeo", () => {
  /**
   * Los dos casos que un salto hacia atrás puede significar, y que la primera
   * versión confundía: sumaba un día siempre, y así 250 de las 1.702 órdenes
   * importadas quedaron con permanencias de 25 horas.
   *
   * Gana la interpretación que da la duración más corta: se suma un día sólo
   * cuando el salto hacia atrás pasa las 12 h.
   */
  it("un salto grande es un cruce de medianoche y suma un día", () => {
    const entrada = parsearHoraDePlanilla("23:40", "2026-09-08");
    const salida = parsearHoraDePlanilla("00:30", "2026-09-08", entrada);
    expect(salida).toBe("2026-09-09T03:30:00.000Z");
    expect((Date.parse(salida!) - Date.parse(entrada!)) / 60000).toBe(50);
  });

  it("un salto chico es un error de tipeo y queda negativo", () => {
    // Nº 13094 del libro: entrada 11:45 e inicio de carga 11:12. Sumar un día
    // daba una carga de 23 h 27; dejarlo negativo lo muestra en rojo.
    const entrada = parsearHoraDePlanilla("11:45", "2026-07-15");
    const inicio = parsearHoraDePlanilla("11:12", "2026-07-15", entrada);
    expect(inicio).toBe("2026-07-15T14:12:00.000Z");
    expect((Date.parse(inicio!) - Date.parse(entrada!)) / 60000).toBe(-33);
  });

  it("justo en el empate de doce horas no suma", () => {
    const antes = parsearHoraDePlanilla("18:00", "2026-09-08");
    // 06:00 es exactamente 12 h antes: las dos lecturas dan 720 min y no se
    // corrige, que es lo mismo que hacía el `>` estricto.
    expect(parsearHoraDePlanilla("06:00", "2026-09-08", antes)).toBe("2026-09-08T09:00:00.000Z");
    // Un minuto más de salto ya se va al día siguiente.
    expect(parsearHoraDePlanilla("05:59", "2026-09-08", antes)).toBe("2026-09-09T08:59:00.000Z");
  });
});
