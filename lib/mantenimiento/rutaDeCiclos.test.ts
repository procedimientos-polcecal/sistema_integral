import { describe, it, expect, vi, beforeEach } from "vitest";
import { supabaseDeMentira } from "@/lib/core/supabaseDeMentira";

/**
 * El alta de un ciclo encadenado, con un Supabase de mentira.
 *
 * **Es el quinto test de ruta del repo y tampoco es una plantilla.** La vara
 * sigue siendo la misma: que la regla **no se pueda sacar a `lib/`**. Acá lo
 * que se prueba no es una regla sino un **orden**, y un orden no es una
 * función: la ruta escribe dos tareas del catálogo con `upsert` y recién
 * después inserta el ciclo.
 *
 * ── EL DEFECTO QUE LO HIZO EXISTIR (revisión del 25/11/2026) ───────────────
 *
 * El `upsert` va sobre la clave natural `(equipment_id, accion, componente)`,
 * que es **la misma clave que ya tienen las tareas del ciclo que ese equipo
 * está corriendo**. Con una pestaña vieja —cuya lista de equipos se armó antes
 * de que ese equipo recibiera un ciclo— el alta pasa la validación entera, los
 * dos `upsert` **salen bien** y le reescriben el `periodo_dias` a la hija de un
 * ciclo que está generando órdenes; recién entonces el insert choca contra
 * `unique (equipment_id)` y contesta 409.
 *
 * O sea: la pantalla dice «no se pudo armar» mientras acaba de reconfigurar en
 * silencio el generador que estaba corriendo. En la rama que existe porque un
 * ciclo generó 426 órdenes en cuatro días, ése es el peor final disponible.
 *
 * Por eso el primer test mira **que no se haya escrito nada**, que es lo único
 * que ninguna función pura puede ver, y no sólo el 409.
 *
 * Lo que este test NO prueba, y conviene no creerle: que las tablas existan
 * con esas columnas, ni las policies, ni que el `unique` esté donde el fake
 * finge que está — eso lo dice la migración `20261112105418` y se comprobó
 * leyendo el catálogo, no acá.
 */

const base = supabaseDeMentira({
  // El fake no conoce los índices: la regla del `unique (equipment_id)` la
  // pone el test, que es como se prueba una carrera contra la base.
  alInsertar: (tabla, fila, filas) =>
    tabla === "mant_ciclos_de_ot" &&
    filas.some((f) => f.equipment_id === fila.equipment_id)
      ? {
        code: "23505",
        message:
            'duplicate key value violates unique constraint "mant_ciclos_de_ot_un_ciclo_por_equipo"',
      }
      : null,
});

const sesion = {
  usuario: { id: "ana" } as { id: string } | null,
  puedeEditar: true,
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: sesion.usuario } }) },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => base.admin }));
vi.mock("@/lib/mantenimiento/auth", () => ({
  puedeEditarMantenimiento: async () => sesion.puedeEditar,
}));

const { POST } = await import("@/app/api/mantenimiento/ciclos/route");

const post = (cuerpo: unknown) =>
  POST(new Request("http://prueba/api", { method: "POST", body: JSON.stringify(cuerpo) }));

/** Un alta que pasa toda la validación: lo que cambia cada test es el estado. */
const ALTA = {
  equipment_id: "eq-1",
  componente: "Martillos",
  accionMadre: "CAMBIO",
  nombreMadre: "Cambio de Martillos",
  accionHija: "ROTACION",
  nombreHija: "Rotación de Martillos",
  periodo_dias: 3,
  repeticiones: 3,
  especialidad: "MECANICA",
  horas_estimadas: 4,
};

/** La hija que ya está en el catálogo de ese equipo, con su plazo de verdad. */
const LA_HIJA_QUE_YA_ESTA = {
  id: "t-rot", equipment_id: "eq-1", accion: "ROTACION", componente: "Martillos",
  nombre: "Rotación de Martillos", periodo_dias: 6, estado: "CONFIRMADA", motivo: null,
};

beforeEach(() => {
  sesion.usuario = { id: "ana" };
  sesion.puedeEditar = true;
  base.reiniciar({ mant_ciclos_de_ot: [], mant_tareas_preventivas: [] });
});

describe("armar un ciclo sobre un equipo que ya tiene uno", () => {
  beforeEach(() => {
    base.reiniciar({
      mant_ciclos_de_ot: [{
        id: "c-1", equipment_id: "eq-1", repeticiones: 3,
        tarea_madre_id: "t-cam", tarea_hija_id: "t-rot",
        desde: "2026-11-14", vuelta_desde: 0, activo: true,
      }],
      mant_tareas_preventivas: [LA_HIJA_QUE_YA_ESTA],
    });
  });

  it("se niega con una frase y no con el error de Postgres", async () => {
    const res = await post(ALTA);

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(
      "Ese equipo ya tiene un ciclo. Si está apagado, se prende desde su tarjeta."
    );
  });

  /*
   * El que importa de verdad. Un 409 después de las escrituras se ve igual en
   * pantalla que un 409 antes: el mismo cartel, el mismo botón. La diferencia
   * está en el plazo del ciclo que está corriendo, y nadie la mira.
   */
  it("y no le toca el plazo a la tarea del ciclo que está corriendo", async () => {
    await post(ALTA);

    expect(base.estado.tablas.mant_tareas_preventivas).toEqual([LA_HIJA_QUE_YA_ESTA]);
  });
});

describe("armar un ciclo sobre un equipo libre", () => {
  it("deja las dos tareas confirmadas y el ciclo sin arrancar", async () => {
    const res = await post(ALTA);

    expect(res.status).toBe(201);

    const tareas = base.estado.tablas.mant_tareas_preventivas ?? [];
    expect(tareas.map((t) => [t.accion, t.estado, t.periodo_dias])).toEqual([
      ["CAMBIO", "CONFIRMADA", null],
      ["ROTACION", "CONFIRMADA", 3],
    ]);

    const [ciclo] = base.estado.tablas.mant_ciclos_de_ot ?? [];
    expect(ciclo).toMatchObject({
      equipment_id: "eq-1", repeticiones: 3, desde: null, vuelta_desde: null,
      creado_por: "ana",
    });
  });

  // Reusar es lo que evita dos filas para el mismo trabajo, y es lo que el
  // modal promete cuando dice «ya existe X: el ciclo la reusa».
  it("reusa la tarea que ya estaba en vez de duplicarla", async () => {
    base.reiniciar({
      mant_ciclos_de_ot: [],
      mant_tareas_preventivas: [{ ...LA_HIJA_QUE_YA_ESTA, estado: "DESCARTADA" }],
    });

    const res = await post(ALTA);

    expect(res.status).toBe(201);
    expect(base.estado.tablas.mant_tareas_preventivas).toHaveLength(2);
    expect(
      base.estado.tablas.mant_tareas_preventivas.find((t) => t.accion === "ROTACION")
    ).toMatchObject({ id: "t-rot", estado: "CONFIRMADA", periodo_dias: 3 });
  });

  it("sin nivel de edición no escribe nada", async () => {
    sesion.puedeEditar = false;

    const res = await post(ALTA);

    expect(res.status).toBe(403);
    expect(base.estado.tablas.mant_tareas_preventivas).toEqual([]);
    expect(base.estado.tablas.mant_ciclos_de_ot).toEqual([]);
  });

  it("un alta incompleta se contesta con todo lo que falta, y no escribe", async () => {
    const res = await post({ ...ALTA, componente: "", repeticiones: 99 });

    expect(res.status).toBe(400);
    expect(base.estado.tablas.mant_tareas_preventivas).toEqual([]);
  });
});
