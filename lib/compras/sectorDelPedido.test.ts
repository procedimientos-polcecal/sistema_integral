import { describe, it, expect } from "vitest";
import {
  AMBAS, empresaSugerida, equiposDelSector, elEquipoSigueValiendo, loQueDiceLaUbicacion,
  type SectorDePlanta,
} from "./sectorDelPedido";

const POLCECAL = "emp-polcecal";
const POLYSAN = "emp-polysan";

const sector = (p: Partial<SectorDePlanta>): SectorDePlanta => ({
  id: "s", nombre: "Sector", empresa_id: null, transversal: null, ...p,
});

describe("que empresa se sugiere segun el sector", () => {
  it("un sector de una empresa sugiere esa empresa", () => {
    // Medido contra la base: Calcinacion, Molienda cal y las tres Trituraciones
    // son de POLCECAL; los tres Filler y Planta 02, de POLYSAN.
    expect(empresaSugerida(sector({ nombre: "Calcinación", empresa_id: POLCECAL }))).toBe(POLCECAL);
    expect(empresaSugerida(sector({ nombre: "Filler 1", empresa_id: POLYSAN }))).toBe(POLYSAN);
  });

  it("un sector transversal sugiere Ambas", () => {
    // Compresores y Equipos moviles sirven a las dos plantas. "Ambas" no es un
    // invento del formulario: es un valor que el pedido ya sabe expresar.
    expect(empresaSugerida(sector({ nombre: "Compresores", transversal: true }))).toBe(AMBAS);
  });

  it("si el sector no dice nada, no se sugiere nada", () => {
    // Null es "no tengo con que contestar", y entonces el campo se deja como
    // esta. Inventar una empresa seria exactamente la decision disfrazada de
    // dato que este modulo evita en todos lados.
    expect(empresaSugerida(sector({ nombre: "Administración" }))).toBeNull();
    expect(empresaSugerida(undefined)).toBeNull();
    expect(empresaSugerida(null)).toBeNull();
  });

  it("la empresa le gana a transversal si estan las dos", () => {
    // No deberia pasar, pero si pasa: lo concreto manda sobre lo generico.
    expect(empresaSugerida(sector({ empresa_id: POLCECAL, transversal: true }))).toBe(POLCECAL);
  });
});

const EQUIPOS = [
  { id: "e1", sector_id: "calcinacion" },
  { id: "e2", sector_id: "calcinacion" },
  { id: "e3", sector_id: "filler1" },
];

describe("que equipos se ofrecen", () => {
  it("elegir un sector recorta la lista", () => {
    expect(equiposDelSector(EQUIPOS, "calcinacion").map((e) => e.id)).toEqual(["e1", "e2"]);
  });

  it("sin sector se ofrecen todos, no ninguno", () => {
    // El sector es opcional: vaciar el desplegable porque todavia no lo
    // eligieron seria trabar el formulario por un campo que nadie pidio llenar.
    expect(equiposDelSector(EQUIPOS, "")).toHaveLength(3);
  });

  it("un sector sin equipos da una lista vacia, no todos", () => {
    // Es la diferencia con el caso de arriba: aca SI eligieron, y la respuesta
    // honesta es "este sector no tiene equipos cargados".
    expect(equiposDelSector(EQUIPOS, "hidratacion")).toEqual([]);
  });
});

describe("si el equipo ya elegido sigue valiendo", () => {
  it("deja de valer cuando se elige un sector que no es el suyo", () => {
    // Si no se limpiara, el pedido viajaria con un equipo que no esta en la
    // lista que se ve en pantalla: nadie lo puede revisar antes de mandarlo, y
    // despues aparece en la ficha contradiciendo al sector.
    expect(elEquipoSigueValiendo(EQUIPOS, "e3", "calcinacion")).toBe(false);
  });

  it("sigue valiendo si es del sector elegido", () => {
    expect(elEquipoSigueValiendo(EQUIPOS, "e1", "calcinacion")).toBe(true);
  });

  it("sin equipo o sin sector no hay nada que limpiar", () => {
    expect(elEquipoSigueValiendo(EQUIPOS, "", "calcinacion")).toBe(true);
    expect(elEquipoSigueValiendo(EQUIPOS, "e3", "")).toBe(true);
  });
});

describe("que se deduce de donde se necesita", () => {
  const EQUIPOS2 = [
    { id: "cat320b", sector_id: "moviles" },
    { id: "molino", sector_id: "molienda" },
  ];

  it("un lugar que es una maquina elige el equipo, y el sector sale DEL EQUIPO", () => {
    // "CAT 320B" es un equipo, no un lugar. El sector se lee del equipo y no
    // del enlace: es el equipo el que sabe a cual pertenece, y leerlo de otro
    // lado abriria la puerta a que digan cosas distintas.
    expect(
      loQueDiceLaUbicacion({ sector_id: "otro-cualquiera", equipo_id: "cat320b" }, EQUIPOS2)
    ).toEqual({ sectorId: "moviles", equipoId: "cat320b" });
  });

  it("un lugar que es un sector da el sector y deja el equipo libre", () => {
    expect(loQueDiceLaUbicacion({ sector_id: "molienda", equipo_id: null }, EQUIPOS2)).toEqual({
      sectorId: "molienda",
      equipoId: "",
    });
  });

  it("un lugar sin enlace no deduce nada", () => {
    // Taller Electrico, OTRA y Oficinas: las tres mas usadas estan aca, asi
    // que este es el camino normal y no el raro.
    expect(loQueDiceLaUbicacion({ sector_id: null, equipo_id: null }, EQUIPOS2)).toEqual({
      sectorId: "",
      equipoId: "",
    });
    expect(loQueDiceLaUbicacion(undefined, EQUIPOS2)).toEqual({ sectorId: "", equipoId: "" });
  });

  it("un equipo que ya no esta en la lista no se elige", () => {
    // El catalogo de ubicaciones puede apuntar a un equipo dado de baja. Elegir
    // un id que el desplegable no muestra seria mandar un dato que nadie puede
    // revisar; se cae al sector del enlace, que si se puede.
    expect(
      loQueDiceLaUbicacion({ sector_id: "molienda", equipo_id: "dado-de-baja" }, EQUIPOS2)
    ).toEqual({ sectorId: "molienda", equipoId: "" });
  });
});
