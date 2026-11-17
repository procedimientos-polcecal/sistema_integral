import { describe, it, expect } from "vitest";
import {
  ultimoVistazo,
  guardarElVistazo,
  queMandarAhora,
  conLaSaludQueNoSePudoComprobar,
} from "./vistazoDeAvisos";
import { SIN_AVISOS } from "./fotoDeAvisos";
import type { Notificacion } from "./notificaciones";
import type { Foto } from "./movimiento";

/**
 * Un PostgREST de mentira, con el mismo molde que `fotoDeAvisos.test.ts`. Lo
 * que se prueba no es la base: es qué hace esta capa cuando la base contesta
 * mal, que es donde estuvo el agujero la vez pasada.
 *
 * Guarda el **orden** de las operaciones, porque acá eso es parte del
 * contrato: si el insert corriera antes del delete, el delete se llevaría lo
 * recién escrito y la tabla quedaría vacía.
 */
function clienteFalso(opciones: {
  filas?: { notificacion_id: string; cantidad: number; visto_en: string }[];
  errorAlLeer?: string;
  errorAlBorrar?: string;
  errorAlEscribir?: string;
}) {
  const hechos: { que: string; filas?: Record<string, unknown>[] }[] = [];

  const consulta = () => {
    const self: Record<string, unknown> = {};
    self.select = () => self;
    self.then = (r: (v: unknown) => unknown) =>
      Promise.resolve(
        opciones.errorAlLeer
          ? { data: null, error: { message: opciones.errorAlLeer } }
          : { data: opciones.filas ?? [], error: null }
      ).then(r);
    self.delete = () => {
      hechos.push({ que: "borrar" });
      const borrado: Record<string, unknown> = {};
      borrado.neq = () =>
        Promise.resolve({
          error: opciones.errorAlBorrar ? { message: opciones.errorAlBorrar } : null,
        });
      return borrado;
    };
    self.insert = (filas: Record<string, unknown>[]) => {
      hechos.push({ que: "escribir", filas });
      return Promise.resolve({
        error: opciones.errorAlEscribir ? { message: opciones.errorAlEscribir } : null,
      });
    };
    return self;
  };

  return { cliente: { from: consulta } as never, hechos };
}

const aviso = (id: string, cantidad: number): Notificacion => ({
  id,
  titulo: id,
  cantidad,
  href: "/",
});

describe("queMandarAhora", () => {
  const DE_DIA = new Date("2026-11-16T15:00:00Z"); // 12:00 AR
  const DE_NOCHE = new Date("2026-11-16T05:00:00Z"); // 2:00 AR

  /*
   * La ventana 7:00-21:00 es la misma que la del resto de los avisos al
   * instante, y es lo que hace que esto no termine con la gente apagando las
   * notificaciones. Fuera de ella no se encola nada, y el repesque de la
   * noche NO es el resumen de las 8:30 -- ese manda solo los lunes -- sino
   * `avisos_vistos`, que no se borra: la corrida de las 7:11 compara contra
   * las 20:56 del dia anterior.
   */
  it("fuera de la ventana no se manda nada", () => {
    expect(queMandarAhora({ cuando: "2026-11-16T14:00:00Z", ahora: DE_NOCHE })).toBe("nada");
  });

  /*
   * La primera corrida de todas: no hay con qué comparar, así que sólo se
   * guarda. Tratarlo como "todo es nuevo" sería un push de estreno con el
   * stock entero rotulado como novedad, que es el anti-goal del diseño.
   */
  it("sin ningun vistazo anterior no se manda nada", () => {
    expect(queMandarAhora({ cuando: null, ahora: DE_DIA })).toBe("nada");
  });

  it("con un vistazo anterior y dentro de la ventana, se mandan las novedades", () => {
    expect(queMandarAhora({ cuando: "2026-11-16T14:45:00Z", ahora: DE_DIA })).toBe("novedades");
  });

  // Las dos condiciones son AND, no OR: la primera corrida de la madrugada
  // tampoco manda.
  it("la primera corrida fuera de hora tampoco manda", () => {
    expect(queMandarAhora({ cuando: null, ahora: DE_NOCHE })).toBe("nada");
  });
});

