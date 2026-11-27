import { describe, it, expect, vi, beforeEach } from "vitest";
import { supabaseDeMentira } from "@/lib/core/supabaseDeMentira";
import { ESTADO_CANCELADA } from "@/lib/mantenimiento/cancelacion";

/**
 * «Fue un cambio»: la OT de rotación que resultó ser un cambio de martillos.
 *
 * **Es el sexto test de ruta del repo y tampoco es una plantilla.** La vara
 * sigue siendo la misma: que la regla **no se pueda sacar a `lib/`**. Lo que
 * se prueba acá no es una regla —las reglas están en
 * `cambioFueraDeTurno.ts`, con sus propios tests— sino un **orden** y un
 * **estado final**, y ninguno de los dos es una función:
 *
 *   · el alta en la planilla va antes que la cancelación, porque los dos
 *     finales partidos no cuestan lo mismo: con el alta hecha y la
 *     cancelación caída queda una orden suelta que alguien cancela a mano,
 *     y al revés el ciclo vuelve a crear la rotación 1 desde el corte viejo,
 *     en silencio;
 *   · el motivo entra antes que el estado, así que una nota que no entra no
 *     cancela nada;
 *   · y el ciclo queda con el corte movido y sin las órdenes que el cambio
 *     dejó atrás, que es lo único que impide que la corrida siguiente recree
 *     la rotación recién cancelada.
 *
 * Lo que este test NO prueba, y conviene no creerle: que las columnas existan,
 * ni las policies, ni qué contesta Google de verdad — `altaEnLaPlanilla`,
 * `escribirEnLaFilaDeLaOT` y `borrarLosEventosDeLasOT` están mockeadas.
 */

/** Lo que contestan Google y la planilla, que cada test mueve a su gusto. */
const google = {
  alta: { ok: true, ot_number: 3211, fila: 9 } as
    { ok: true; ot_number: number; fila: number } | { ok: false; error: string },
  planilla: null as string | null,
  borrado: new Map<string, string>(),
};

/** Si la base se niega a guardar la nota del motivo, o a mover el corte. */
const falla = { nota: false, corte: false };

