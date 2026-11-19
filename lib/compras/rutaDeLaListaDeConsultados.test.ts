import { describe, it, expect, vi, beforeEach } from "vitest";
import { supabaseDeMentira } from "@/lib/core/supabaseDeMentira";

/**
 * La ruta que administra `compras_consultados`, con un Supabase de mentira.
 *
 * **Es el tercer test de ruta del repo y tampoco es una plantilla.** La vara que
 * dejó escrita el segundo es que la regla **no se pueda sacar a `lib/`**, no que
 * probarla ahí sea incómodo. Acá no hay nada que sacar: esta ruta es una guardia,
 * el nombre de una tabla y la **ausencia** de una comprobación. Las tres viven en
 * el texto de la ruta y ninguna función pura las puede ver.
 *
 * Las tres cosas que mira, en orden de lo que costarían:
 *
 *  - **Que escriba `compras_consultados` y no `compras_aprobadores`.** Es el error
 *    que el diseño del 26/10/2026 existe para no cometer, por el lado de la
 *    escritura: `lib/compras/auth.test.ts` ya lo cubre por el lado de la lectura.
 *    Las dos tablas tienen la misma forma y viven en secciones contiguas de la
 *    misma pantalla, así que confundirlas no rompe nada —la pantalla se ve igual—
 *    y lo único que pasa es que administrar quién contesta agrega o saca
 *    aprobadores del gasto.
 *
 *  - **Que se pueda sacar al último.** Las dos listas hermanas se niegan
 *    (`puedeQuitarDeLaLista`, `puedeQuitarDeLaListaDeOS`) porque allá estar en la
 *    lista **es** el permiso y vaciarla traba el circuito. Acá no: estar en la
 *    lista es ser el destinatario de un aviso, contestar lo habilita el acceso a
 *    Compras, y con la lista vacía la pregunta se guarda igual y no interrumpe a
 *    nadie —`avisarAQuienDecide` devuelve «nadie aprueba» y `queDecirDelAviso` lo
 *    dice en pantalla—. Copiar esa guarda junto con el resto de la sección es el
 *    accidente más probable de esta tarea, y es un test negativo: prueba que algo
 *    **no** está.
 *
 *  - **Que administrarla pida administrar el módulo.** Quien contesta tiene nivel
 *    de edición en Compras y eso no alcanza, igual que en las otras dos: si
 *    alcanzara, cualquiera de la lista podría sacar a los demás.
 *
 * Lo que este test NO prueba, y conviene no creerle: que la tabla exista. La
 * migración `20261029082249` seguía sin aplicarse cuando se escribió —`PGRST205`
 * medido el 31/10/2026—, así que tampoco están probadas la clave foránea a
 * `usuarios`, su `on delete cascade` ni las policies.
 */

const base = supabaseDeMentira();

/** Quién mira y qué puede. Lo leen los mocks, así que cada test lo puede cambiar. */
const sesion = {
  usuario: { id: "admin" } as { id: string } | null,
  adminCompras: true,
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: sesion.usuario } }) },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => base.admin }));
vi.mock("@/lib/compras/auth", () => ({
  esAdminCompras: async () => sesion.adminCompras,
}));

import { POST, DELETE } from "@/app/api/compras/consultados/route";

const post = (cuerpo: unknown) =>
  POST(new Request("http://prueba/api", { method: "POST", body: JSON.stringify(cuerpo) }));
const borrar = (query: string) =>
  DELETE(new Request(`http://prueba/api?${query}`, { method: "DELETE" }));

/** Los usuario_id que quedaron en cada lista. */
const enLaLista = (tabla: string) =>
  (base.estado.tablas[tabla] ?? []).map((f) => f.usuario_id);

beforeEach(() => {
  sesion.usuario = { id: "admin" };
  sesion.adminCompras = true;
  base.reiniciar({
    // El reparto real medido el 26/10/2026: la lista de aprobadores tiene cuatro
    // personas y sólo Facundo contesta las consultas de repuestos.
    compras_aprobadores: [
      { usuario_id: "facundo", alias_planilla: "FO" },
      { usuario_id: "bernardo", alias_planilla: "BS" },
    ],
    compras_consultados: [{ usuario_id: "facundo" }],
  });
});

