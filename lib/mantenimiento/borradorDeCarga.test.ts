import { describe, it, expect } from "vitest";
import { borradorDesdeElCuerpo } from "./borradorDeCarga";

const VACIO = {
  descripcion: "",
  horas: "",
  tipo: "CORRECTIVO",
  requiere_parada_sector: false,
};

describe("borradorDesdeElCuerpo", () => {
  it("sin cuerpo devuelve el formulario vacío tal cual", () => {
    expect(borradorDesdeElCuerpo(VACIO, null)).toEqual(VACIO);
    expect(borradorDesdeElCuerpo(VACIO, undefined)).toEqual(VACIO);
  });

  it("pisa lo que el cuerpo nombra y deja el resto como estaba", () => {
    expect(borradorDesdeElCuerpo(VACIO, { descripcion: "cambiar correa" })).toEqual({
      ...VACIO,
      descripcion: "cambiar correa",
    });
  });

  it("un número del cuerpo entra como texto: el input lo necesita así", () => {
    // `horas` viaja a la ruta como número y vuelve como número. Un `<input>`
    // con `value={0}` y `onChange` que guarda texto es el camino corto al
    // warning de React y a un campo que no se puede borrar.
    expect(borradorDesdeElCuerpo(VACIO, { horas: 2.5 }).horas).toBe("2.5");
    expect(borradorDesdeElCuerpo(VACIO, { horas: 0 }).horas).toBe("0");
  });

  it("el casillero entra como booleano, venga como venga", () => {
    expect(borradorDesdeElCuerpo(VACIO, { requiere_parada_sector: true })
      .requiere_parada_sector).toBe(true);
    expect(borradorDesdeElCuerpo(VACIO, { requiere_parada_sector: false })
      .requiere_parada_sector).toBe(false);
  });

  it("un null del cuerpo no pisa: es «no vino», no «está vacío»", () => {
    // La ruta recibe `equipment_id: null` cuando no se eligió equipo, y el
    // cuerpo guardado los tiene así. Pisar con "" daría igual acá, pero con
    // `tipo`, que arranca en CORRECTIVO, borraría el valor por defecto.
    expect(borradorDesdeElCuerpo(VACIO, { tipo: null }).tipo).toBe("CORRECTIVO");
    expect(borradorDesdeElCuerpo(VACIO, { tipo: undefined }).tipo).toBe("CORRECTIVO");
  });

  it("un objeto o un arreglo se descartan en vez de quedar como [object Object]", () => {
    expect(borradorDesdeElCuerpo(VACIO, { descripcion: { a: 1 } }).descripcion).toBe("");
    expect(borradorDesdeElCuerpo(VACIO, { descripcion: ["a"] }).descripcion).toBe("");
  });

  it("lo que el cuerpo trae de más no entra al formulario", () => {
    // `clave`, `equipo_raw` y `equipo_code` viajan en el cuerpo y no son campos
    // del formulario. Una carga vieja con otros campos tiene que entrar igual.
    const salida = borradorDesdeElCuerpo(VACIO, {
      clave: "uuid-1",
      equipo_raw: "B-12 – Molino",
      campo_que_ya_no_existe: "x",
    });
    expect(salida).toEqual(VACIO);
    expect(Object.keys(salida)).toEqual(Object.keys(VACIO));
  });

  it("no toca el objeto que recibe", () => {
    const vacio = { ...VACIO };
    borradorDesdeElCuerpo(vacio, { descripcion: "otra cosa" });
    expect(vacio).toEqual(VACIO);
  });
});
