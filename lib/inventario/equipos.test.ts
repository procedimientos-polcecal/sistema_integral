import { describe, it, expect } from "vitest";
import { filaDeSectorYEquipo, equiposQueCambian } from "./equipos";
import { indiceDeEquipos } from "./enlaces";

describe("una fila de la pestana Sectores/Equipos", () => {
  it("devuelve el par con los dos lados recortados", () => {
    expect(filaDeSectorYEquipo(["  PLANTA TRITURACIÓN 1 ", " PO-A1-01 - ACARREADOR DE PLACAS "]))
      .toEqual({ sector: "PLANTA TRITURACIÓN 1", equipo: "PO-A1-01 - ACARREADOR DE PLACAS" });
  });

  it("descarta la fila que solo trae el sector", () => {
    expect(filaDeSectorYEquipo(["FILLER 1", ""])).toBeNull();
  });

  it("descarta la fila que solo trae el equipo", () => {
    expect(filaDeSectorYEquipo(["", "PO-A1-01 - ACARREADOR DE PLACAS"])).toBeNull();
  });

  it("descarta la fila vacia y la fila corta", () => {
    expect(filaDeSectorYEquipo(["", ""])).toBeNull();
    expect(filaDeSectorYEquipo([])).toBeNull();
  });

  /** El guion es como estas planillas escriben el vacio. */
  it("descarta la fila con un guion suelto de cualquiera de los dos lados", () => {
    expect(filaDeSectorYEquipo(["-", "PO-A1-01 - ACARREADOR DE PLACAS"])).toBeNull();
    expect(filaDeSectorYEquipo(["FILLER 1", "-"])).toBeNull();
  });
});

const DESTINOS = [
  { id: "d1", nombre: "PLANTA TRITURACIÓN 1" },
  { id: "d2", nombre: "FILLER 2" },
  { id: "d3", nombre: "PAÑOL" },
];

/**
 * El indice del nucleo, armado con la funcion de verdad y no a mano: las claves
 * las decide `claveDeProveedor`, que conserva los guiones —"PO-A1-01" queda
 * "po-a1-01"—, y un test que las escriba a mano se rompe si eso cambia.
 */
const NUCLEO = indiceDeEquipos([
  { id: "e1", code: "PO-A1-01", name: "Acarreador de placas" },
  { id: "e5", code: "PY-B1-05", name: "Cinta transportadora 3" },
]);