describe("ultimoVistazo", () => {
  it("devuelve las cantidades y la hora de la corrida anterior", async () => {
    const { cliente } = clienteFalso({
      filas: [
        { notificacion_id: "mant-atrasadas", cantidad: 23, visto_en: "2026-11-16T14:45:00Z" },
        { notificacion_id: "salud-x/y", cantidad: 1, visto_en: "2026-11-16T14:45:00Z" },
      ],
    });
    expect(await ultimoVistazo(cliente)).toEqual({
      cuando: "2026-11-16T14:45:00Z",
      vistos: new Map([
        ["mant-atrasadas", 23],
        ["salud-x/y", 1],
      ]),
    });
  });

  it("sin filas devuelve cuando null y el mapa vacio", async () => {
    const { cliente } = clienteFalso({ filas: [] });
    expect(await ultimoVistazo(cliente)).toEqual({ cuando: null, vistos: new Map() });
  });

  /*
   * Entre el deploy y la aplicación de la migración —que la hace una persona a
   * mano— la tabla no existe. Confundir eso con "es la primera corrida" deja
   * al cron guardando y no mandando nunca, todos los días, sin que nadie se
   * entere. Es el mismo agujero que `ultimaFoto` ya tuvo.
   */
  it("si la tabla no existe, lo dice en vez de parecer la primera corrida", async () => {
    const { cliente } = clienteFalso({ errorAlLeer: "no existe la relacion avisos_vistos" });
    const r = await ultimoVistazo(cliente);
    expect(r.error).toBe("no existe la relacion avisos_vistos");
    expect(r.cuando).toBeNull();
  });

  /*
   * La centinela marca la hora de una corrida sin ningún aviso. No es un
   * aviso, así que no entra al mapa — pero su hora sí cuenta, o una corrida
   * limpia haría parecer que nunca hubo ninguna.
   */
  it("la fila centinela da la hora pero no entra en el mapa", async () => {
    const { cliente } = clienteFalso({
      filas: [{ notificacion_id: SIN_AVISOS, cantidad: 0, visto_en: "2026-11-16T14:45:00Z" }],
    });
    expect(await ultimoVistazo(cliente)).toEqual({
      cuando: "2026-11-16T14:45:00Z",
      vistos: new Map(),
    });
  });
});

describe("guardarElVistazo", () => {
  /*
   * EL TEST QUE IMPORTA DE ESTE ARCHIVO.
   *
   * Un `salud-*` se avisa por el flanco: `novedadesAlInstante` pregunta si el
   * id ESTABA en la tabla. Si un recurso que se arregló no sale de acá, el día
   * que vuelva a romperse ya figura como visto y no se avisa nunca más. Nada
   * falla, nada se pone en rojo: simplemente deja de avisar.
   */
  it("deja exactamente los avisos de ahora, y borra los que ya no estan", async () => {
    const { cliente, hechos } = clienteFalso({});
    await guardarElVistazo(cliente, [aviso("mant-atrasadas", 23)], "2026-11-16T15:00:00Z");

    expect(hechos.map((h) => h.que)).toEqual(["borrar", "escribir"]);
    expect(hechos[1].filas).toEqual([
      { notificacion_id: "mant-atrasadas", cantidad: 23, visto_en: "2026-11-16T15:00:00Z" },
    ]);
  });

  /*
   * Mismo motivo que `SIN_AVISOS` en la foto diaria: sin la centinela, una
   * corrida sin ningún aviso dejaría la tabla vacía, `cuando` volvería a ser
   * null y la corrida siguiente se trataría como la primera — o sea que no
   * mandaría nada tampoco.
   */
  it("sin avisos deja la tabla vacia pero con la hora", async () => {
    const { cliente, hechos } = clienteFalso({});
    await guardarElVistazo(cliente, [], "2026-11-16T15:00:00Z");

    expect(hechos[1].filas).toEqual([
      { notificacion_id: SIN_AVISOS, cantidad: 0, visto_en: "2026-11-16T15:00:00Z" },
    ]);
  });

  it("si el borrado falla devuelve el motivo y no escribe nada", async () => {
    const { cliente, hechos } = clienteFalso({ errorAlBorrar: "se corto la conexion" });
    expect(await guardarElVistazo(cliente, [aviso("ot", 1)], "2026-11-16T15:00:00Z")).toEqual({
      error: "se corto la conexion",
    });
    expect(hechos.map((h) => h.que)).toEqual(["borrar"]);
  });

  it("si la escritura falla devuelve el motivo y no tira", async () => {
    const { cliente } = clienteFalso({ errorAlEscribir: "se lleno el disco" });
    expect(await guardarElVistazo(cliente, [aviso("ot", 1)], "2026-11-16T15:00:00Z")).toEqual({
      error: "se lleno el disco",
    });
  });
});

