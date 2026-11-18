import { describe, it, expect } from "vitest";
import { contarAusenciasDesde, lineaDeAusencias } from "./ausenciasRecientes";

/**
 * Un PostgREST de mentira, con el mismo molde que el de `lib/home/`. Guarda
 * con qué se lo llamó, porque **cuál columna se filtra es el contrato**: por
 * `fecha_desde` esta cuenta no diría nunca que se acaba de cargar algo.
 */
function clienteFalso(opciones: { count?: number; error?: string }) {
  const filtros: { como: string; columna: string; valor: string }[] = [];

  const consulta = () => {
    const self: Record<string, unknown> = {};
    self.select = () => self;
    const anotar = (como: string) => (columna: string, valor: string) => {
      filtros.push({ como, columna, valor });
      return self;
    };
    self.gte = anotar("gte");
    self.lt = anotar("lt");
    self.then = (r: (v: unknown) => unknown) =>
      Promise.resolve(
        opciones.error
          ? { count: null, error: { message: opciones.error } }
          : { count: opciones.count ?? 0, error: null }
      ).then(r);
    return self;
  };

  return { cliente: { from: consulta } as never, filtros };
}

describe("lineaDeAusencias", () => {
  it("sin ninguna no genera linea", () => {
    expect(lineaDeAusencias(0)).toBeNull();
  });

  /*
   * EL NUMERO NO VA EN EL TITULO, y el diseño decia que si.
   *
   * `resumirElMovimiento` imprime la cantidad como incremento: con el titulo
   * "Se cargaron 3 ausencias" el push decia "3 más · Se cargaron 3 ausencias",
   * o sea el mismo 3 como total y como incremento en la misma linea. El
   * docstring de esa funcion lo prohibe con todas las letras -- "un «3» que
   * ayer era el total y hoy es el incremento es peor que cualquiera de los
   * dos" -- y esta era la unica Notificacion del sistema que nacia siendo un
   * delta en vez de un stock.
   */
  it("el titulo no lleva el numero, porque lo imprime el resumen", () => {
    expect(lineaDeAusencias(1)).toEqual({
      id: "rrhh-ausencias-cargadas",
      titulo: "Ausencias cargadas",
      cantidad: 1,
      href: "/disponibilidad",
    });
    expect(lineaDeAusencias(105)?.titulo).toBe("Ausencias cargadas");
  });

  it("la cantidad es cuantas son", () => {
    expect(lineaDeAusencias(105)?.cantidad).toBe(105);
  });

  /*
   * Le llega a todos, asi que no puede llevar a una pantalla cerrada:
   * `/rrhh/ausencias` pide RRHH y de 16 personas 8 no lo tienen.
   * `/disponibilidad` es transversal y la ve cualquiera con sesion.
   */
  it("lleva a una pantalla que puede abrir cualquiera", () => {
    expect(lineaDeAusencias(3)?.href).toBe("/disponibilidad");
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
    const r = await contarAusenciasDesde(cliente, "2026-11-16T14:45:00Z", "2026-11-16T15:00:00Z");

    expect(r).toEqual({ cuantas: 3 });
    expect(filtros.map((f) => f.columna)).toEqual(["created_at", "created_at"]);
  });

  /*
   * LA VENTANA ES SEMIABIERTA: [desde, hasta).
   *
   * `hasta` es el instante que la corrida va a guardar como `visto_en`, y se
   * captura ANTES de contar. Sin el corte de arriba, una ausencia cargada
   * entre que se captura la hora y que corre el `count` entra en esta corrida
   * y otra vez en la siguiente -- `created_at >= visto_en` la vuelve a
   * agarrar--, y el mismo hecho se avisa dos veces.
   */
  it("la ventana es semiabierta, para que nada se cuente dos veces", async () => {
    const { cliente, filtros } = clienteFalso({ count: 1 });
    await contarAusenciasDesde(cliente, "2026-11-16T14:45:00Z", "2026-11-16T15:00:00Z");

    expect(filtros).toEqual([
      { como: "gte", columna: "created_at", valor: "2026-11-16T14:45:00Z" },
      { como: "lt", columna: "created_at", valor: "2026-11-16T15:00:00Z" },
    ]);
  });

  it("sin ninguna devuelve cero", async () => {
    const { cliente } = clienteFalso({ count: 0 });
    expect(
      await contarAusenciasDesde(cliente, "2026-11-16T14:45:00Z", "2026-11-16T15:00:00Z")
    ).toEqual({ cuantas: 0 });
  });

  /*
   * Un error no es un cero. El cron no manda nada en los dos casos, pero uno
   * se registra y el otro no: un cero silencioso todos los dias es
   * indistinguible de que no se cargue ninguna ausencia.
   */
  it("si la base falla devuelve el motivo y no tira", async () => {
    const { cliente } = clienteFalso({ error: "se corto la conexion" });
    expect(
      await contarAusenciasDesde(cliente, "2026-11-16T14:45:00Z", "2026-11-16T15:00:00Z")
    ).toEqual({ cuantas: 0, error: "se corto la conexion" });
  });

  // PostgREST devuelve `count: null` en un head sin filas en algunas versiones.
  it("un count nulo se lee como cero y no como NaN", async () => {
    const { cliente } = clienteFalso({ count: undefined });
    expect(
      (await contarAusenciasDesde(cliente, "2026-11-16T14:45:00Z", "2026-11-16T15:00:00Z")).cuantas
    ).toBe(0);
  });
});