const base = supabaseDeMentira({
  alInsertar: (tabla) =>
    tabla === "ordenes_trabajo_notas" && falla.nota
      ? { code: "XX000", message: "no se pudo guardar la nota" }
      : null,
  alActualizar: (tabla) =>
    tabla === "mant_ciclos_de_ot" && falla.corte
      ? { code: "XX000", message: "no se pudo mover el corte" }
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
vi.mock("@/lib/mantenimiento/formulario", () => ({
  altaEnLaPlanilla: async () => google.alta,
}));
vi.mock("@/lib/mantenimiento/planillaDeOT", () => ({
  escribirEnLaFilaDeLaOT: async () => google.planilla,
}));
vi.mock("@/lib/agenda/elEventoSigueALaOT", () => ({
  borrarLosEventosDeLasOT: async () => google.borrado,
}));

const { POST } = await import(
  "@/app/api/mantenimiento/ordenes/[id]/fue-un-cambio/route"
);

const post = (id: string, cuerpo: unknown) =>
  POST(
    new Request("http://prueba/api", { method: "POST", body: JSON.stringify(cuerpo) }),
    { params: Promise.resolve({ id }) }
  );

const CICLO = {
  id: "c1", equipment_id: "eq-1", repeticiones: 3, desde: "2026-11-14",
  vuelta_desde: 0, especialidad: "MECANICA", horas_estimadas: 4,
  tarea_madre_id: "t-cam", tarea_hija_id: "t-rot", activo: true,
};

const TAREAS = [
  { id: "t-cam", nombre: "Cambio de Martillos", componente: "Martillos" },
  { id: "t-rot", nombre: "Rotación de Martillos", componente: "Martillos" },
];

/** Una OT del ciclo, con lo que la ruta le lee. */
const ot = (id: string, vuelta: number, extra: Record<string, unknown> = {}) => ({
  id,
  ot_number: 3100 + vuelta,
  ciclo_id: "c1",
  ciclo_vuelta: vuelta,
  estado: "REALIZADO",
  fecha_cierre: "2026-11-20",
  equipment_id: "eq-1",
  equipo_raw: "PY-A1-05 — Rompedora a martillos",
  equipo_code: "PY-A1-05",
  sector_id: "s1",
  sector_raw: "Molienda",
  created_at_app: "2026-11-14T08:00:00Z",
  ...extra,
});

/** La rotación abierta sobre la que se aprieta el botón. */
const LA_ROTACION = ot("ot-rot", 3, {
  ot_number: 3150,
  estado: "ATRASADO",
  fecha_cierre: null,
  created_at_app: "2026-11-22T10:00:00Z",
});

const ESTADO_INICIAL = () => ({
  mant_ciclos_de_ot: [{ ...CICLO }],
  mant_tareas_preventivas: TAREAS.map((t) => ({ ...t })),
  ordenes_trabajo: [
    ot("ot-h1", 1, { created_at_app: "2026-11-14T09:00:00Z" }),
    ot("ot-h2", 2, { created_at_app: "2026-11-18T09:00:00Z" }),
    { ...LA_ROTACION },
  ],
  ordenes_trabajo_notas: [],
  // El evento que el generador le creó a la rotación. Existe en los cuatro
  // ciclos reales: `seguirALasOT` les crea uno al nacer.
  agenda_eventos: [
    { id: "ev-rot", ot_id: "ot-rot", casilla: "gerencia@", google_event_id: "g1",
      inicio: "2026-11-27T11:00:00Z", fin: "2026-11-27T15:00:00Z" },
    { id: "ev-otra", ot_id: "ot-h2", casilla: "gerencia@", google_event_id: "g2",
      inicio: "2026-11-18T11:00:00Z", fin: "2026-11-18T15:00:00Z" },
  ],
});

const tabla = (nombre: string) => base.estado.tablas[nombre] ?? [];
const porId = (id: string) => tabla("ordenes_trabajo").find((o) => o.id === id);
/** La orden que la ruta creó: la única que no estaba al principio. */
const laNueva = () =>
  tabla("ordenes_trabajo").find(
    (o) => !["ot-h1", "ot-h2", "ot-rot"].includes(String(o.id))
  );

beforeEach(() => {
  sesion.usuario = { id: "ana" };
  sesion.puedeEditar = true;
  google.alta = { ok: true, ot_number: 3211, fila: 9 };
  google.planilla = null;
  google.borrado = new Map();
  falla.nota = false;
  falla.corte = false;
  base.reiniciar(ESTADO_INICIAL());
});

describe("POST fue-un-cambio", () => {
  it("crea la OT del cambio dentro del ciclo, cerrada y con la fecha que se dijo", async () => {
    const res = await post("ot-rot", { fecha: "2026-11-24", horas: 4 });
    expect(res.status).toBe(201);

    const nueva = laNueva();
    expect(nueva).toMatchObject({
      ot_number: 3211,
      ciclo_id: "c1",
      ciclo_vuelta: 0,
      estado: "REALIZADO",
      fecha_cierre: "2026-11-24",
      fecha_ejecucion: "2026-11-24",
      quien: "INTERNO",
      tipo: "PROGRAMADO",
      horas: 4,
      app_created: true,
      equipment_id: "eq-1",
    });
  });

  it("sin horas la orden nace con horas en null", async () => {
    await post("ot-rot", { fecha: "2026-11-24" });
    // Y no las `horas_estimadas` del ciclo: esta orden nace cerrada, así que
    // ahí las horas ya no son una estimación sino cuánto duró el trabajo.
    expect(laNueva()?.horas).toBeNull();
  });

  it("deja el motivo escrito antes de cancelar, y si la nota no entra no cancela nada", async () => {
    falla.nota = true;
    const res = await post("ot-rot", { fecha: "2026-11-24" });

    expect(res.status).toBe(500);
    expect(porId("ot-rot")).toMatchObject({ estado: "ATRASADO", ciclo_id: "c1" });
  });

  it("cancela la rotación y la saca del ciclo", async () => {
    await post("ot-rot", { fecha: "2026-11-24" });

    expect(porId("ot-rot")).toMatchObject({
      estado: ESTADO_CANCELADA,
      ciclo_id: null,
    });
    const nota = tabla("ordenes_trabajo_notas")[0];
    expect(String(nota?.texto)).toContain("OT 3211");
  });

  it("mueve el corte del ciclo a la fecha del cambio", async () => {
    await post("ot-rot", { fecha: "2026-11-24" });

    expect(tabla("mant_ciclos_de_ot")[0]).toMatchObject({
      desde: "2026-11-24",
      vuelta_desde: 0,
    });
  });

  it("desengancha las órdenes del ciclo nacidas desde el cambio, y no las otras", async () => {
    await post("ot-rot", { fecha: "2026-11-18" });

    expect(porId("ot-h2")?.ciclo_id).toBeNull();
    expect(porId("ot-h1")?.ciclo_id).toBe("c1");
    // La recién creada no se desengancha a sí misma.
    expect(laNueva()?.ciclo_id).toBe("c1");
  });

  it("si la planilla no acepta el alta, no se tocó nada", async () => {
    google.alta = { ok: false, error: "la planilla está calculando" };
    const res = await post("ot-rot", { fecha: "2026-11-24" });

    expect(res.status).toBe(500);
    expect(tabla("ordenes_trabajo")).toHaveLength(3);
    expect(porId("ot-rot")).toMatchObject({ estado: "ATRASADO", ciclo_id: "c1" });
    expect(tabla("mant_ciclos_de_ot")[0]?.desde).toBe("2026-11-14");
  });

  it("una orden ya cancelada se rechaza con 400 y no escribe nada", async () => {
    base.reiniciar({
      ...ESTADO_INICIAL(),
      ordenes_trabajo: [{ ...LA_ROTACION, estado: ESTADO_CANCELADA }],
    });

    const res = await post("ot-rot", { fecha: "2026-11-24" });
    expect(res.status).toBe(400);
    expect(tabla("ordenes_trabajo")).toHaveLength(1);
  });

  it("una orden que no es de un ciclo se rechaza con 400", async () => {
    base.reiniciar({
      ...ESTADO_INICIAL(),
      ordenes_trabajo: [{ ...LA_ROTACION, ciclo_id: null }],
    });

    const res = await post("ot-rot", { fecha: "2026-11-24" });
    expect(res.status).toBe(400);
    expect(tabla("ordenes_trabajo")).toHaveLength(1);
  });

  it("con el ciclo apagado funciona igual", async () => {
    base.reiniciar({ ...ESTADO_INICIAL(), mant_ciclos_de_ot: [{ ...CICLO, activo: false }] });

    const res = await post("ot-rot", { fecha: "2026-11-24" });
    expect(res.status).toBe(201);
    expect(tabla("mant_ciclos_de_ot")[0]?.desde).toBe("2026-11-24");
  });

  it("un borrado de evento que falla no voltea nada", async () => {
    google.borrado = new Map([["ot-rot", "Google no contesta"]]);
    const res = await post("ot-rot", { fecha: "2026-11-24" });
    const cuerpo = await res.json();

    expect(res.status).toBe(201);
    expect(laNueva()).toBeTruthy();
    expect(porId("ot-rot")?.estado).toBe(ESTADO_CANCELADA);
    expect(String(cuerpo.calendario_error)).toContain("Google no contesta");
  });

  it("sin permiso de edición no escribe nada", async () => {
    sesion.puedeEditar = false;
    const res = await post("ot-rot", { fecha: "2026-11-24" });

    expect(res.status).toBe(403);
    expect(tabla("ordenes_trabajo")).toHaveLength(3);
  });

  it("una orden que no existe da 404", async () => {
    const res = await post("ot-fantasma", { fecha: "2026-11-24" });
    expect(res.status).toBe(404);
  });

  /*
   * El campo del motivo es el cableado: la regla de que se suma y no reemplaza
   * vive en `cambioFueraDeTurno`, y lo que este test mira es que la ruta se lo
   * pase — sin eso el campo del formulario se escribe y no llega a ningún lado,
   * que es el modo de falla que no se ve.
   */
  it("guarda en la nota lo que la persona escribió, y no pierde la frase automática", async () => {
    await post("ot-rot", { fecha: "2026-11-24", motivo: "Se partieron dos." });
    const nota = String(tabla("ordenes_trabajo_notas")[0]?.texto ?? "");
    expect(nota).toContain("Quedó registrado en la OT 3211");
    expect(nota).toContain("Se partieron dos.");
  });

  it("un motivo que no entra en la celda se rechaza y no escribe nada", async () => {
    const res = await post("ot-rot", { fecha: "2026-11-24", motivo: "x".repeat(1000) });
    expect(res.status).toBe(400);
    expect(tabla("ordenes_trabajo")).toHaveLength(3);
    expect(tabla("ordenes_trabajo_notas")).toHaveLength(0);
  });

  /*
   * `borrarLosEventosDeLasOT` borra en Google y **no toca la fila**: su único
   * llamador anterior era el borrado de espejo, donde la fila se iba por el
   * cascade de `ordenes_trabajo`. Acá la OT se cancela, así que la fila
   * sobrevive —y `revisarLaCasilla` la trae (tiene `google_event_id`, tiene
   * `inicio_escrito`, no está divergida y su `fin` no pasó), `leerEvento` la
   * devuelve cancelada, `queDivergio` dice **«borrado»** y sale un push
   * «Borraron en Google un evento de la Agenda» a las cinco personas que
   * estaban invitadas—. Y después «reescribir» lo **resucita** en los cinco
   * calendarios con un `PUT status: confirmed`. O sea: el paso que existe para
   * que nadie quede citado termina avisando una manipulación que no hubo.
   */
  it("borra también la fila del evento, no sólo el evento de Google", async () => {
    const res = await post("ot-rot", { fecha: "2026-11-24" });
    expect(res.status).toBe(201);
    expect(tabla("agenda_eventos").map((e) => e.id)).toEqual(["ev-otra"]);
  });

  it("si Google no pudo borrarlo, la fila se queda: es lo único que sabe dónde está", async () => {
    google.borrado = new Map([["ot-rot", "Google no contesta"]]);
    await post("ot-rot", { fecha: "2026-11-24" });
    expect(tabla("agenda_eventos").map((e) => e.id)).toEqual(["ev-rot", "ev-otra"]);
  });

  /*
   * El paso 5 es el único que el spec entero argumenta como imprescindible, y
   * era el único que no miraba su error. Con el corte sin mover y la rotación
   * ya cancelada y fuera del ciclo, la corrida siguiente mueve el corte sola
   * (la madre nueva está en rango porque su cierre no empata con el viejo) y la
   * de después encuentra a la hija 2 como última: **crea la vuelta 3, que es la
   * rotación recién cancelada**. El anti-objetivo, en silencio y con un 201.
   */
  it("si el corte no se pudo mover, lo dice en vez de contestar 201", async () => {
    falla.corte = true;
    const res = await post("ot-rot", { fecha: "2026-11-24" });
    expect(res.status).toBe(500);
    expect(String((await res.json()).error)).toContain("no se pudo mover el corte");
    expect(tabla("mant_ciclos_de_ot")[0]?.desde).toBe("2026-11-14");
  });

  /*
   * PostgREST corta en 1.000 sin avisar, y `generarEncadenadas` lee esta misma
   * tabla con este mismo filtro usando `traerTodo` «porque esto crece con cada
   * vuelta». Que un ciclo pase las 1.000 filas no es teórico acá: el 24/11/2026
   * Hidratación generó 427 OT en cuatro días por el defecto de `laUltimaEnRango`.
   * Con la lectura cortada, quedan hijas nacidas después del cambio dentro del
   * ciclo —y ésas son exactamente las que hacen que el ciclo cree la vuelta
   * siguiente ya atrasada—.
   */
  it("con más de mil órdenes en el ciclo, las desengancha a todas", async () => {
    const muchas = Array.from({ length: 1_200 }, (_, i) =>
      ot(`ot-m${i}`, 1, { ot_number: 9000 + i, created_at_app: "2026-11-25T09:00:00Z" })
    );
    base.reiniciar({ ...ESTADO_INICIAL(), ordenes_trabajo: [
      ...ESTADO_INICIAL().ordenes_trabajo, ...muchas,
    ] });

    const res = await post("ot-rot", { fecha: "2026-11-24" });
    expect(res.status).toBe(201);

    const quedan = tabla("ordenes_trabajo")
      .filter((o) => o.ciclo_id === "c1")
      .map((o) => o.id);
    // La madre recién creada y las dos hijas anteriores al cambio. Ninguna de
    // las 1.200.
    expect(quedan).toHaveLength(3);
  });

  /*
   * El camino vivo: «Registrar el trabajo» con resultado Parcial deja la orden
   * `EN_PROCESO` **con** fecha de cierre. La regla es de `cambioFueraDeTurno`;
   * lo que prueba este test es que la ruta le pase la fila entera y no sólo el
   * estado, que es el cableado.
   */
  it("una orden con fecha de cierre se rechaza aunque su estado diga abierta", async () => {
    base.reiniciar({ ...ESTADO_INICIAL(), ordenes_trabajo: [
      ot("ot-h1", 1), ot("ot-h2", 2),
      { ...LA_ROTACION, estado: "EN_PROCESO", fecha_cierre: "2026-11-25" },
    ] });

    const res = await post("ot-rot", { fecha: "2026-11-24" });
    expect(res.status).toBe(400);
    expect(tabla("ordenes_trabajo")).toHaveLength(3);
  });
});
