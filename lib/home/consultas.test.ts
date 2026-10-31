import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { supabaseDeMentira, type Fila } from "@/lib/core/supabaseDeMentira";

/**
 * El conteo de consultas de repuestos sin responder, con un Supabase de mentira.
 *
 * ── POR QUÉ ESTO NO ES UN `count … head` ─────────────────────────────────────
 *
 * Los otros once conteos del resumen diario son un `count` del lado del servidor.
 * Éste no puede serlo: «pregunta abierta» es una anti-unión —sin RESPUESTA que la
 * apunte, sin otra PREGUNTA que la supere, con la OT todavía esperando y el
 * repuesto todavía en la lista— y PostgREST no la sabe expresar. Escribirla en SQL
 * sería una **segunda definición de «abierta»**, separada de la que tiene los tests
 * en `lib/mantenimiento/consultaDeRepuesto.ts`: el mismo error que el 27 de `gut.ts`
 * documenta, pero sin el test que allá ata las dos copias.
 *
 * Así que se traen las candidatas y se cuenta en TypeScript. Lo que eso trae de
 * vuelta es lo que se prueba acá, y es lo que `lib/` solo no puede ver: que la
 * lectura pagine, que los ids se pidan de a lotes, y que un fallo no apague el resto
 * de los avisos. El fake lo permite porque **corta en 1.000 filas y se niega a un
 * `.in()` de más de 200**, igual que PostgREST.
 *
 * Lo que este test NO prueba: que las tablas y las columnas existan, ni la RLS. La
 * RLS es justamente la razón de que esta lectura vaya con el cliente admin, y eso no
 * se puede comprobar sin la base — está medido y escrito en `consultas.ts`.
 */

const base = supabaseDeMentira();

/** Lo que devuelve `createAdminClient()`: el fake, o uno que se niega a leer. */
const cliente: { actual: unknown } = { actual: null };

// El factory se evalúa al importar el módulo, antes que las constantes de arriba:
// por eso lee `cliente` **adentro de la función** y no en su cuerpo.
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => cliente.actual }));

import { consultasDeRepuestosAbiertas } from "./consultas";

/** Una PREGUNTA abierta de la OT que le toque. */
const pregunta = (p: Fila = {}): Fila => ({
  id: "n1", orden_id: "ot1", tipo: "PREGUNTA", texto: "¿Llega antes del jueves?",
  creado_en: "2026-10-29T10:00:00Z", creado_por: "ana",
  repuesto_id: "r1", responde_a: null, ...p,
});

const respuesta = (p: Fila = {}): Fila =>
  pregunta({
    id: "n2", tipo: "RESPUESTA", texto: "Lo entrega el jueves", creado_por: "facundo",
    repuesto_id: null, responde_a: "n1", ...p,
  });

