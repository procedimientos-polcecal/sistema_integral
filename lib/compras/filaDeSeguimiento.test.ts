import { describe, it, expect } from "vitest";
import { filaDeSeguimiento, type DatosDeSeguimiento } from "./seguimiento";

const BASE: DatosDeSeguimiento = {
  nro_ri: 1952,
  codigo: null,
  area: "Mantenimiento",
  descripcion: "Cable tipo TPR 3 x 4 mm2",
  proveedor: "SINGLA",
  empresa: null,
  paga_ambas: true,
  cantidad: 100,
  cantidad_comprada: null,
  cantidad_recibida: null,
  fecha_estimada_recepcion: null,
  fecha_recepcion: null,
  cumplio_compras: null,
  cumplio_proveedor: null,
};

describe("filaDeSeguimiento", () => {
  /**
   * LA REGLA QUE MUERDE. Un Apps Script de la planilla barre el master
   * buscando filas con fecha de recepción y sin MAIL_ENVIADO para avisarle al
   * área. Si al corregir una recepción se pisara esa celda con vacío, el área
   * recibiría el aviso de nuevo. `null` significa "no escribir esta celda".
   */
  it("nunca escribe MAIL_ENVIADO", () => {
    const fila = filaDeSeguimiento({ ...BASE, fecha_recepcion: "2026-09-15" });
    expect(fila[10]).toBeNull();
  });

  it("la cantidad comprada cae en la del RI cuando no se cargó otra", () => {
    expect(filaDeSeguimiento(BASE)[6]).toBe("100");
    expect(filaDeSeguimiento({ ...BASE, cantidad_comprada: 95 })[6]).toBe("95");
  });

  /**
   * Las fechas salen como SERIAL y no como texto.
   *
   * Es la decisión que ya tomó `lib/core/fechaDeSheets.ts` y el motivo está
   * escrito ahí: un "15/9/2026" lo interpreta la planilla según su locale, y
   * leer d/m al revés ya dio vuelta 885 fechas en Compras. El libro es `es_AR`
   * hoy y puede no serlo mañana. Un número no se interpreta.
   */
  it("las fechas salen como serial de Sheets", () => {
    const fila = filaDeSeguimiento({ ...BASE, fecha_recepcion: "2026-09-15" });
    expect(fila[9]).toBe("46280");
  });

  /**
   * Una fecha imposible se descarta, no se corrige: `serialDelDia` devuelve
   * null para el 30 de febrero en vez de rodarlo al 2 de marzo. Acá eso es una
   * celda vacía, que se nota, y no una fecha plausible corrida tres días.
   */
  it("una fecha imposible deja la celda vacía", () => {
    const fila = filaDeSeguimiento({ ...BASE, fecha_recepcion: "2026-02-30" });
    expect(fila[9]).toBe("");
  });

  it("usa las etiquetas de la planilla para el juicio", () => {
    const fila = filaDeSeguimiento({
      ...BASE,
      cumplio_compras: "MAS_O_MENOS",
      cumplio_proveedor: "SI",
    });
    expect(fila[11]).toBe("Más o menos");
    expect(fila[12]).toBe("Si");   // sin tilde: es como está en la planilla
  });

  it("'Ambas' se expresa aunque no haya empresa", () => {
    expect(filaDeSeguimiento(BASE)[5]).toBe("Ambas");
    expect(filaDeSeguimiento({ ...BASE, paga_ambas: false })[5]).toBe("");
  });

  /** Trece columnas, A a M. Una de más o de menos corre todo el resto. */
  it("son trece celdas", () => {
    expect(filaDeSeguimiento(BASE)).toHaveLength(13);
  });
});
