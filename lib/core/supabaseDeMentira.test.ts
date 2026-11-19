/**
 * Los filtros del Supabase de mentira.
 *
 * **Es el primer test del andamio y no de la app, así que vale decir por qué
 * existe.** El encabezado de `supabaseDeMentira.ts` promete, primero de todo,
 * que «aplica los filtros»: un fake que devolviera siempre todas las filas no
 * distinguiría una consulta acotada de una que no lo está. Esa promesa es
 * código con lógica adentro, y hasta hoy no la miraba nadie — los seis archivos
 * que lo usan prueban *sus rutas*, y pasan igual si un filtro se afloja.
 *
 * Lo escribió un caso real, el 12/11/2026. `main` agregó tres conteos a
 * `avisosDeUsuario` que usan `.not` y `.is`; el fake no los tenía, y pasaron
 * dos cosas distintas: el de las OT encadenadas **reventó** —un `TypeError`
 * que volteó el test— y los otros dos, que atrapan sus errores, **contaron 0
 * en silencio** y sólo dejaron una línea en el log. El segundo modo es el
 * peligroso, y es el mismo que tendría un `.not` implementado como no-op: el
 * test verde, el filtro sin aplicar.
 *
 * Por eso acá no se prueba que los métodos *existan* sino que **dejen filas
 * afuera**, que es lo único que un no-op no puede fingir.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { supabaseDeMentira, cumpleElOr, type BaseDeMentira } from "./supabaseDeMentira";

/** Lo que de la consulta usa este archivo. El fake devuelve `unknown`. */
interface Consultable extends PromiseLike<{ data: Record<string, unknown>[] | null }> {
  select(columnas: string): Consultable;
  is(columna: string, valor: unknown): Consultable;
  not(columna: string, operador: string, valor: unknown): Consultable;
}

let base: BaseDeMentira;
const tabla = (nombre: string) => base.admin.from(nombre) as unknown as Consultable;

/*
 * Tres filas que se distinguen justamente por esa columna: una con fecha, una
 * con `null` explícito y una **a la que le falta la clave**. La tercera no es
 * un adorno — ver el test que la nombra.
 */
beforeEach(() => {
  base = supabaseDeMentira();
  base.reiniciar({
    eventos: [
      { id: "con", divergencia: "movido" },
      { id: "nula", divergencia: null },
      { id: "sin" },
    ],
  });
});

describe("el `is` del Supabase de mentira", () => {
  it("trae sólo las nulas, y no todas", async () => {
    const { data } = await tabla("eventos").select("id").is("divergencia", null);
    expect(data?.map((f) => f.id)).toEqual(["nula", "sin"]);
  });

  /*
   * `IS NULL` no es `= null`, y acá la diferencia se nota: un test arma sus
   * filas con las columnas que le importan y omite el resto, así que la fila a
   * la que le falta la clave es el caso **normal** y no el raro. Con una
   * igualdad pelada —`f[c] === null`— esa fila no entraría, y el conteo daría
   * de menos sin que nada lo dijera.
   */
  it("cuenta como nula la columna que la fila ni siquiera trae", async () => {
    const { data } = await tabla("eventos").select("id").is("divergencia", null);
    expect(data?.map((f) => f.id)).toContain("sin");
  });
});

describe("el `not` del Supabase de mentira", () => {
  it("deja afuera las nulas y las que no traen la columna", async () => {
    const { data } = await tabla("eventos").select("id").not("divergencia", "is", null);
    expect(data?.map((f) => f.id)).toEqual(["con"]);
  });

  /*
   * El repo lo usa de una sola forma, `.not(columna, "is", null)`, en los tres
   * lugares que hay. Cualquier otro operador **revienta**, que es lo contrario
   * de lo cómodo: devolver todo sería un test verde con el filtro sin aplicar.
   * Una explosión se arregla en un minuto; un conteo de más no se nota nunca.
   */
  it("revienta con un operador que no sabe, en vez de devolver todo", async () => {
    expect(() => tabla("eventos").select("id").not("divergencia", "eq", "movido"))
      .toThrow(/no sabe|sólo sabe/i);
  });
});

describe("lo que un borrado devuelve", () => {
  /*
   * La trampa que esto cierra no está en el fake sino en lo que el fake **deja
   * pasar**. Una ruta que borra y cuenta cuántas filas borró necesita el
   * `.select("id")`, porque PostgREST sin él devuelve `data: null`; si el fake
   * devolviera las filas igual, sacarle ese `select` dejaba los tests en verde y
   * mandaba a producción un borrado que contesta «no había nada que borrar»
   * después de haber borrado. Lo encontró una revisión, no un test.
   */
  const conDosFilas = () => {
    const b = supabaseDeMentira();
    b.reiniciar({ t: [{ id: "a", x: 1 }, { id: "b", x: 1 }] });
    return b;
  };
  type Borrable = {
    delete(): {
      eq(c: string, v: unknown): PromiseLike<{ data: unknown[] | null }> & {
        select(c: string): PromiseLike<{ data: unknown[] | null }>;
      };
    };
  };

  it("sin `select()` no devuelve las filas, aunque las haya borrado", async () => {
    const b = conDosFilas();
    const { data } = await (b.admin.from("t") as unknown as Borrable).delete().eq("x", 1);
    expect(data).toBeNull();
    expect(b.estado.tablas.t).toEqual([]);
  });

  it("con `select()` las devuelve, que es con lo que se cuenta cuántas se borraron", async () => {
    const b = conDosFilas();
    const { data } = await (b.admin.from("t") as unknown as Borrable).delete().eq("x", 1).select("id");
    expect(data).toEqual([{ id: "a" }, { id: "b" }]);
  });
});