beforeEach(() => {
  cliente.actual = base.admin;
  base.reiniciar({
    ordenes_trabajo: [
      { id: "ot1", ot_number: 2885, estado: "POR_HACER" },
      { id: "ot2", ot_number: 2886, estado: "REALIZADO" },
    ],
    ordenes_trabajo_notas: [],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("cuántas consultas de repuestos esperan respuesta", () => {
  it("sin ninguna pregunta da cero, y no sale a buscar órdenes", async () => {
    base.estado.tablas.ordenes_trabajo_notas = [
      pregunta({ id: "j1", tipo: "JUSTIFICACION", repuesto_id: null }),
    ];

    expect(await consultasDeRepuestosAbiertas()).toBe(0);
    // Sin ids que pedir no hay consulta que hacer: un `.in("id", [])` es un viaje
    // de ida y vuelta para traer nada.
    expect(base.estado.lecturas).not.toContain("ordenes_trabajo");
  });

  it("cuenta las que todavía esperan y no las que ya se contestaron", async () => {
    base.estado.tablas.ordenes_trabajo_notas = [
      pregunta({ id: "n1", repuesto_id: "r1" }),
      pregunta({ id: "n2", repuesto_id: "r2" }),
      respuesta({ id: "n3", responde_a: "n2" }),
    ];

    expect(await consultasDeRepuestosAbiertas()).toBe(1);
  });

  /*
   * Cada orden se juzga con SU estado, y por eso hay que leer las órdenes: una
   * pregunta sobre una OT realizada ya no espera nada, y contarla sería pedirle a
   * alguien que conteste algo que no le sirve a nadie. Contado con un estado para
   * todas, el número es plausible y está mal — y un número no se ve raro en
   * ninguna pantalla.
   */
  it("una pregunta de una orden que ya no espera no se cuenta", async () => {
    base.estado.tablas.ordenes_trabajo_notas = [
      pregunta({ id: "n1", orden_id: "ot1" }),
      pregunta({ id: "n2", orden_id: "ot2" }),
    ];

    expect(await consultasDeRepuestosAbiertas()).toBe(1);
  });

  /*
   * Una justificación no puede abrir ni cerrar una pregunta —lo afirma
   * `TIPOS_QUE_DECIDEN_SI_UNA_PREGUNTA_ESPERA`, con su test—, así que la lectura
   * pide sólo PREGUNTA y RESPUESTA. Lo que el filtro del servidor ahorra es traer
   * el historial entero para contar tres; lo que no puede es cambiar el número, y
   * eso es lo que se fija acá, con el caso más hostil: una justificación que
   * apunta a la pregunta abierta.
   */
  it("una justificación entrometida no cambia el conteo", async () => {
    const conversacion = [pregunta({ id: "n1" })];
    base.estado.tablas.ordenes_trabajo_notas = conversacion;
    const sinElla = await consultasDeRepuestosAbiertas();

    base.estado.tablas.ordenes_trabajo_notas = [
      ...conversacion,
      pregunta({ id: "j1", tipo: "JUSTIFICACION", repuesto_id: null, responde_a: "n1" }),
    ];

    expect(await consultasDeRepuestosAbiertas()).toBe(sinElla);
    expect(sinElla).toBe(1);
  });

  /*
   * PostgREST corta en 1.000 filas y no avisa, así que un conteo que se topa con el
   * tope miente **hacia abajo** y en silencio: justo el error que no se nota, porque
   * un aviso que dice 1.000 cuando son 1.200 sigue sonando razonable.
   */
  it("no se queda en las primeras mil notas", async () => {
    const ordenes = Array.from({ length: 6 }, (_, i) => ({
      id: `ot${i}`, ot_number: i, estado: "POR_HACER",
    }));
    const notas = ordenes.flatMap((o) =>
      Array.from({ length: 200 }, (_, j) =>
        pregunta({ id: `${o.id}-${j}`, orden_id: o.id, repuesto_id: `r${j}` })
      )
    );
    base.reiniciar({ ordenes_trabajo: ordenes, ordenes_trabajo_notas: notas });

    expect(notas).toHaveLength(1200);
    expect(await consultasDeRepuestosAbiertas()).toBe(1200);
  });

  /*
   * Y las órdenes se piden de a lotes: un `.in()` con muchos ids arma una URL que
   * PostgREST rechaza con un 400 sin decir por qué. El fake se niega pasados los 200,
   * así que sin lotes esto no cuenta de menos: tira, y el conteo se va a cero.
   */
  it("pide las órdenes de a lotes y no todas de una", async () => {
    const ordenes = Array.from({ length: 250 }, (_, i) => ({
      id: `ot${i}`, ot_number: i, estado: "POR_HACER",
    }));
    const notas = ordenes.map((o) => pregunta({ id: `n-${o.id}`, orden_id: o.id }));
    base.reiniciar({ ordenes_trabajo: ordenes, ordenes_trabajo_notas: notas });

    expect(await consultasDeRepuestosAbiertas()).toBe(250);
  });

  /*
   * Un fallo de lectura devuelve 0 y se anota, no se relanza. No es la decisión
   * cómoda —un 0 por un fallo se lee igual que «no hay nada que contestar»— sino la
   * que ya tomaron sus dos vecinas de este archivo: este conteo corre dentro del
   * `Promise.all` de `avisosDeLosModulos`, que a su vez corre **una vez por persona
   * adentro del cron del resumen diario**. Un rechazo acá no apaga un aviso: apaga la
   * campana entera y el push de todo el mundo, y además deja sin guardar la foto del
   * día, con lo que el movimiento de mañana se calcula contra la de anteayer.
   */
  it("un fallo de lectura no apaga el resto de los avisos", async () => {
    const anotado = vi.spyOn(console, "error").mockImplementation(() => {});

    // Como contesta PostgREST cuando la lectura no se puede hacer: un error en vez
    // de filas. `traerTodo` lo tira, que es el camino que acá se prueba.
    cliente.actual = {
      from: () => {
        const consulta = {
          select: () => consulta,
          in: () => consulta,
          range: () => consulta,
          then: (resolver: (r: unknown) => unknown) =>
            Promise.resolve({ data: null, error: { message: "permission denied" } }).then(resolver),
        };
        return consulta;
      },
    };

    expect(await consultasDeRepuestosAbiertas()).toBe(0);
    expect(anotado).toHaveBeenCalled();
  });
});
