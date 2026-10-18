import { describe, it, expect } from "vitest";
import { ultimaFoto, guardarFoto, SIN_AVISOS } from "./fotoDeAvisos";
import type { Notificacion } from "./notificaciones";

/**
 * Un PostgREST de mentira. Lo que se prueba acá no es la base: es qué hace esta
 * capa cuando la base contesta mal, que es donde estaba el agujero.
 */
function clienteFalso(opciones: {
  fechas?: { fecha: string }[];
  filas?: { notificacion_id: string; cantidad: number }[];
  errorEnLaFecha?: string;
  errorEnLasFilas?: string;
  errorAlGuardar?: string;
}) {
  const guardado: Record<string, unknown>[][] = [];

  const consulta = () => {
    const self: Record<string, unknown> = {};
    let porFecha = false;
    for (const m of ["select", "order", "limit"]) self[m] = () => self;
    self.eq = () => {
      porFecha = true;
      return self;
    };
    self.maybeSingle = () =>
      Promise.resolve(
        opciones.errorEnLaFecha
          ? { data: null, error: { message: opciones.errorEnLaFecha } }
          : { data: opciones.fechas?.[0] ?? null, error: null }
      );
    self.then = (r: (v: unknown) => unknown) =>
      Promise.resolve(
        porFecha && opciones.errorEnLasFilas
          ? { data: null, error: { message: opciones.errorEnLasFilas } }
          : { data: opciones.filas ?? [], error: null }
      ).then(r);
    self.upsert = (filas: Record<string, unknown>[]) => {
      guardado.push(filas);
      return Promise.resolve({
        error: opciones.errorAlGuardar ? { message: opciones.errorAlGuardar } : null,
      });
    };
    return self;
  };

  return { cliente: { from: consulta } as never, guardado };
}

const aviso = (id: string, cantidad: number): Notificacion => ({
  id,
  titulo: id,
  cantidad,
  href: "/",
});

describe("ultimaFoto", () => {
  it("devuelve la fecha mas alta y sus filas", async () => {
    const { cliente } = clienteFalso({
      fechas: [{ fecha: "2026-10-17" }],
      filas: [{ notificacion_id: "ot", cantidad: 23 }],
    });
    expect(await ultimaFoto(cliente)).toEqual({
      fecha: "2026-10-17",
      foto: new Map([["ot", 23]]),
    });
  });

  it("sin ninguna foto devuelve fecha null y el mapa vacio", async () => {
    const { cliente } = clienteFalso({ fechas: [] });
    expect(await ultimaFoto(cliente)).toEqual({ fecha: null, foto: new Map() });
  });

  // Entre el deploy y la aplicacion de la migracion la tabla no existe.
  it("si falla la consulta de la fecha, lo dice", async () => {
    const { cliente } = clienteFalso({ errorEnLaFecha: "no existe la tabla" });
    expect((await ultimaFoto(cliente)).error).toBe("no existe la tabla");
  });

  /*
   * EL AGUJERO QUE ESTE TEST CIERRA.
   *
   * Si la primera consulta resuelve y la segunda falla —un corte, un timeout—,
   * devolver `fecha` con el mapa vacio hace que el cron NO lo trate como
   * primer dia y que `loQueSeMovio` de por nuevo todo. A cada suscripto le
   * llegaria un push donde cada numero es el stock entero rotulado como
   * delta: "23 más · Órdenes de trabajo atrasadas". Es el anti-goal textual
   * del spec: que la foto se desincronice y el delta mienta.
   */
  it("si falla la consulta de las filas, lo dice en vez de devolver una foto vacia", async () => {
    const { cliente } = clienteFalso({
      fechas: [{ fecha: "2026-10-17" }],
      errorEnLasFilas: "se corto la conexion",
    });
    const r = await ultimaFoto(cliente);
    expect(r.error).toBe("se corto la conexion");
    expect(r.fecha).toBeNull();
  });

  // La fila centinela existe para que la fecha avance; no es un aviso.
  it("la fila centinela no entra en la foto", async () => {
    const { cliente } = clienteFalso({
      fechas: [{ fecha: "2026-10-17" }],
      filas: [
        { notificacion_id: SIN_AVISOS, cantidad: 0 },
        { notificacion_id: "ot", cantidad: 5 },
      ],
    });
    expect((await ultimaFoto(cliente)).foto).toEqual(new Map([["ot", 5]]));
  });
});

describe("guardarFoto", () => {
  it("guarda una fila por aviso, con la fecha", async () => {
    const { cliente, guardado } = clienteFalso({});
    await guardarFoto(cliente, "2026-10-18", [aviso("ot", 23), aviso("ri", 11)]);
    expect(guardado[0]).toEqual([
      { fecha: "2026-10-18", notificacion_id: "ot", cantidad: 23 },
      { fecha: "2026-10-18", notificacion_id: "ri", cantidad: 11 },
    ]);
  });

  /*
   * Un dia sin ningun aviso tiene que dejar fecha igual. Si no se escribe
   * nada, `ultimaFoto` sigue devolviendo la de anteayer y el delta del dia
   * siguiente se compara contra un numero viejo y mas alto — o sea que un dia
   * en que se atrasan cinco OT no avisa nada.
   */
  it("un dia sin avisos igual deja marcada la fecha", async () => {
    const { cliente, guardado } = clienteFalso({});
    await guardarFoto(cliente, "2026-10-18", []);
    expect(guardado[0]).toEqual([
      { fecha: "2026-10-18", notificacion_id: SIN_AVISOS, cantidad: 0 },
    ]);
  });

  it("si la base falla, devuelve el motivo y no tira", async () => {
    const { cliente } = clienteFalso({ errorAlGuardar: "se lleno el disco" });
    expect(await guardarFoto(cliente, "2026-10-18", [aviso("ot", 1)])).toEqual({
      error: "se lleno el disco",
    });
  });
});
