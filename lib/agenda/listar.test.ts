import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { traerEventos } from "./listar";

/**
 * Un doble del cliente de Supabase que sólo anota qué condición se le pidió.
 *
 * Lo que se prueba es **la condición que viaja a la base**, no la red: la ventana
 * de lectura es una cadena y ahí es donde se decide qué filas existen para la
 * pantalla. `or` queda en null si nadie llamó a `.or(...)`, que es lo que
 * distingue «sin ventana» de «con una ventana vacía».
 */
function clienteEspia() {
  const espia = { or: null as string | null, tabla: null as string | null };
  const consulta = {
    select: () => consulta,
    or: (condicion: string) => {
      espia.or = condicion;
      return consulta;
    },
    order: () => consulta,
    // Una tanda vacía y corta: `traerTodo` termina en la primera vuelta.
    range: () => Promise.resolve({ data: [], error: null }),
  };
  const cliente = {
    from: (tabla: string) => {
      espia.tabla = tabla;
      return consulta;
    },
  } as unknown as SupabaseClient;
  return { cliente, espia };
}

describe("traerEventos", () => {
  it("pide desde la fecha que le dan y no desde un corte propio", async () => {
    const { cliente, espia } = clienteEspia();
    await traerEventos(cliente, {
      historial: false,
      desde: "2026-03-09T00:00:00.000Z",
      directorio: new Map(),
    });
    expect(espia.tabla).toBe("agenda_eventos");
    expect(espia.or).toContain("fin.gte.2026-03-09T00:00:00.000Z");
  });

  // La banda de alertas nombra los eventos divergidos y los que quedaron en el
  // SdG sin llegar a Google: si la consulta no los lee, la banda promete nombrar
  // una fila que nunca vio.
  it("trae siempre lo divergido y lo pendiente, sea de la fecha que sea", async () => {
    const { cliente, espia } = clienteEspia();
    await traerEventos(cliente, {
      historial: false,
      desde: "2026-03-09T00:00:00.000Z",
      directorio: new Map(),
    });
    expect(espia.or).toContain("divergencia.not.is.null");
    expect(espia.or).toContain("google_pendiente.not.is.null");
  });

  it("con historial no filtra nada", async () => {
    const { cliente, espia } = clienteEspia();
    await traerEventos(cliente, {
      historial: true,
      desde: "2026-03-09T00:00:00.000Z",
      directorio: new Map(),
    });
    expect(espia.or).toBeNull();
  });
});
