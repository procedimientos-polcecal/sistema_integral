import { describe, expect, it } from "vitest";
import { contarNombresDeLaPlanilla, loQueDiceLaPlanilla } from "./proveedoresDeLaPlanilla";

describe("contar lo que escribe la planilla", () => {
  it("junta las formas de escribir el mismo nombre", () => {
    const m = contarNombresDeLaPlanilla([
      { nombre: "ALBERDI", nroRi: "2322" },
      { nombre: "Alberdi", nroRi: "1900" },
    ]);
    expect(m.size).toBe(1);
    expect(m.get("ALBERDI")).toEqual({ veces: 2, formas: ["ALBERDI", "Alberdi"], ultimoRi: 2322 });
  });

  /*
   * Es el caso de 70 de los 105 grupos: las dos filas del padrón caen en la
   * misma celda de la planilla. Contarlas como dos nombres daría vuelta la
   * respuesta de la mayoría.
   */
  it("un acento o un punto no hacen un nombre nuevo", () => {
    const m = contarNombresDeLaPlanilla([
      { nombre: "RAÍZ COMERCIAL" },
      { nombre: "RAIZ COMERCIAL" },
      { nombre: "Raiz Comercial" },
    ]);
    expect(m.size).toBe(1);
    expect(m.get("RAIZ COMERCIAL")?.veces).toBe(3);
  });

  it("pero dos nombres de verdad son dos", () => {
    const m = contarNombresDeLaPlanilla([{ nombre: "RANDAZZO" }, { nombre: "FERRETERIA RANDAZZO" }]);
    expect([...m.keys()].sort()).toEqual(["FERRETERIA RANDAZZO", "RANDAZZO"]);
  });

  it("las celdas vacías no cuentan", () => {
    expect(contarNombresDeLaPlanilla([{ nombre: "" }, { nombre: "   " }]).size).toBe(0);
  });

  it("un RI sin número no rompe la cuenta del último", () => {
    expect(contarNombresDeLaPlanilla([{ nombre: "MARFRA", nroRi: "RI-12" }]).get("MARFRA")?.ultimoRi).toBe(12);
    expect(contarNombresDeLaPlanilla([{ nombre: "MARFRA", nroRi: null }]).get("MARFRA")?.ultimoRi).toBe(0);
  });
});

describe("qué dice la planilla de un grupo de duplicados", () => {
  const planilla = contarNombresDeLaPlanilla([
    { nombre: "ALBERDI", nroRi: 2322 },
    { nombre: "ALBERDI", nroRi: 2100 },
    { nombre: "FERRETERIA RANDAZZO", nroRi: 2186 },
    { nombre: "RANDAZZO", nroRi: 1479 },
  ]);

  /*
   * Un solo nombre: la clave queda ocupada por la fila que sobreviva, así que
   * la sincronización no crea nada nuevo y borrar la otra alcanza.
   */
  it("con un solo nombre del grupo, fusionar alcanza", () => {
    const r = loQueDiceLaPlanilla(
      [{ id: "a", nombre: "ALBERDI" }, { id: "b", nombre: "Alberdi" }],
      planilla
    );
    expect(r.nombresDistintos).toBe(1);
    expect(r.porFila["a"].laNombra).toBe(true);
    expect(r.porFila["b"].laNombra).toBe(true);
    expect(r.porFila["a"].veces).toBe(2);
  });

  /** Con dos nombres, la que se borre vuelve: primero se unifica la celda. */
  it("con dos nombres distintos, avisa que son dos", () => {
    const r = loQueDiceLaPlanilla(
      [{ id: "a", nombre: "RANDAZZO" }, { id: "b", nombre: "Ferretería Randazzo" }],
      planilla
    );
    expect(r.nombresDistintos).toBe(2);
    expect(r.porFila["a"].ultimoRi).toBe(1479);
    expect(r.porFila["b"].ultimoRi).toBe(2186);
  });

  it("si la planilla no nombra a ninguna, nada las recrea", () => {
    const r = loQueDiceLaPlanilla(
      [{ id: "a", nombre: "CASA SILVIA" }, { id: "b", nombre: "Casa Silvia SA" }],
      planilla
    );
    expect(r.nombresDistintos).toBe(0);
    expect(r.porFila["a"].laNombra).toBe(false);
  });
});
