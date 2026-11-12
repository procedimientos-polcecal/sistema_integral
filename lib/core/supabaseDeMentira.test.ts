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
import { supabaseDeMentira, type BaseDeMentira } from "./supabaseDeMentira";

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