describe("que cambia en la lista de equipos", () => {
  it("inserta lo que la pestana trae y la lista no tiene", () => {
    const cambios = equiposQueCambian(
      [{ sector: "PLANTA TRITURACIÓN 1", equipo: "PO-A1-01 - ACARREADOR DE PLACAS" }],
      [],
      DESTINOS,
      NUCLEO
    );
    expect(cambios.nuevos).toEqual([
      { nombre: "PO-A1-01 - ACARREADOR DE PLACAS", destino_id: "d1", equipment_id: "e1" },
    ]);
    expect(cambios.actualizados).toEqual([]);
    expect(cambios.desactivados).toEqual([]);
  });

  it("no toca el que ya esta igual", () => {
    const cambios = equiposQueCambian(
      [{ sector: "PLANTA TRITURACIÓN 1", equipo: "PO-A1-01 - ACARREADOR DE PLACAS" }],
      [{ id: "x1", nombre: "PO-A1-01 - ACARREADOR DE PLACAS", destino_id: "d1", equipment_id: "e1", activo: true }],
      DESTINOS,
      NUCLEO
    );
    expect(cambios).toEqual({
      nuevos: [], actualizados: [], desactivados: [], sinDestino: [], enDosSectores: [],
    });
  });

  it("actualiza el que cambio de sector en la pestana", () => {
    const cambios = equiposQueCambian(
      [{ sector: "FILLER 2", equipo: "PO-A1-01 - ACARREADOR DE PLACAS" }],
      [{ id: "x1", nombre: "PO-A1-01 - ACARREADOR DE PLACAS", destino_id: "d1", equipment_id: "e1", activo: true }],
      DESTINOS,
      NUCLEO
    );
    expect(cambios.actualizados).toEqual([
      { id: "x1", nombre: "PO-A1-01 - ACARREADOR DE PLACAS", destino_id: "d2", equipment_id: "e1", activo: true },
    ]);
    expect(cambios.nuevos).toEqual([]);
  });

  it("reactiva el que habia desaparecido y volvio", () => {
    const cambios = equiposQueCambian(
      [{ sector: "PLANTA TRITURACIÓN 1", equipo: "PO-A1-01 - ACARREADOR DE PLACAS" }],
      [{ id: "x1", nombre: "PO-A1-01 - ACARREADOR DE PLACAS", destino_id: "d1", equipment_id: "e1", activo: false }],
      DESTINOS,
      NUCLEO
    );
    expect(cambios.actualizados).toEqual([
      { id: "x1", nombre: "PO-A1-01 - ACARREADOR DE PLACAS", destino_id: "d1", equipment_id: "e1", activo: true },
    ]);
  });

  /**
   * No se borra: los movimientos historicos le apuntan, y un error de lectura
   * de la pestana vaciaria el select sin que nadie se entere.
   */
  it("desactiva el que ya no esta en la pestana, y no lo borra", () => {
    const cambios = equiposQueCambian(
      [],
      [{ id: "x1", nombre: "PO-A1-01 - ACARREADOR DE PLACAS", destino_id: "d1", equipment_id: "e1", activo: true }],
      DESTINOS,
      NUCLEO
    );
    expect(cambios.desactivados).toEqual(["x1"]);
    expect(cambios.nuevos).toEqual([]);
    expect(cambios.actualizados).toEqual([]);
  });

  it("no vuelve a desactivar al que ya esta inactivo", () => {
    const cambios = equiposQueCambian(
      [],
      [{ id: "x1", nombre: "PO-A1-01 - ACARREADOR DE PLACAS", destino_id: "d1", equipment_id: "e1", activo: false }],
      DESTINOS,
      NUCLEO
    );
    expect(cambios.desactivados).toEqual([]);
  });

  /**
   * Un sector que no esta en `inventario_destinos` se informa; no se le inventa
   * un destino ni se lo cuelga del que se le parece. Es lo que hay que agregar.
   */
  it("informa el sector que no es un destino conocido, y no inserta el equipo", () => {
    const cambios = equiposQueCambian(
      [
        { sector: "GALPONES", equipo: "GALPON 5" },
        { sector: "PLANTA TRITURACIÓN 1", equipo: "PO-A1-01 - ACARREADOR DE PLACAS" },
      ],
      [],
      DESTINOS,
      NUCLEO
    );
    expect(cambios.sinDestino).toEqual(["GALPONES"]);
    expect(cambios.nuevos.map((n) => n.nombre)).toEqual(["PO-A1-01 - ACARREADOR DE PLACAS"]);
  });

  it("informa cada sector desconocido una sola vez y ordenado", () => {
    const cambios = equiposQueCambian(
      [
        { sector: "GALPONES", equipo: "GALPON 5" },
        { sector: "BALANZA", equipo: "BALANZA" },
        { sector: "GALPONES", equipo: "GALPON 1" },
      ],
      [],
      DESTINOS,
      NUCLEO
    );
    expect(cambios.sinDestino).toEqual(["BALANZA", "GALPONES"]);
  });

  /** Los oficios y los lugares no son equipos del nucleo: quedan en null. */
  it("el equipo que no es del nucleo entra con equipment_id en null", () => {
    const cambios = equiposQueCambian(
      [{ sector: "PAÑOL", equipo: "PAÑOL" }],
      [],
      DESTINOS,
      NUCLEO
    );
    expect(cambios.nuevos).toEqual([
      { nombre: "PAÑOL", destino_id: "d3", equipment_id: null },
    ]);
  });

  it("el destino se reconoce sin importar acentos ni mayusculas", () => {
    const cambios = equiposQueCambian(
      [{ sector: "planta trituracion 1", equipo: "PY-B1-05 - CINTA TRANSPORTADORA 3" }],
      [],
      DESTINOS,
      NUCLEO
    );
    expect(cambios.nuevos[0]?.destino_id).toBe("d1");
  });

  it("un sector que no resuelve NO apaga al equipo que ya estaba en la lista", () => {
    const cambios = equiposQueCambian(
      [{ sector: "SECTOR QUE NADIE CARGO", equipo: "PO-A1-01 - ACARREADOR DE PLACAS" }],
      [{ id: "x1", nombre: "PO-A1-01 - ACARREADOR DE PLACAS", destino_id: "d1", equipment_id: "e1", activo: true }],
      DESTINOS,
      NUCLEO
    );
    expect(cambios.desactivados).toEqual([]);
    expect(cambios.actualizados).toEqual([]);
    expect(cambios.sinDestino).toEqual(["SECTOR QUE NADIE CARGO"]);
  });

  it("y tampoco lo inserta si no estaba", () => {
    const cambios = equiposQueCambian(
      [{ sector: "SECTOR QUE NADIE CARGO", equipo: "PO-A1-01 - ACARREADOR DE PLACAS" }],
      [],
      DESTINOS,
      NUCLEO
    );
    expect(cambios.nuevos).toEqual([]);
    expect(cambios.sinDestino).toEqual(["SECTOR QUE NADIE CARGO"]);
  });

  it("refresca el literal guardado cuando la pestana lo reescribe sin cambiar la clave", () => {
    const cambios = equiposQueCambian(
      [{ sector: "PLANTA TRITURACIÓN 1", equipo: "PO-A1-01 - ACARREADOR DE PLACAS" }],
      [{ id: "x1", nombre: "PO-A1-01 -  Acarreador De Placas", destino_id: "d1", equipment_id: "e1", activo: true }],
      DESTINOS,
      NUCLEO
    );
    expect(cambios.actualizados).toEqual([
      { id: "x1", nombre: "PO-A1-01 - ACARREADOR DE PLACAS", destino_id: "d1", equipment_id: "e1", activo: true },
    ]);
    expect(cambios.nuevos).toEqual([]);
    expect(cambios.desactivados).toEqual([]);
  });

  it("la pestana repetida no inserta dos veces el mismo equipo", () => {
    const cambios = equiposQueCambian(
      [
        { sector: "PLANTA TRITURACIÓN 1", equipo: "PO-A1-01 - ACARREADOR DE PLACAS" },
        { sector: "PLANTA TRITURACIÓN 1", equipo: "PO-A1-01 - ACARREADOR DE PLACAS" },
      ],
      [],
      DESTINOS,
      NUCLEO
    );
    expect(cambios.nuevos).toHaveLength(1);
  });

  it("informa el equipo que la pestana pone bajo dos sectores, y no lo toca", () => {
    const cambios = equiposQueCambian(
      [
        { sector: "PLANTA TRITURACIÓN 1", equipo: "PO-A1-01 - ACARREADOR DE PLACAS" },
        { sector: "FILLER 2", equipo: "PO-A1-01 - ACARREADOR DE PLACAS" },
      ],
      [],
      DESTINOS,
      NUCLEO
    );
    expect(cambios.enDosSectores).toEqual(["PO-A1-01 - ACARREADOR DE PLACAS"]);
    expect(cambios.nuevos).toEqual([]);
  });

  it("un equipo ambiguo que ya estaba en la lista no se apaga ni se actualiza", () => {
    const cambios = equiposQueCambian(
      [
        { sector: "PLANTA TRITURACIÓN 1", equipo: "PO-A1-01 - ACARREADOR DE PLACAS" },
        { sector: "FILLER 2", equipo: "PO-A1-01 - ACARREADOR DE PLACAS" },
      ],
      [{ id: "x1", nombre: "PO-A1-01 - ACARREADOR DE PLACAS", destino_id: "d1", equipment_id: "e1", activo: true }],
      DESTINOS,
      NUCLEO
    );
    expect(cambios.enDosSectores).toEqual(["PO-A1-01 - ACARREADOR DE PLACAS"]);
    expect(cambios.desactivados).toEqual([]);
    expect(cambios.actualizados).toEqual([]);
  });

  /** El mismo sector escrito de dos formas no es una ambiguedad: es un sector. */
  it("el mismo sector escrito distinto no cuenta como dos sectores", () => {
    const cambios = equiposQueCambian(
      [
        { sector: "PLANTA TRITURACIÓN 1", equipo: "PO-A1-01 - ACARREADOR DE PLACAS" },
        { sector: "planta trituracion 1", equipo: "PO-A1-01 - ACARREADOR DE PLACAS" },
      ],
      [],
      DESTINOS,
      NUCLEO
    );
    expect(cambios.enDosSectores).toEqual([]);
    expect(cambios.nuevos).toHaveLength(1);
  });
});
