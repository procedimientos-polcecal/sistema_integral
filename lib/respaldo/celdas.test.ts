import { describe, it, expect } from "vitest";
import { desdeHace, fecha, hora, nombreDe, numero, quien, si, uno } from "./celdas";

/**
 * Lo que se fija acá es lo único del respaldo que puede estar mal sin que nada
 * avise. Una consulta que falla deja la pestaña vacía y se ve; una hora corrida
 * tres horas se ve bien y es mentira.
 */

describe("hora", () => {
  /*
   * El caso que importa. `hora_entrada` se guarda como instante UTC y la
   * pantalla lo muestra en hora de Argentina (`formatHora` de
   * `FichadasClient`). Si el respaldo no hace la misma conversión, dice algo
   * distinto de lo que respalda.
   *
   * Es una fichada real del padrón, la primera que devuelve la instantánea.
   */
  it("convierte el instante UTC a hora de Argentina", () => {
    expect(hora("2026-08-19T07:05:00+00:00")).toBe("04:05");
    expect(hora("2026-08-19T15:17:00+00:00")).toBe("12:17");
  });

  it("acepta la forma con Z, que es como la escribe el importador", () => {
    expect(hora("2026-08-19T07:05:00Z")).toBe("04:05");
  });

  // Argentina no tiene horario de verano desde 2009, así que el desfasaje es
  // -3 todo el año. Se fija un día de enero para que, si alguien algún día lo
  // reintroduce, este test lo diga en vez de que lo descubra una liquidación.
  it("usa -3 también en verano", () => {
    expect(hora("2026-01-15T07:05:00Z")).toBe("04:05");
  });

  // Un instante de la madrugada UTC cae el día anterior acá: la hora tiene que
  // ser la de Argentina igual, aunque la fecha de la fila sea la otra.
  it("cruza la medianoche hacia atrás", () => {
    expect(hora("2026-08-19T01:30:00Z")).toBe("22:30");
  });

  it("devuelve vacío y no NaN cuando no hay salida", () => {
    expect(hora(null)).toBe("");
    expect(hora(undefined)).toBe("");
    expect(hora("")).toBe("");
    expect(hora("cualquier cosa")).toBe("");
  });
});

describe("fecha", () => {
  // Serial y no texto: con `USER_ENTERED` un "05/10/2026" lo interpreta la
  // planilla según su locale. El serial 46000 es un día concreto y no se
  // discute.
  it("convierte una fecha ISO en serial de Sheets", () => {
    // 1899-12-30 es el origen del serial de Sheets.
    expect(fecha("1899-12-30")).toBe(0);
    expect(fecha("1900-01-01")).toBe(2);
  });

  it("se queda con el día de un timestamp completo", () => {
    expect(fecha("2026-10-05T11:06:26+00:00")).toBe(fecha("2026-10-05"));
  });

  it("devuelve vacío en vez de una fecha inventada", () => {
    expect(fecha(null)).toBe("");
    expect(fecha("")).toBe("");
    expect(fecha("05/10/2026")).toBe("");
    // El 30 de febrero rodaría al 2 de marzo: `serialDelDia` lo rechaza.
    expect(fecha("2026-02-30")).toBe("");
  });
});

describe("uno / quien / nombreDe", () => {
  const persona = { legajo: "PC_198", apellido: "SANDOVAL", nombre: "MATIAS" };

  // Las dos formas del embed conviven en el proyecto según lo que infiera
  // Supabase. Las dos tienen que dar lo mismo.
  it("resuelve el embed venga como objeto o como arreglo", () => {
    expect(uno(persona)).toEqual(persona);
    expect(uno([persona])).toEqual(persona);
    expect(uno(null)).toBeNull();
    expect(uno([])).toBeNull();
  });

  it("arma APELLIDO, Nombre", () => {
    expect(quien(persona)).toBe("SANDOVAL, MATIAS");
    expect(quien([persona])).toBe("SANDOVAL, MATIAS");
  });

  // Sin nombre queda el legajo y no una celda vacía: una fila de asistencia sin
  // ninguna forma de saber de quién es no sirve para nada en un respaldo.
  it("cae al legajo cuando no hay nombre", () => {
    expect(quien({ legajo: "PC_198", apellido: null, nombre: null })).toBe("PC_198");
  });

  it("devuelve vacío si no vino el embed", () => {
    expect(quien(null)).toBe("");
    expect(nombreDe(null)).toBe("");
  });

  it("lee el nombre de un catálogo", () => {
    expect(nombreDe({ nombre: "Producción - Despacho" })).toBe("Producción - Despacho");
    expect(nombreDe([{ nombre: "Pasantes" }])).toBe("Pasantes");
  });
});

describe("numero", () => {
  // Supabase devuelve los `numeric` como string en algunos embeds y como
  // número en otros. Las dos tienen que llegar como número a la celda: un
  // "8.00" como texto lo interpreta la planilla según su locale.
  it("acepta número y string", () => {
    expect(numero(8)).toBe(8);
    expect(numero("8.00")).toBe(8);
    expect(numero(324.42)).toBe(324.42);
  });

  it("nunca deja NaN ni null en una celda", () => {
    expect(numero(null)).toBe("");
    expect(numero(undefined)).toBe("");
    expect(numero("")).toBe("");
    expect(numero("ocho")).toBe("");
  });

  // El 0 es un dato: cero horas extra no es lo mismo que sin calcular.
  it("conserva el cero", () => {
    expect(numero(0)).toBe(0);
    expect(numero("0.00")).toBe(0);
  });
});

describe("si", () => {
  it("marca sólo lo que es verdadero", () => {
    expect(si(true)).toBe("SI");
    expect(si(false)).toBe("");
    expect(si(null)).toBe("");
  });
});

describe("desdeHace", () => {
  it("resta los días pedidos", () => {
    expect(desdeHace("2026-10-18", 60)).toBe("2026-08-19");
    expect(desdeHace("2026-10-18", 0)).toBe("2026-10-18");
  });

  // Cruza meses y años sin ayuda, que es lo que rompe una resta hecha a mano
  // sobre los componentes de la fecha.
  it("cruza el año", () => {
    expect(desdeHace("2026-01-05", 10)).toBe("2025-12-26");
  });

  it("cruza un 29 de febrero", () => {
    expect(desdeHace("2028-03-01", 1)).toBe("2028-02-29");
  });
});
