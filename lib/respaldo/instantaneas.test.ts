import { describe, it, expect } from "vitest";
import { INSTANTANEAS } from "./instantaneas";

/**
 * Esto no prueba las consultas —esas necesitan la base— sino la forma de cada
 * instantánea, que es donde se puede romper sin que nada avise.
 *
 * El caso concreto que ya pasó: las fechas se escriben como serial y un serial
 * sin formato se muestra crudo. La columna "Ingreso" decía `45903` en vez de
 * `03/09/2025`, y el respaldo entero dejó de ser legible — que es para lo único
 * que existe. Se vio leyendo la planilla de vuelta, no escribiéndola.
 */

/** Los encabezados que, en cada instantánea, llevan formato declarado. */
function columnasConFormato(ins: (typeof INSTANTANEAS)[number]): [string, string][] {
  return (ins.formatos ?? [])
    .map((f, i) => [ins.encabezados[i], f] as [string, string | null])
    .filter((x): x is [string, string] => x[1] !== null);
}

describe("INSTANTANEAS", () => {
  it("son las siete acordadas", () => {
    expect(INSTANTANEAS.map((i) => i.pestana)).toEqual([
      "RRHH - Padron",
      "RRHH - Asistencia",
      "RRHH - Marcaciones",
      "Remises - Plan",
      "Remises - Asistencia",
      "Calidad - Ensayos",
      "Facturacion - Buzon",
    ]);
  });

  it("ninguna declara más formatos que columnas", () => {
    for (const ins of INSTANTANEAS) {
      expect((ins.formatos ?? []).length, ins.pestana).toBeLessThanOrEqual(ins.encabezados.length);
    }
  });

  /*
   * Por nombre de columna y no por índice, a propósito: lo que rompe esto es
   * insertar una columna en el medio, y un test escrito por índice seguiría
   * pasando mientras el formato se aplica a la columna equivocada. Si alguien
   * mueve "Fecha", este test falla y dice cuál quedó mal.
   */
  it("cada columna de fecha y de hora tiene su formato, y están donde se cree", () => {
    const esperado: Record<string, [string, string][]> = {
      "RRHH - Padron": [["Ingreso", "fecha"]],
      "RRHH - Asistencia": [["Fecha", "fecha"]],
      "RRHH - Marcaciones": [
        ["Fecha", "fecha"],
        ["Entrada", "hora"],
        ["Salida", "hora"],
      ],
      "Remises - Plan": [["Fecha", "fecha"]],
      "Remises - Asistencia": [["Fecha", "fecha"]],
      "Calidad - Ensayos": [["Fecha", "fecha"]],
      "Facturacion - Buzon": [["Recibido", "fecha"]],
    };

    for (const ins of INSTANTANEAS) {
      expect(columnasConFormato(ins), ins.pestana).toEqual(esperado[ins.pestana]);
    }
  });

  // Si una pestaña tuviera una columna llamada "Fecha" sin formato declarado,
  // se vería como un número de cinco cifras y nadie lo notaría hasta abrir el
  // libro. Esta es la red por si alguien agrega una instantánea nueva y se
  // olvida de sumarla al mapa de arriba.
  it("ninguna columna que se llame como una fecha quedó sin formato", () => {
    const nombresDeFecha = /^(fecha|ingreso|recibido|desde|hasta|vencimiento)$/i;
    for (const ins of INSTANTANEAS) {
      const formateadas = new Set(columnasConFormato(ins).map(([nombre]) => nombre));
      for (const cabecera of ins.encabezados) {
        if (nombresDeFecha.test(cabecera)) {
          expect(formateadas.has(cabecera), `${ins.pestana} → "${cabecera}"`).toBe(true);
        }
      }
    }
  });

  it("ninguna pestaña se llama como otra", () => {
    const nombres = INSTANTANEAS.map((i) => i.pestana);
    expect(new Set(nombres).size).toBe(nombres.length);
  });
});