describe("el `update` y el `alInsertar` del Supabase de mentira", () => {
  it("el update toca sólo lo que coincide con el filtro", async () => {
    const b = supabaseDeMentira();
    b.reiniciar({ t: [{ id: "a", x: 1 }, { id: "b", x: 1 }] });
    const t = b.admin.from("t") as unknown as {
      update(f: object): { eq(c: string, v: unknown): PromiseLike<unknown> };
    };
    await t.update({ x: 9 }).eq("id", "a");
    expect(b.estado.tablas.t).toEqual([{ id: "a", x: 9 }, { id: "b", x: 1 }]);
  });

  it("el insert se niega con el error que dice el test, y no agrega nada", async () => {
    const b = supabaseDeMentira({ alInsertar: () => ({ code: "23505", message: "duplicado" }) });
    b.reiniciar({ t: [] });
    const t = b.admin.from("t") as unknown as {
      insert(f: object): PromiseLike<{ error: { code?: string } | null }>;
    };
    const r = await t.insert({ x: 1 });
    expect(r.error?.code).toBe("23505");
    expect(b.estado.tablas.t).toEqual([]);
  });
});

/**
 * Las dos formas que trajo el conteo de OT atrasadas, por la misma razón que
 * todo lo de arriba: un `.or()` que devolviera todo, o un `.not(… "in" …)` que
 * no sacara nada, dejan el test en verde con el filtro sin aplicar — y acá eso
 * no se ve, porque un conteo **más grande** no parece roto.
 */
describe("los filtros que trajo el conteo de atrasadas", () => {
  /** Una consulta de lectura del fake, con lo que hace falta encadenar acá. */
  interface Lectura extends PromiseLike<{ data: { id: string }[] | null }> {
    not(c: string, op: string, v: unknown): Lectura;
    or(filtros: string): Lectura;
  }
  const leer = (b: BaseDeMentira, tabla: string) =>
    (b.admin.from(tabla) as unknown as { select(c: string): Lectura }).select("id");

  const conFilas = (filas: object[]) => {
    const b = supabaseDeMentira();
    b.reiniciar({ ot: filas as Record<string, unknown>[] });
    return b;
  };

  it('`.not(columna, "in", "(A,B)")` deja afuera las que están en la lista', async () => {
    const b = conFilas([
      { id: "a", estado: "POR_HACER" },
      { id: "b", estado: "REALIZADO" },
      { id: "c", estado: "CANCELADA" },
      { id: "d", estado: "EN_PROCESO" },
    ]);
    const r = await leer(b, "ot").not("estado", "in", "(REALIZADO,CANCELADA)");
    expect(r.data?.map((f) => f.id)).toEqual(["a", "d"]);
  });

  it("un `.or()` de alternativas sueltas deja afuera la que no cumple ninguna", async () => {
    const b = conFilas([
      { id: "a", estado: "ATRASADO", fecha: "2026-12-01" },
      { id: "b", estado: "POR_HACER", fecha: "2026-11-01" },
      { id: "c", estado: "POR_HACER", fecha: "2026-12-01" },
    ]);
    const r = await leer(b, "ot").or("estado.eq.ATRASADO,fecha.lt.2026-11-19");
    expect(r.data?.map((f) => f.id)).toEqual(["a", "b"]);
  });

  it("entiende un `and(...)` con un `or(...)` adentro, que es la forma real", async () => {
    const b = conFilas([
      // Vencida y sin ventana: entra.
      { id: "a", fecha: "2026-11-01", fin: null },
      // Vencida pero la ventana llega hasta diciembre: no entra.
      { id: "b", fecha: "2026-11-01", fin: "2026-12-01" },
      // Vencida y la ventana también terminó: entra.
      { id: "c", fecha: "2026-11-01", fin: "2026-11-10" },
      // Todavía no arrancó: no entra.
      { id: "d", fecha: "2026-12-01", fin: null },
    ]);
    const r = await leer(b, "ot")
      .or("and(fecha.lt.2026-11-19,or(fin.is.null,fin.lt.2026-11-19))");
    expect(r.data?.map((f) => f.id)).toEqual(["a", "c"]);
  });

  it("una columna nula no cumple una comparación, y `is.null` sí", () => {
    expect(cumpleElOr({ fecha: null }, "fecha.lt.2026-11-19")).toBe(false);
    expect(cumpleElOr({ fecha: null }, "fecha.is.null")).toBe(true);
    expect(cumpleElOr({}, "fecha.not.is.null")).toBe(false);
  });

  it("un operador que no simula revienta en vez de dejar pasar la fila", () => {
    expect(() => cumpleElOr({ x: "1" }, "x.like.*hola*")).toThrow(/sólo sabe/);
  });
});