describe("sumar a alguien a la lista", () => {
  it("lo pone en compras_consultados", async () => {
    const res = await post({ usuario_id: "ana" });

    expect(res.status).toBe(201);
    expect(enLaLista("compras_consultados")).toEqual(["facundo", "ana"]);
  });

  /*
   * La que importa de verdad. Una ruta que escribiera la tabla de al lado haría
   * exactamente lo mismo en pantalla —la sección se recarga y muestra la lista que
   * le pasa el servidor— y el síntoma aparecería recién en Aprobaciones, con un
   * aprobador de más que nadie puso ahí.
   */
  it("no toca la lista de aprobadores", async () => {
    await post({ usuario_id: "ana" });
    await borrar("usuario_id=facundo");

    expect(enLaLista("compras_aprobadores")).toEqual(["facundo", "bernardo"]);
    expect(base.estado.lecturas).not.toContain("compras_aprobadores");
  });

  // Dos administradores a la vez, o el botón apretado dos veces: poner a alguien
  // que ya está es lo que ya se pidió, no un error que haya que mostrar.
  it("sumar a quien ya está no duplica ni falla", async () => {
    const res = await post({ usuario_id: "facundo" });

    expect(res.status).toBe(201);
    expect(enLaLista("compras_consultados")).toEqual(["facundo"]);
  });

  it("sin usuario no hace nada: 400", async () => {
    const res = await post({});

    expect(res.status).toBe(400);
    expect(base.estado.inserts).toEqual([]);
  });
});

describe("sacar a alguien de la lista", () => {
  it("lo saca", async () => {
    base.estado.tablas.compras_consultados.push({ usuario_id: "ana" });

    const res = await borrar("usuario_id=ana");

    expect(res.status).toBe(200);
    expect(enLaLista("compras_consultados")).toEqual(["facundo"]);
  });

  /*
   * El test negativo, y la única diferencia real con las dos listas hermanas.
   *
   * Allá sacar al último se rechaza con un 409 porque sin nadie en la lista
   * ningún requerimiento avanza. Acá vaciarla no traba nada: quien tenga acceso a
   * Compras sigue pudiendo contestar lo que haya abierto, y una pregunta nueva se
   * guarda en la OT igual —sólo que no interrumpe a nadie, y la pantalla de quien
   * pregunta lo dice—. Negarse sería inventar un permiso que esta lista no es.
   */
  it("se puede sacar al último y la lista queda vacía", async () => {
    expect(enLaLista("compras_consultados")).toEqual(["facundo"]);

    const res = await borrar("usuario_id=facundo");

    expect(res.status).toBe(200);
    expect(enLaLista("compras_consultados")).toEqual([]);
  });

  it("sin usuario no borra nada: 400", async () => {
    const res = await borrar("");

    expect(res.status).toBe(400);
    expect(enLaLista("compras_consultados")).toEqual(["facundo"]);
  });
});

describe("quién puede administrarla", () => {
  it("sin sesión, 401 y no se toca la lista", async () => {
    sesion.usuario = null;

    expect((await post({ usuario_id: "ana" })).status).toBe(401);
    expect((await borrar("usuario_id=facundo")).status).toBe(401);
    expect(enLaLista("compras_consultados")).toEqual(["facundo"]);
  });

  /*
   * Facundo está en la lista y tiene Compras, y eso no lo hace administrador de la
   * lista: si alcanzara con estar en ella, cualquiera podría sacar a los demás. Es
   * la misma guardia que las dos hermanas, a propósito —son tres secciones de la
   * misma pantalla y que se editen con reglas distintas es de las cosas que nadie
   * descubre hasta que a alguien le falta un botón—.
   */
  it("estar en la lista no alcanza para administrarla: 403", async () => {
    sesion.usuario = { id: "facundo" };
    sesion.adminCompras = false;

    expect((await post({ usuario_id: "ana" })).status).toBe(403);
    expect((await borrar("usuario_id=facundo")).status).toBe(403);
    expect(enLaLista("compras_consultados")).toEqual(["facundo"]);
  });
});
