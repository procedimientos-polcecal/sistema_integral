import { describe, it, expect, vi, beforeEach } from "vitest";
import { supabaseDeMentira, type Fila } from "@/lib/core/supabaseDeMentira";

/**
 * Las rutas que pegan un RI a un repuesto y eligen su artículo del pañol, con un
 * Supabase de mentira.
 *
 * **Existe por el cableado y por nada más**, que es la única vara de la casa para
 * tener un test de ruta: la regla que no se puede sacar a `lib/` porque es la unión
 * entre dos piezas que por separado están bien. `repartir` (`loQueViene.ts`) es
 * aritmética pura y está probada sola, pero **reparte lo que le dan**: que le lleguen
 * *sólo* los RI pegados a mano —nunca los que el cruce por nombre de `riDelRepuesto`
 * adivina— y *sólo* órdenes abiertas lo decide quien la llama, y eso es esta ruta.
 * Las dos reglas salen del anti-objetivo de la función: un falso positivo del cruce,
 * o una orden ya terminada reclamando piezas, hace que otra lea «cubierta» por algo
 * que no es suyo. Ninguna de las dos piezas puede probarlo por su lado.
 *
 * Lo mismo con lo demás de acá: que un RI que no existe no se pegue, que pegarlo dos
 * veces no duplique —el 23505 del índice único se traduce a 409, y eso es de la
 * ruta— y que la cuenta pida de a lotes de 200 (el fake rechaza un `.in()` más
 * largo, así que sin lotes el test se vuelve 500).
 *
 * Lo que NO prueba, y conviene no creerle: que los índices existan con ese nombre
 * —el `alInsertar` de abajo *emula* su regla, no la ejecuta—, ni las policies, ni los
 * `on delete`. Para eso hace falta la base, y la migración se verificó aparte.
 */

/** El índice único: (articulo_id, nro_ri) y (repuesto_id, nro_ri), los nulos no chocan. */
const base = supabaseDeMentira({
  alInsertar: (tabla, fila, filas) => {
    if (tabla !== "mant_ri_de_repuesto") return null;
    const choca = filas.some(
      (f) =>
        f.nro_ri === fila.nro_ri &&
        ((fila.articulo_id != null && f.articulo_id === fila.articulo_id) ||
          (fila.repuesto_id != null && f.repuesto_id === fila.repuesto_id))
    );
    return choca
      ? {
          code: "23505",
          message: 'duplicate key value violates unique constraint "mant_ri_de_repuesto_articulo_ri_uq"',
        }
      : null;
  },
});

const sesion = { usuario: { id: "u1" } as { id: string } | null, edita: true };

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: sesion.usuario } }) } }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => base.admin }));
vi.mock("@/lib/mantenimiento/auth", () => ({
  puedeEditarMantenimiento: async () => sesion.edita,
  puedeVerMantenimiento: async () => true,
}));

import { PUT as ponerArticulo, DELETE as soltarArticulo } from "@/app/api/mantenimiento/repuestos/[id]/articulo/route";
import { POST as pegarRi, DELETE as sacarRi } from "@/app/api/mantenimiento/repuestos/[id]/ri/route";

