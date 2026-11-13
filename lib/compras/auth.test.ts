import { describe, it, expect, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseDeMentira } from "@/lib/core/supabaseDeMentira";
import { puedeAprobarCompras, esConsultadoDeCompras } from "./auth";

/**
 * Las dos listas de Compras, que no son la misma.
 *
 * Casi todo este archivo es I/O con una decisión de permisos adentro y no tiene
 * tests, como el resto de las rutas. Estas dos sí, y por un motivo puntual: son
 * **dos tablas que se parecen** —misma forma, misma pantalla, nombres vecinos— y
 * confundirlas no rompe nada. Lo único que pasa es que el aviso de las consultas
 * de repuestos le llega a los cuatro aprobadores en vez de a quien contesta, que
 * es el error que el diseño del 26/10/2026 existe para no cometer: medido ese
 * día, `compras_aprobadores` tiene cuatro personas y sólo una contesta, y el
 * repo ya lo pagó por el otro lado —`compras-por-aprobar` le llegaba a 6 y 3 no
 * podían aprobar—.
 *
 * Con el Supabase de mentira, que aplica los filtros de verdad: un fake que
 * devolviera siempre una fila no distinguiría una tabla de la otra, que es
 * justamente lo que acá se quiere distinguir.
 */

const base = supabaseDeMentira();
const db = () => base.admin as unknown as SupabaseClient;

beforeEach(() => {
  base.reiniciar({
    // Facundo contesta las consultas; Bernardo aprueba el gasto. Es el reparto
    // real medido el 26/10/2026: la lista de aprobadores tiene cuatro personas y
    // sólo una de ellas es quien contesta.
    compras_aprobadores: [{ usuario_id: "bernardo", alias_planilla: "BS" }],
    compras_consultados: [{ usuario_id: "facundo" }],
  });
});

describe("quién contesta las consultas de repuestos", () => {
  it("quien está en compras_consultados, sí", async () => {
    expect(await esConsultadoDeCompras(db(), "facundo")).toBe(true);
  });

  it("quien no está, no", async () => {
    expect(await esConsultadoDeCompras(db(), "ana")).toBe(false);
  });

  it("con la lista vacía no contesta nadie, y no rompe", async () => {
    base.reiniciar({ compras_consultados: [] });
    expect(await esConsultadoDeCompras(db(), "facundo")).toBe(false);
  });

  /*
   * La que importa: son dos listas distintas y estar en una no pone en la otra.
   * Leer la tabla equivocada devuelve `true` para la gente equivocada, sin error
   * y sin que nada se vea raro — simplemente le llega un push a quien no contesta.
   */
  it("aprobar no es contestar: las dos listas no se heredan", async () => {
    expect(await puedeAprobarCompras(db(), "bernardo")).toBe(true);
    expect(await esConsultadoDeCompras(db(), "bernardo")).toBe(false);

    expect(await esConsultadoDeCompras(db(), "facundo")).toBe(true);
    expect(await puedeAprobarCompras(db(), "facundo")).toBe(false);
  });
});
