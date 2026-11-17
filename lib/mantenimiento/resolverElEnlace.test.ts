import { describe, it, expect } from "vitest";
import { resolverLosEnlacesDeAvisos } from "./resolverElEnlace";

/**
 * Un registrador encadenable: NO imita a PostgREST, sólo anota la forma de cada
 * escritura. Fija las guardas del where —el `.or()` es lo único que protege a
 * los avisos cuya OT nació de ellos—, no su semántica.
 */
function doble() {
  const updates: { payload: unknown; filtros: string[] }[] = [];
  const avisos = [
    { id: "a1", ot_asignada: "100", work_order_id: null, ot_enlazada_en: null, ot_resuelta_en: null },
    { id: "a2", ot_asignada: "100", work_order_id: null, ot_enlazada_en: null, ot_resuelta_en: null },
    { id: "a3", ot_asignada: "", work_order_id: "x", ot_enlazada_en: null, ot_resuelta_en: "t" },
  ];
  const consulta = (tabla: string) => {
    const q: Record<string, unknown> = {};
    let upd: { payload: unknown; filtros: string[] } | null = null;
    const fin = (filas: unknown[]) => Promise.resolve({ data: filas, error: null });
    for (const m of ["select", "order", "range", "is", "in", "or", "not"]) {
      q[m] = (...a: unknown[]) => {
        if (upd) upd.filtros.push(`${m}(${a.map(String).join(",")})`);
        if (m === "range" || (m === "in" && tabla === "ordenes_trabajo")) return fin(tabla === "avisos" ? avisos : [{ id: "ot-100", ot_number: 100 }]);
        if (m === "select" && upd) return fin(upd.filtros.some((f) => f.startsWith("in(id,a3")) ? [{ id: "a3" }] : [{ id: "a1" }]);
        return q;
      };
    }
    q.update = (payload: unknown) => {
      upd = { payload, filtros: [] };
      updates.push(upd);
      return q;
    };
    return q;
  };
  return { updates, from: consulta };
}

describe("resolverLosEnlacesDeAvisos", () => {
  it("escribe un update por OT y otro para los vaciados, con las guardas, y cuenta lo escrito", async () => {
    const d = doble();
    const r = await resolverLosEnlacesDeAvisos(d as never);
    expect(d.updates).toHaveLength(2);
    expect((d.updates[0].payload as { ot_resuelta_en: string }).ot_resuelta_en).toBeTruthy();
    expect(d.updates[0].filtros).toContain("is(ot_enlazada_en,null)");
    expect(d.updates[0].filtros).toContain("or(work_order_id.is.null,ot_resuelta_en.not.is.null)");
    expect(d.updates[1].payload).toEqual({ work_order_id: null, ot_resuelta_en: null });
    expect(d.updates[1].filtros).toContain("not(ot_resuelta_en,is,null)");
    // el doble devuelve 1 fila por update aunque se pidieron 2 y 1: se cuenta lo escrito
    expect(r).toEqual({ enlazados: 1, vaciados: 1 });
  });
});