const pedido = (metodo: string, cuerpo?: unknown, url = "http://x/api") =>
  new Request(url, {
    method: metodo,
    headers: { "content-type": "application/json" },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
const con = (id: string) => ({ params: Promise.resolve({ id }) });

const ri = (nro_ri: number, extra: Fila = {}): Fila => ({
  nro_ri, cantidad: 10, cantidad_recibida: 0,
  estado_compra: "PEDIDO", estado_aprobacion: "APROBADA", descripcion: null, ...extra,
});

/** Una orden con un renglón que usa el artículo A. */
const orden = (n: number, extra: Fila = {}): Fila[] => [
  { id: `o${n}`, ot_number: 3000 + n, fecha: "2026-11-01", estado: "PENDIENTE", ...extra },
];
const renglon = (n: number, extra: Fila = {}): Fila => ({
  id: `r${n}`, work_order_id: `o${n}`, nombre: "Martillo", articulo_id: "A", cantidad: "10", ...extra,
});

beforeEach(() => {
  sesion.usuario = { id: "u1" };
  sesion.edita = true;
  base.reiniciar({
    inventario_articulos: [{ id: "A" }, { id: "B" }],
    ordenes_trabajo: orden(1),
    ordenes_trabajo_repuestos: [renglon(1)],
    compras_requerimientos: [ri(500)],
    mant_ri_de_repuesto: [],
  });
});

describe("pegar un RI", () => {
  it("no pega un RI que no existe, y no inserta nada", async () => {
    const r = await pegarRi(pedido("POST", { nro_ri: 999 }), con("r1"));
    expect(r.status).toBe(404);
    expect(base.estado.inserts).toEqual([]);
  });

  it("sin nivel de edición no pega nada", async () => {
    sesion.edita = false;
    const r = await pegarRi(pedido("POST", { nro_ri: 500 }), con("r1"));
    expect(r.status).toBe(403);
    expect(base.estado.inserts).toEqual([]);
  });

  it("un número que no es un entero positivo se rechaza con un 400", async () => {
    const r = await pegarRi(pedido("POST", { nro_ri: "abc" }), con("r1"));
    expect(r.status).toBe(400);
    expect(base.estado.inserts).toEqual([]);
  });

  it("si el renglón tiene artículo, el RI va al artículo; si no, al renglón", async () => {
    await pegarRi(pedido("POST", { nro_ri: 500 }), con("r1"));
    expect(base.estado.inserts).toHaveLength(1);
    expect(base.estado.inserts[0]).toMatchObject({ nro_ri: 500, articulo_id: "A", creado_por: "u1" });
    expect(base.estado.inserts[0].repuesto_id ?? null).toBeNull();

    base.reiniciar({
      ...base.estado.tablas,
      ordenes_trabajo_repuestos: [renglon(1, { articulo_id: null })],
      mant_ri_de_repuesto: [],
    });
    await pegarRi(pedido("POST", { nro_ri: 500 }), con("r1"));
    expect(base.estado.inserts[0]).toMatchObject({ nro_ri: 500, repuesto_id: "r1" });
    expect(base.estado.inserts[0].articulo_id ?? null).toBeNull();
  });

  it("pegar dos veces el mismo RI al mismo destino no duplica: 409 y una sola fila", async () => {
    const uno = await pegarRi(pedido("POST", { nro_ri: 500 }), con("r1"));
    expect(uno.status).toBe(200);
    const dos = await pegarRi(pedido("POST", { nro_ri: 500 }), con("r1"));
    expect(dos.status).toBe(409);
    expect((await dos.json()).error).toMatch(/ya está pegado/i);
    expect(base.estado.tablas.mant_ri_de_repuesto).toHaveLength(1);
  });

  it("devuelve la cuenta de lo que viene para esa orden", async () => {
    const r = await pegarRi(pedido("POST", { nro_ri: 500 }), con("r1"));
    const { cuenta } = await r.json();
    expect(cuenta.estaOrden).toMatchObject({ orden_id: "o1", pide: 10, cubiertas: 10, faltaPedir: 0 });
  });
});

describe("sacar un RI", () => {
  it("lo saca del destino del renglón y deja la cuenta sin él", async () => {
    await pegarRi(pedido("POST", { nro_ri: 500 }), con("r1"));
    const r = await sacarRi(pedido("DELETE", undefined, "http://x/api?nro_ri=500"), con("r1"));
    expect(r.status).toBe(200);
    expect(base.estado.tablas.mant_ri_de_repuesto).toEqual([]);
    expect((await r.json()).cuenta.estaOrden.cubiertas).toBe(0);
  });
});

describe("elegir el artículo del renglón", () => {
  it("elige el artículo y escribe articulo_id en la fila", async () => {
    base.reiniciar({ ...base.estado.tablas, ordenes_trabajo_repuestos: [renglon(1, { articulo_id: null })] });
    const r = await ponerArticulo(pedido("PUT", { articulo_id: "B" }), con("r1"));
    expect(r.status).toBe(200);
    expect(base.estado.tablas.ordenes_trabajo_repuestos[0].articulo_id).toBe("B");
  });

  it("un artículo que no existe no se elige", async () => {
    const r = await ponerArticulo(pedido("PUT", { articulo_id: "ZZ" }), con("r1"));
    expect(r.status).toBe(404);
    expect(base.estado.tablas.ordenes_trabajo_repuestos[0].articulo_id).toBe("A");
  });

  it("soltar el artículo lo deja en null y no borra el renglón", async () => {
    const r = await soltarArticulo(pedido("DELETE"), con("r1"));
    expect(r.status).toBe(200);
    expect(base.estado.tablas.ordenes_trabajo_repuestos).toHaveLength(1);
    expect(base.estado.tablas.ordenes_trabajo_repuestos[0].articulo_id).toBeNull();
  });
});

describe("la cuenta que devuelven", () => {
  it("con más de 200 órdenes pidiendo lo mismo, pide de a lotes", async () => {
    const ordenes = Array.from({ length: 250 }, (_, i) => orden(i + 1)[0]);
    const renglones = Array.from({ length: 250 }, (_, i) => renglon(i + 1));
    base.reiniciar({
      ...base.estado.tablas,
      ordenes_trabajo: ordenes,
      ordenes_trabajo_repuestos: renglones,
    });
    const r = await pegarRi(pedido("POST", { nro_ri: 500 }), con("r1"));
    expect(r.status).toBe(200);
    const { cuenta } = await r.json();
    expect(cuenta.partes).toHaveLength(250);
  });

  it("una OT realizada no entra en el reparto", async () => {
    // La 1 es la más vieja pero está REALIZADA: si entrara, se llevaría los 10 y la 2 quedaría sin nada.
    base.reiniciar({
      ...base.estado.tablas,
      ordenes_trabajo: [
        ...orden(1, { estado: "REALIZADO", fecha: "2026-10-01" }),
        ...orden(2),
      ],
      ordenes_trabajo_repuestos: [renglon(1), renglon(2)],
    });
    const r = await pegarRi(pedido("POST", { nro_ri: 500 }), con("r2"));
    const { cuenta } = await r.json();
    expect(cuenta.partes.map((p: { orden_id: string }) => p.orden_id)).toEqual(["o2"]);
    expect(cuenta.estaOrden).toMatchObject({ orden_id: "o2", cubiertas: 10 });
  });

  it("un RI que sólo encontró el cruce por nombre no entra en la cuenta", async () => {
    // El 600 coincide por descripción con el repuesto y está en vuelo, pero nadie lo pegó.
    base.reiniciar({
      ...base.estado.tablas,
      compras_requerimientos: [ri(500, { cantidad: 4 }), ri(600, { cantidad: 100, descripcion: "Martillo" })],
    });
    const r = await pegarRi(pedido("POST", { nro_ri: 500 }), con("r1"));
    const { cuenta } = await r.json();
    expect(cuenta.estaOrden).toMatchObject({ pide: 10, cubiertas: 4, faltaPedir: 6 });
    expect(cuenta.ris.map((x: { nro_ri: number }) => x.nro_ri)).toEqual([500]);
  });

  it("el mismo RI en el artículo y en un renglón de ese artículo se cuenta una sola vez", async () => {
    base.reiniciar({
      ...base.estado.tablas,
      compras_requerimientos: [ri(500, { cantidad: 10 })],
      mant_ri_de_repuesto: [
        { id: "m1", nro_ri: 500, articulo_id: "A", repuesto_id: null },
        { id: "m2", nro_ri: 500, articulo_id: null, repuesto_id: "r1" },
      ],
    });
    const r = await pegarRi(pedido("POST", { nro_ri: 500 }), con("r1")).catch(() => null);
    // Pegarlo de nuevo choca con el índice del artículo (409): lo que importa es la cuenta que sale.
    expect(r?.status).toBe(409);
    const base2 = await ponerArticulo(pedido("PUT", { articulo_id: "A" }), con("r1"));
    const { cuenta } = await base2.json();
    expect(cuenta.ris).toHaveLength(1);
    expect(cuenta.estaOrden).toMatchObject({ pide: 10, cubiertas: 10 });
  });
});
