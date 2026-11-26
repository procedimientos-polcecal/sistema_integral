import { describe, expect, it } from "vitest";
import { filasDelCsv, loQueCambiaElArchivo, type FilaDelArchivo } from "./padronDesdeElArchivo";

const fila = (p: Partial<FilaDelArchivo>): FilaDelArchivo => ({
  linea: 2,
  id: "11111111-1111-1111-1111-111111111111",
  nombre: "FUNDICIONES NAVARRO",
  cuit: null,
  razonSocial: null,
  ...p,
});

// 30710597363 y 30714412333 son CUITs reales del padrón: el dígito verificador
// cierra, que es lo que este módulo comprueba.
const NAVARRO = "30710597363";
const MARFRA = "30714412333";

const padron = [
  { id: "11111111-1111-1111-1111-111111111111", nombre: "FUNDICIONES NAVARRO", cuit: null, razonSocial: null },
  { id: "22222222-2222-2222-2222-222222222222", nombre: "Fundición Navarro", cuit: NAVARRO, razonSocial: null },
  { id: "33333333-3333-3333-3333-333333333333", nombre: "MARFRA", cuit: null, razonSocial: null },
];

describe("lo que se escribe", () => {
  it("el CUIT que no tiene nadie más, con su razón social", () => {
    const r = loQueCambiaElArchivo(
      [fila({ id: "33333333-3333-3333-3333-333333333333", nombre: "MARFRA", cuit: MARFRA, razonSocial: "FERRETERIA MARFRA S.R.L." })],
      padron
    );
    expect(r.aGuardar).toEqual([
      {
        proveedorId: "33333333-3333-3333-3333-333333333333",
        nombre: "MARFRA",
        cuit: MARFRA,
        razonSocial: "FERRETERIA MARFRA S.R.L.",
      },
    ]);
  });

  it("y le da igual cómo esté escrito el CUIT en el archivo", () => {
    const r = loQueCambiaElArchivo(
      [fila({ id: "33333333-3333-3333-3333-333333333333", cuit: "30-71441233-3" })],
      padron
    );
    expect(r.aGuardar[0].cuit).toBe(MARFRA);
  });

  /*
   * El id viaja por Excel y vuelve en mayúscula. Un uuid es el mismo valor
   * escrito de las dos formas, pero el índice es un Map de texto: sin esto, las
   * 209 filas caerían en «no está en el padrón».
   */
  it("el id vuelve en mayúscula de Excel y sigue siendo el mismo", () => {
    const r = loQueCambiaElArchivo(
      [fila({ id: "33333333-3333-3333-3333-333333333333".toUpperCase(), cuit: MARFRA })],
      padron
    );
    expect(r.aGuardar).toHaveLength(1);
    expect(r.noEstaEnElPadron).toHaveLength(0);
  });

  it("sin razón social se guarda el CUIT igual", () => {
    const r = loQueCambiaElArchivo([fila({ id: "33333333-3333-3333-3333-333333333333", cuit: MARFRA })], padron);
    expect(r.aGuardar[0].razonSocial).toBeNull();
  });
});

