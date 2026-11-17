import { describe, it, expect } from "vitest";
import { contarAusenciasDesde, lineaDeAusencias } from "./ausenciasRecientes";

/**
 * Un PostgREST de mentira, con el mismo molde que el de `lib/home/`. Guarda
 * con qué se lo llamó, porque **cuál columna se filtra es el contrato**: por
 * `fecha_desde` esta cuenta no diría nunca que se acaba de cargar algo.
 */
function clienteFalso(opciones: { count?: number; error?: string }) {
  const filtros: { columna: string; valor: string }[] = [];

  const consulta = () => {
    const self: Record<string, unknown> = {};
    self.select = () => self;
    self.gte = (columna: string, valor: string) => {
      filtros.push({ columna, valor });
      return Promise.resolve(
        opciones.error
          ? { count: null, error: { message: opciones.error } }
          : { count: opciones.count ?? 0, error: null }
      );
    };
    return self;
  };

  return { cliente: { from: consulta } as never, filtros };
}

describe("lineaDeAusencias", () => {
  it("sin ninguna no genera linea", () => {
    expect(lineaDeAusencias(0)).toBeNull();
  });

  it("una sola se dice en singular", () => {
    expect(lineaDeAusencias(1)).toEqual({
      id: "rrhh-ausencias-cargadas",
      titulo: "Se cargó una ausencia",
      cantidad: 1,
      href: "/rrhh/ausencias",
    });
  });

  it("varias dicen cuantas", () => {
    expect(lineaDeAusencias(105)?.titulo).toBe("Se cargaron 105 ausencias");
  });

  // Dos es plural: el limite del singular es exactamente 1.
  it("dos ya es plural", () => {
    expect(lineaDeAusencias(2)?.titulo).toBe("Se cargaron 2 ausencias");
  });

  // Un numero negativo no deberia llegar nunca, pero si llega no se inventa
  // una linea que diga "Se cargaron -3 ausencias".
  it("un numero imposible no genera linea", () => {
    expect(lineaDeAusencias(-3)).toBeNull();
  });
});

describe("contarAusenciasDesde", () => {
  /*
   * EL TEST QUE IMPORTA DE ESTE ARCHIVO.
   *
   * La mediana entre que una ausencia empieza y que alguien la carga es de 33
   * dias —medido sobre las 163 que habia—, y la fila mas reciente de
   * produccion al 16/11/2026 tiene `fecha_desde` del 02/11 y `created_at` del
   * 16/11: catorce dias. Filtrar por `fecha_desde` no diria nunca que se acaba
   * de cargar algo, que es justo lo unico que esto tiene que contestar.
   */
  it("cuenta por created_at y no por la fecha de la ausencia", async () => {
    const { cliente, filtros } = clienteFalso({ count: 3 });
    const r = await contarAusenciasDesde(cliente, "2026-11-16T14:45:00Z");

    expect(r).toEqual({ cuantas: 3 });
    expect(filtros).toEqual([{ columna: "created_at", valor: "2026-11-16T14:45:00Z" }]);
  });

  it("sin ninguna devuelve cero", async () => {
    const { cliente } = clienteFalso({ count: 0 });
    expect(await contarAusenciasDesde(cliente, "2026-11-16T14:45:00Z")).toEqual({ cuantas: 0 });
  });

  /*
   * Un error no es un cero. El cron no manda nada en los dos casos, pero uno
   * se registra y el otro no: un cero silencioso todos los dias es
   * indistinguible de que no se cargue ninguna ausencia.
   */
  it("si la base falla devuelve el motivo y no tira", async () => {
    const { cliente } = clienteFalso({ error: "se corto la conexion" });
    expect(await contarAusenciasDesde(cliente, "2026-11-16T14:45:00Z")).toEqual({
      cuantas: 0,
      error: "se corto la conexion",
    });
  });

  // PostgREST devuelve `count: null` en un head sin filas en algunas versiones.
  it("un count nulo se lee como cero y no como NaN", async () => {
    const { cliente } = clienteFalso({ count: undefined });
    expect((await contarAusenciasDesde(cliente, "2026-11-16T14:45:00Z")).cuantas).toBe(0);
  });
});
