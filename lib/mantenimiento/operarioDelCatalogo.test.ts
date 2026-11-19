import { describe, expect, it } from "vitest";
import { resolverElCatalogo } from "./operarioDelCatalogo";
import type { PersonaDelTaller } from "./disponibilidad";

/*
 * El catálogo y el padrón de producción, medidos el 19/11/2026. Los ids son de
 * mentira; los nombres y los slots son los reales, porque lo que este módulo
 * decide depende de cómo se parecen esos textos entre sí.
 */
const CATALOGO = [
  { slot: 1, nombre: "Agosta" },
  { slot: 1, nombre: "Aguirre" },
  { slot: 1, nombre: "Ambos" },
  { slot: 1, nombre: "Lopez" },
  { slot: 1, nombre: "Lucas" },
  { slot: 2, nombre: "Echeverria" },
  { slot: 2, nombre: "Garcia" },
  { slot: 2, nombre: "Mendizabal" },
  { slot: 3, nombre: "Picart" },
  { slot: 3, nombre: "Piparo" },
];

const persona = (
  empleadoId: string,
  oficio: PersonaDelTaller["oficio"],
): PersonaDelTaller => ({
  empleadoId,
  oficio,
  grupo: null,
  desde: "2026-11-09",
  hasta: null,
});

const PADRON: PersonaDelTaller[] = [
  persona("i-aguirre", "mecanico"),
  persona("i-agosta", "electricista"),
  persona("i-picart", "electricista"),
  persona("i-echeverria", "mecanico"),
  persona("i-gallastegui", "lubricador"),
  persona("i-piparo", "mecanico"),
  persona("i-mendizabal", "mecanico"),
  persona("i-garcia", "electricista"),
];

/*
 * Con tilde en ECHEVERRÍA a propósito: la planilla la escribe sin tilde y la
 * ficha del empleado con ella, y las dos tienen que cruzarse.
 */
const NOMBRES = new Map([
  ["i-aguirre", "GABRIEL HERNAN AGUIRRE"],
  ["i-agosta", "HORACIO AGOSTA"],
  ["i-picart", "ROBERTO ORLANDO PICART"],
  ["i-echeverria", "NESTOR DANIEL ECHEVERRÍA"],
  ["i-gallastegui", "LUCAS GALLASTEGUI"],
  ["i-piparo", "LAUTARO AGUSTIN PIPARO"],
  ["i-mendizabal", "LUCAS EZEQUIEL MENDIZABAL"],
  ["i-garcia", "GERONIMO GARCIA ARIAS"],
]);

const resuelto = resolverElCatalogo(CATALOGO, PADRON, NOMBRES);
const porNombre = (n: string) => resuelto.find((o) => o.nombre === n)!;

describe("resolver el catalogo de operarios contra el padron", () => {
  it("devuelve una entrada por fila del catalogo", () => {
    expect(resuelto).toHaveLength(CATALOGO.length);
  });

  it("resuelve los siete nombres que caen en una sola persona", () => {
    const unoSolo = [
      ["Agosta", "i-agosta"],
      ["Aguirre", "i-aguirre"],
      ["Echeverria", "i-echeverria"],
      ["Garcia", "i-garcia"],
      ["Mendizabal", "i-mendizabal"],
      ["Picart", "i-picart"],
      ["Piparo", "i-piparo"],
    ];
    for (const [nombre, id] of unoSolo) {
      expect(porNombre(nombre).empleadoId).toBe(id);
      expect(porNombre(nombre).porQueNoSeSabe).toBeNull();
    }
  });

  it("«Lucas» nombra a Gallastegui y a Mendizabal, asi que no elige ninguno", () => {
    expect(porNombre("Lucas").empleadoId).toBeNull();
    expect(porNombre("Lucas").porQueNoSeSabe).toBe("nombra-a-mas-de-uno");
  });

  it("«Lopez» no esta en el padron, y se ofrece igual", () => {
    expect(porNombre("Lopez").empleadoId).toBeNull();
    expect(porNombre("Lopez").porQueNoSeSabe).toBe("no-esta-en-el-padron");
  });

  it("«Ambos» no es una persona y sale como que no esta en el padron", () => {
    expect(porNombre("Ambos").empleadoId).toBeNull();
    expect(porNombre("Ambos").porQueNoSeSabe).toBe("no-esta-en-el-padron");
  });

  it("conserva el slot y el nombre tal cual, sin tocarles una letra", () => {
    expect(resolverElCatalogo([{ slot: 3, nombre: "Piparo" }], PADRON, NOMBRES)[0])
      .toMatchObject({ nombre: "Piparo", slot: 3 });
  });

  it("compara sin tildes ni mayusculas", () => {
    // «Echeverria» contra «NESTOR DANIEL ECHEVERRÍA».
    expect(porNombre("Echeverria").empleadoId).toBe("i-echeverria");
  });

  it("el oficio de la persona viaja, para poder ofrecer primero al que toca", () => {
    expect(porNombre("Piparo").oficio).toBe("mecanico");
    expect(porNombre("Agosta").oficio).toBe("electricista");
  });

  it("un nombre que no resuelve no inventa oficio", () => {
    expect(porNombre("Lopez").oficio).toBeNull();
    expect(porNombre("Lucas").oficio).toBeNull();
  });

  it("una persona en dos filas del padron no la vuelve ambigua", () => {
    const dosFilas = [...PADRON, persona("i-piparo", "mecanico")];
    const r = resolverElCatalogo([{ slot: 3, nombre: "Piparo" }], dosFilas, NOMBRES);
    expect(r[0].empleadoId).toBe("i-piparo");
    expect(r[0].porQueNoSeSabe).toBeNull();
  });

  it("con el padron vacio todos salen sin resolver y ninguno se cae", () => {
    const r = resolverElCatalogo(CATALOGO, [], new Map());
    expect(r).toHaveLength(CATALOGO.length);
    expect(r.every((o) => o.porQueNoSeSabe === "no-esta-en-el-padron")).toBe(true);
  });

  it("si Lopez entra al padron, deja de ser un nombre sin resolver", () => {
    const con = [...PADRON, persona("i-lopez", "mecanico")];
    const nombres = new Map(NOMBRES).set("i-lopez", "RAUL ARGENTINO LOPEZ");
    const r = resolverElCatalogo([{ slot: 1, nombre: "Lopez" }], con, nombres);
    expect(r[0].empleadoId).toBe("i-lopez");
    expect(r[0].porQueNoSeSabe).toBeNull();
  });
});