/*
 * EL ARRASTRE DE LA SALUD CIEGA.
 *
 * `leerLaSalud` falla cerrado: devuelve cero caidas y emite
 * `salud-sin-comprobar`. Sin esto, los recursos que SI estaban rotos salen del
 * vistazo, y la corrida siguiente los ve volver y dispara el flanco de nuevo:
 * un push por cada recurso roto, a admin_sistema, sin que nada se haya roto.
 * Y como `salud-sin-comprobar` esta en CRECE_CON_EL_DIA, el instantaneo
 * tampoco avisa que el vigilante quedo ciego -- o sea que el re-anuncio
 * llegaria sin la causa.
 */
describe("conLaSaludQueNoSePudoComprobar", () => {
  const vistos: Foto = new Map([
    ["salud-rrhh/lenox", 4],
    ["salud-calidad/carbonilla", 9],
    ["mant-atrasadas", 23],
  ]);

  it("en una corrida normal no toca nada", () => {
    const todos = [aviso("mant-atrasadas", 24), aviso("salud-rrhh/lenox", 5)];
    expect(conLaSaludQueNoSePudoComprobar(todos, vistos)).toBe(todos);
  });

  it("si la salud quedo ciega, arrastra los salud- del vistazo anterior", () => {
    const todos = [aviso("mant-atrasadas", 24), aviso("salud-sin-comprobar", 20261117)];
    expect(conLaSaludQueNoSePudoComprobar(todos, vistos).map((a) => [a.id, a.cantidad])).toEqual([
      ["mant-atrasadas", 24],
      ["salud-sin-comprobar", 20261117],
      ["salud-rrhh/lenox", 4],
      ["salud-calidad/carbonilla", 9],
    ]);
  });

  // Lo que NO es de la salud no se arrastra: su conteo se hizo igual y un 23
  // que ya no esta quiere decir que se resolvio.
  it("no arrastra nada que no sea de la salud", () => {
    const todos = [aviso("salud-sin-comprobar", 20261117)];
    expect(
      conLaSaludQueNoSePudoComprobar(todos, vistos).some((a) => a.id === "mant-atrasadas")
    ).toBe(false);
  });

  // Un recurso que la corrida ciega SI reporta no se duplica.
  it("no duplica uno que ya viene en la corrida", () => {
    const todos = [aviso("salud-sin-comprobar", 20261117), aviso("salud-rrhh/lenox", 7)];
    const ids = conLaSaludQueNoSePudoComprobar(todos, vistos).map((a) => a.id);
    expect(ids.filter((id) => id === "salud-rrhh/lenox")).toHaveLength(1);
  });

  it("con el vistazo vacio no inventa nada", () => {
    const todos = [aviso("salud-sin-comprobar", 20261117)];
    expect(conLaSaludQueNoSePudoComprobar(todos, new Map())).toEqual(todos);
  });
});
