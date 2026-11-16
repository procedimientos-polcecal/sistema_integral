import { describe, it, expect, vi, beforeEach } from "vitest";
import { supabaseDeMentira, type Fila } from "@/lib/core/supabaseDeMentira";

/**
 * Las rutas que pegan un RI a un repuesto y eligen su artículo del pañol, con un
 * Supabase de mentira.
 *
 * **Existe por el cableado**, la única vara de la casa para tener un test de ruta:
 * lo que decide la ruta y `lib/` no puede ver porque es la unión entre la
 * petición y la base. Que un RI que no existe no se pegue (404), que sin edición no
 * se pegue nada (403), que un número mal escrito diga lo que es verdad (400), la
 * forma del `insert` —al artículo si el renglón lo tiene, al renglón si no—, el
 * 23505 del índice único traducido a 409, qué borra el DELETE en cada destino, que
 * cambiar el artículo con RI pegados se niegue, y que un fallo al armar la cuenta
 * **después de guardar** no se contesta como si no se hubiera guardado.
 *
 * **Las reglas de la cuenta no se prueban acá.** Que entren sólo los RI pegados a
 * mano y sólo órdenes abiertas, y los lotes de 200, viven en `cuentaDeUnRepuesto.ts`,
 * que toma el cliente como argumento y se prueba directo en
 * `cuentaDeUnRepuesto.test.ts`. Acá sólo se mira que la ruta la devuelva.
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

/** Para probar qué pasa si la cuenta falla **después** de que lo escrito ya se guardó. */
const cuentaFalla = { si: false };
vi.mock("@/lib/mantenimiento/cuentaDeUnRepuesto", async (importarOriginal) => {
  const real = await importarOriginal<typeof import("@/lib/mantenimiento/cuentaDeUnRepuesto")>();
  return {
    ...real,
    cuentaDeUnRepuesto: async (...args: Parameters<typeof real.cuentaDeUnRepuesto>) => {
      if (cuentaFalla.si) throw new Error("PGRST000 raw english from postgrest");
      return real.cuentaDeUnRepuesto(...args);
    },
  };
});

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
  cuentaFalla.si = false;
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

  it("un número mal escrito se rechaza con un 400 que dice lo que es verdad", async () => {
    const mensajes: [unknown, string][] = [
      [2.5, "entero mayor que cero"],
      [0, "entero mayor que cero"],
      ["abc", "entero mayor que cero"],
      [undefined, "Falta el número de RI"],
    ];
    for (const [valor, texto] of mensajes) {
      const r = await pegarRi(pedido("POST", { nro_ri: valor }), con("r1"));
      expect(r.status).toBe(400);
      const { error } = await r.json();
      expect(error).toContain(texto);
      expect(error).not.toMatch(/\bint\b|0 o más/);
    }
    expect(base.estado.inserts).toEqual([]);
  });

  it("si la cuenta falla después de guardar, contesta 200 con una advertencia y no 500", async () => {
    cuentaFalla.si = true;
    const r = await pegarRi(pedido("POST", { nro_ri: 500 }), con("r1"));
    expect(r.status).toBe(200);
    const cuerpo = await r.json();
    expect(cuerpo.cuenta).toBeNull();
    expect(cuerpo.advertencia).toMatch(/Se guardó/);
    expect(JSON.stringify(cuerpo)).not.toMatch(/PGRST|postgrest/i);
    expect(base.estado.tablas.mant_ri_de_repuesto).toHaveLength(1);
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
  const sacar = (nro: string, id = "r1") =>
    sacarRi(pedido("DELETE", undefined, `http://x/api${nro === "" ? "" : `?nro_ri=${nro}`}`), con(id));

  it("lo saca del artículo y deja la cuenta sin él", async () => {
    await pegarRi(pedido("POST", { nro_ri: 500 }), con("r1"));
    const r = await sacar("500");
    expect(r.status).toBe(200);
    expect(base.estado.tablas.mant_ri_de_repuesto).toEqual([]);
    expect((await r.json()).cuenta.estaOrden.cubiertas).toBe(0);
  });

  it("lo saca del renglón cuando el RI se pegó antes de elegir artículo", async () => {
    base.reiniciar({
      ...base.estado.tablas,
      mant_ri_de_repuesto: [{ id: "m1", nro_ri: 500, articulo_id: null, repuesto_id: "r1" }],
    });
    const r = await sacar("500");
    expect(r.status).toBe(200);
    expect(base.estado.tablas.mant_ri_de_repuesto).toEqual([]);
  });

  it("si está en los dos destinos, los saca a los dos; y no toca otros RI ni otros renglones", async () => {
    base.reiniciar({
      ...base.estado.tablas,
      mant_ri_de_repuesto: [
        { id: "m1", nro_ri: 500, articulo_id: "A", repuesto_id: null },
        { id: "m2", nro_ri: 500, articulo_id: null, repuesto_id: "r1" },
        { id: "m3", nro_ri: 501, articulo_id: "A", repuesto_id: null },
        { id: "m4", nro_ri: 500, articulo_id: null, repuesto_id: "otro" },
      ],
    });
    await sacar("500");
    expect(base.estado.tablas.mant_ri_de_repuesto.map((f) => f.id)).toEqual(["m3", "m4"]);
  });

  it("sin ?nro_ri dice que falta, y no lo toma por un 0", async () => {
    const r = await sacar("");
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("Falta el número de RI");
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

describe("cambiar o soltar el artículo con RI pegados al artículo", () => {
  const conUnRiPegado = () =>
    base.reiniciar({
      ...base.estado.tablas,
      mant_ri_de_repuesto: [{ id: "m1", nro_ri: 500, articulo_id: "A", repuesto_id: null }],
    });

  it("cambiarlo se niega con 409, y ni el artículo ni los RI se tocan", async () => {
    conUnRiPegado();
    const r = await ponerArticulo(pedido("PUT", { articulo_id: "B" }), con("r1"));
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/sacalos antes/);
    expect(base.estado.tablas.ordenes_trabajo_repuestos[0].articulo_id).toBe("A");
    expect(base.estado.tablas.mant_ri_de_repuesto).toHaveLength(1);
  });

  it("soltarlo se niega igual", async () => {
    conUnRiPegado();
    const r = await soltarArticulo(pedido("DELETE"), con("r1"));
    expect(r.status).toBe(409);
    expect(base.estado.tablas.ordenes_trabajo_repuestos[0].articulo_id).toBe("A");
  });

  it("sacando primero el RI, se puede cambiar", async () => {
    conUnRiPegado();
    await sacarRi(pedido("DELETE", undefined, "http://x/api?nro_ri=500"), con("r1"));
    const r = await ponerArticulo(pedido("PUT", { articulo_id: "B" }), con("r1"));
    expect(r.status).toBe(200);
    expect(base.estado.tablas.ordenes_trabajo_repuestos[0].articulo_id).toBe("B");
  });

  it("elegir el mismo artículo no es un cambio, aunque tenga RI", async () => {
    conUnRiPegado();
    const r = await ponerArticulo(pedido("PUT", { articulo_id: "A" }), con("r1"));
    expect(r.status).toBe(200);
  });

  it("los RI pegados al renglón no frenan el cambio", async () => {
    base.reiniciar({
      ...base.estado.tablas,
      mant_ri_de_repuesto: [{ id: "m1", nro_ri: 500, articulo_id: null, repuesto_id: "r1" }],
    });
    const r = await ponerArticulo(pedido("PUT", { articulo_id: "B" }), con("r1"));
    expect(r.status).toBe(200);
  });

  it("si la cuenta falla después de guardar, contesta 200 con una advertencia", async () => {
    cuentaFalla.si = true;
    const r = await ponerArticulo(pedido("PUT", { articulo_id: "B" }), con("r1"));
    expect(r.status).toBe(200);
    expect((await r.json()).advertencia).toMatch(/Se guardó/);
    expect(base.estado.tablas.ordenes_trabajo_repuestos[0].articulo_id).toBe("B");
  });
});

describe("el 409 dice qué bloquea", () => {
  it("lleva los números, aunque Compras ya no tenga ese RI", async () => {
    // El 777 no está en compras_requerimientos (la planilla lo dejó de tener): la cuenta no lo ve,
    // pero la fila sigue bloqueando y la pantalla necesita el número para poder sacarlo.
    base.reiniciar({
      ...base.estado.tablas,
      mant_ri_de_repuesto: [
        { id: "m1", nro_ri: 777, articulo_id: "A", repuesto_id: null },
        { id: "m2", nro_ri: 500, articulo_id: "A", repuesto_id: null },
        { id: "m3", nro_ri: 900, articulo_id: "B", repuesto_id: null },
      ],
    });
    const r = await ponerArticulo(pedido("PUT", { articulo_id: "B" }), con("r1"));
    expect(r.status).toBe(409);
    const cuerpo = await r.json();
    expect(cuerpo.ris_pegados).toEqual([500, 777]);
    expect(cuerpo.error).toContain("500, 777");
  });

  it("y se puede sacar por número un RI que Compras ya no tiene", async () => {
    base.reiniciar({
      ...base.estado.tablas,
      mant_ri_de_repuesto: [{ id: "m1", nro_ri: 777, articulo_id: "A", repuesto_id: null }],
    });
    const r = await sacarRi(pedido("DELETE", undefined, "http://x/api?nro_ri=777"), con("r1"));
    expect(r.status).toBe(200);
    expect(base.estado.tablas.mant_ri_de_repuesto).toEqual([]);
  });

  it("un artículo inexistente gana sobre el bloqueo: 404 y no 409", async () => {
    base.reiniciar({
      ...base.estado.tablas,
      mant_ri_de_repuesto: [{ id: "m1", nro_ri: 500, articulo_id: "A", repuesto_id: null }],
    });
    const r = await ponerArticulo(pedido("PUT", { articulo_id: "ZZ" }), con("r1"));
    expect(r.status).toBe(404);
  });

  it("un ?nro_ri mal escrito no saca el vínculo de otro RI", async () => {
    base.reiniciar({
      ...base.estado.tablas,
      mant_ri_de_repuesto: [{ id: "m1", nro_ri: 16, articulo_id: "A", repuesto_id: null }],
    });
    for (const q of ["0x10", "1e1", "16.0"]) {
      const r = await sacarRi(pedido("DELETE", undefined, `http://x/api?nro_ri=${q}`), con("r1"));
      expect(r.status).toBe(400);
    }
    expect(base.estado.tablas.mant_ri_de_repuesto).toHaveLength(1);
  });
});