describe("lo que no se escribe", () => {
  /*
   * El caso que decide el diseño. `cruzarProveedores()` no enlaza ningún CUIT
   * que aparezca en dos filas, así que escribirlo acá no conectaría a
   * FUNDICIONES NAVARRO: desconectaría a Fundición Navarro, que hoy funciona.
   */
  it("un CUIT que ya tiene otra fila del padrón: se informa el par y no se toca nada", () => {
    const r = loQueCambiaElArchivo([fila({ cuit: NAVARRO, razonSocial: "FUNDICION ELECTRICA NAVARRO S.A." })], padron);
    expect(r.aGuardar).toHaveLength(0);
    expect(r.cuitDeOtro).toHaveLength(1);
    expect(r.cuitDeOtro[0].otras.map((o) => o.nombre)).toEqual(["Fundición Navarro"]);
  });

  it("dos filas del propio archivo con el mismo CUIT: el par sale igual, no una lista aparte", () => {
    const r = loQueCambiaElArchivo(
      [
        fila({ linea: 2, id: "33333333-3333-3333-3333-333333333333", nombre: "MARFRA", cuit: MARFRA }),
        fila({ linea: 3, id: "11111111-1111-1111-1111-111111111111", nombre: "FERRETERIA MARFRA", cuit: MARFRA }),
      ],
      padron
    );
    expect(r.aGuardar).toHaveLength(0);
    expect(r.cuitDeOtro).toHaveLength(2);
  });

  it("el proveedor ya tenía ese CUIT: no se reescribe", () => {
    const r = loQueCambiaElArchivo(
      [fila({ id: "22222222-2222-2222-2222-222222222222", nombre: "Fundición Navarro", cuit: NAVARRO })],
      padron
    );
    expect(r.aGuardar).toHaveLength(0);
    expect(r.yaLoTenia).toHaveLength(1);
  });

  /** Un dígito mal tipeado engancha facturas de otra empresa y no se nota. */
  it("un CUIT cuyo dígito verificador no cierra", () => {
    const r = loQueCambiaElArchivo([fila({ id: "33333333-3333-3333-3333-333333333333", cuit: "30714412334" })], padron);
    expect(r.aGuardar).toHaveLength(0);
    expect(r.cuitInvalido).toHaveLength(1);
  });

  it("una fila sin id no se adivina por nombre", () => {
    const r = loQueCambiaElArchivo([fila({ id: "", nombre: "CASA BLANCO", cuit: MARFRA })], padron);
    expect(r.aGuardar).toHaveLength(0);
    expect(r.sinId).toEqual([{ linea: 2, nombre: "CASA BLANCO", cuit: MARFRA }]);
  });

  it("un id que ya no está en el padrón", () => {
    const r = loQueCambiaElArchivo([fila({ id: "99999999-9999-9999-9999-999999999999", cuit: MARFRA })], padron);
    expect(r.noEstaEnElPadron).toHaveLength(1);
  });

  it("una fila en blanco no es un error: es lo que se pidió dejar vacío", () => {
    const r = loQueCambiaElArchivo([fila({ cuit: null })], padron);
    expect(r.aGuardar).toHaveLength(0);
    expect(r.cuitInvalido).toHaveLength(0);
    expect(r.cuitDeOtro).toHaveLength(0);
  });
});

describe("el nombre", () => {
  /*
   * `nombre` es con lo que la sincronización de Compras reconoce al proveedor.
   * Escribir el del archivo deja a la planilla sin a quién apuntar y la corrida
   * siguiente crea la fila de nuevo: es el 14/09/2026.
   */
  it("cambiado en el archivo, se informa y no se escribe", () => {
    const r = loQueCambiaElArchivo(
      [fila({ id: "33333333-3333-3333-3333-333333333333", nombre: "FERRETERIA MARFRA S.R.L.", cuit: MARFRA })],
      padron
    );
    expect(r.nombreCambiado).toEqual([
      {
        linea: 2,
        id: "33333333-3333-3333-3333-333333333333",
        enLaBase: "MARFRA",
        enElArchivo: "FERRETERIA MARFRA S.R.L.",
      },
    ]);
    // Se informa, pero la fila se guarda igual: el nombre no es lo que viaja.
    expect(r.aGuardar).toHaveLength(1);
  });

  it("pasado a mayúscula por Excel no es un cambio", () => {
    const r = loQueCambiaElArchivo(
      [fila({ id: "22222222-2222-2222-2222-222222222222", nombre: "FUNDICION NAVARRO" })],
      padron
    );
    expect(r.nombreCambiado).toHaveLength(0);
  });
});

describe("leer el CSV", () => {
  it("una coma adentro de comillas no parte la columna", () => {
    const filas = filasDelCsv('id,nombre,cuit\n1,"CORIA,MAXIMILIANO",30714412333\n');
    expect(filas[1]).toEqual(["1", "CORIA,MAXIMILIANO", "30714412333"]);
  });

  it("dos comillas seguidas son una comilla", () => {
    expect(filasDelCsv('a\n"BAZAR ""LA ESQUINA"""\n')[1]).toEqual(['BAZAR "LA ESQUINA"']);
  });

  /** Salió con `;` y volvió con `,`: Excel guarda con el de su locale. */
  it("reconoce el separador del encabezado", () => {
    expect(filasDelCsv("id;nombre;cuit\n1;MARFRA;30714412333")[1]).toEqual(["1", "MARFRA", "30714412333"]);
  });

  it("una línea en blanco no es una fila", () => {
    expect(filasDelCsv("a,b\n1,2\n\n")).toHaveLength(2);
  });

  it("y el BOM que Excel necesita no se cuela en la primera columna", () => {
    expect(filasDelCsv("﻿id,nombre\n1,MARFRA")[0][0]).toBe("id");
  });
});
