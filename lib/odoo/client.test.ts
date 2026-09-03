import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  autenticar,
  buscarLeer,
  agrupar,
  contar,
  contarPorEmpresa,
  crearEn,
  credencialesQueFaltan,
  empresasPermitidas,
  hayCredencialesOdoo,
  idDeRelacion,
  llamar,
  mensajeDeOdoo,
  nombreDeRelacion,
  olvidarSesionOdoo,
} from "./client";

/**
 * Todo con `fetch` mockeado: los tests no salen a la red. Lo que se verifica es
 * exactamente donde JSON-RPC se puede pagar caro —el sobre que se manda, la
 * sesion que se cachea, y los errores que Odoo esconde detras de un HTTP 200—.
 */

/** El sobre con el que Odoo contesta bien. */
function respuestaOk(result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, result }), { status: 200 });
}

/** El sobre con el que Odoo contesta mal: HTTP 200 igual, el error va adentro. */
function respuestaConError(name: string, message: string): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: 200,
        message: "Odoo Server Error",
        data: { name, message, debug: "Traceback (most recent call last):\n  File ..." },
      },
    }),
    { status: 200 }
  );
}

/** Lo que se le mando a Odoo en la llamada numero `n` (base 0). */
function sobreEnviado(fetchMock: ReturnType<typeof vi.fn>, n: number) {
  const [, init] = fetchMock.mock.calls[n];
  return JSON.parse((init as RequestInit).body as string);
}

function urlLlamada(fetchMock: ReturnType<typeof vi.fn>, n: number): string {
  return fetchMock.mock.calls[n][0] as string;
}

/**
 * Iniciar sesión son dos viajes: `authenticate` y el `read` de `res.users` que
 * resuelve qué empresas ve el bot. Este helper los deja encolados, así los tests
 * que van al ORM no repiten el andamiaje.
 */
function encolarSesion(
  mock: ReturnType<typeof vi.fn>,
  empresas: number[] = [1, 2],
  uid = 7
): void {
  mock
    .mockResolvedValueOnce(respuestaOk(uid))
    .mockResolvedValueOnce(
      respuestaOk([{ id: uid, company_ids: empresas, company_id: [empresas[0], "POLCECAL"] }])
    );
}

/** La primera llamada al ORM: la 0 y la 1 se las lleva iniciar sesión. */
const PRIMERA_AL_ORM = 2;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.ODOO_URL = "https://polcecal.odoo.com";
  process.env.ODOO_DB = "polcecal";
  process.env.ODOO_USER = "bot@polcecal.com";
  process.env.ODOO_API_KEY = "clave-de-prueba";

  olvidarSesionOdoo();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  // El cliente loguea el traceback de Python; en los tests sólo hace ruido.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("credenciales", () => {
  it("dice cuáles faltan, en vez de fallar con un mensaje genérico", () => {
    delete process.env.ODOO_API_KEY;
    delete process.env.ODOO_DB;

    expect(hayCredencialesOdoo()).toBe(false);
    expect(credencialesQueFaltan()).toEqual(["ODOO_DB", "ODOO_API_KEY"]);
  });

  it("con las cuatro puestas, no falta nada", () => {
    expect(hayCredencialesOdoo()).toBe(true);
    expect(credencialesQueFaltan()).toEqual([]);
  });
});

describe("autenticación", () => {
  it("manda db, usuario y clave al servicio common", async () => {
    encolarSesion(fetchMock);

    await expect(autenticar()).resolves.toBe(7);

    const sobre = sobreEnviado(fetchMock, 0);
    expect(sobre.params.service).toBe("common");
    expect(sobre.params.method).toBe("authenticate");
    expect(sobre.params.args.slice(0, 3)).toEqual([
      "polcecal",
      "bot@polcecal.com",
      "clave-de-prueba",
    ]);
  });

  it("una credencial mala devuelve false, no un error: hay que cortar ahí", async () => {
    // Un `Response` se consume al leerlo, así que cada llamada necesita el suyo.
    fetchMock.mockImplementation(() => Promise.resolve(respuestaOk(false)));

    // Lo que no tiene que pasar: que el `false` viaje como uid y el error
    // aparezca dos llamadas después hablando de otra cosa.
    await expect(autenticar()).rejects.toThrow(/rechazó las credenciales/);
    await expect(autenticar()).rejects.toThrow(/ODOO_API_KEY/);
  });

  it("la sesión se cachea: dos llamadas al ORM autentican una sola vez", async () => {
    encolarSesion(fetchMock);
    fetchMock
      .mockResolvedValueOnce(respuestaOk(3)) // search_count
      .mockResolvedValueOnce(respuestaOk(5)); // search_count

    await contar("res.partner");
    await contar("purchase.order");

    // Dos de sesión + dos de ORM: la sesión no se rearma en cada llamada.
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(sobreEnviado(fetchMock, 0).params.method).toBe("authenticate");
    expect(sobreEnviado(fetchMock, 1).params.args[4]).toBe("read");
    expect(sobreEnviado(fetchMock, 2).params.args[4]).toBe("search_count");
    expect(sobreEnviado(fetchMock, 3).params.args[4]).toBe("search_count");
  });

  it("olvidar la sesión fuerza a autenticar de nuevo (rotación de la API key)", async () => {
    encolarSesion(fetchMock);
    encolarSesion(fetchMock);

    await autenticar();
    olvidarSesionOdoo();
    await autenticar();

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(sobreEnviado(fetchMock, 2).params.method).toBe("authenticate");
  });
});

/**
 * El grupo son dos empresas y Odoo lleva cada registro por separado. Lo que se
 * verifica acá es la falla que **no se ve**: si no se manda
 * `allowed_company_ids`, Odoo devuelve sólo la empresa por defecto del usuario,
 * con HTTP 200 y sin ninguna advertencia.
 */
describe("las dos empresas", () => {
  it("toda llamada al ORM va con las dos empresas en el contexto", async () => {
    encolarSesion(fetchMock, [1, 2]);
    fetchMock.mockResolvedValueOnce(respuestaOk(0));

    await contar("purchase.order");

    const [, , , , , , kwargs] = sobreEnviado(fetchMock, PRIMERA_AL_ORM).params.args;
    expect(kwargs.context.allowed_company_ids).toEqual([1, 2]);
  });

  it("resuelve las empresas leyendo el propio usuario, no adivinando", async () => {
    encolarSesion(fetchMock, [1, 2]);

    await expect(empresasPermitidas()).resolves.toEqual([1, 2]);

    const { args } = sobreEnviado(fetchMock, 1).params;
    expect(args[3]).toBe("res.users");
    expect(args[6].context).toBeDefined();
    expect(args[5]).toEqual([[7], ["company_ids", "company_id"]]);
  });

  it("si el bot ve una sola empresa, no se inventa la otra", async () => {
    // Que sea visible es justamente el punto: el ping avisa, el cliente no miente.
    encolarSesion(fetchMock, [2]);
    fetchMock.mockResolvedValueOnce(respuestaOk(0));

    await contar("account.move");

    const [, , , , , , kwargs] = sobreEnviado(fetchMock, PRIMERA_AL_ORM).params.args;
    expect(kwargs.context.allowed_company_ids).toEqual([2]);
  });

  it("sin company_ids, cae en la empresa por defecto del usuario", async () => {
    fetchMock
      .mockResolvedValueOnce(respuestaOk(7))
      .mockResolvedValueOnce(respuestaOk([{ id: 7, company_id: [5, "POLYSAN"] }]));

    await expect(empresasPermitidas()).resolves.toEqual([5]);
  });

  it("leer una empresa puntual angosta el contexto a esa sola", async () => {
    encolarSesion(fetchMock, [1, 2]);
    fetchMock.mockResolvedValueOnce(respuestaOk([]));

    await buscarLeer("purchase.order", [], ["name"], { empresa: 2 });

    const [, , , , , , kwargs] = sobreEnviado(fetchMock, PRIMERA_AL_ORM).params.args;
    expect(kwargs.context.allowed_company_ids).toEqual([2]);
  });

  it("crearEn pone la empresa en los valores Y en el contexto", async () => {
    encolarSesion(fetchMock, [1, 2]);
    fetchMock.mockResolvedValueOnce(respuestaOk(931));

    await crearEn("purchase.order", 2, { partner_id: 44 });

    const [, , , modelo, metodo, args, kwargs] = sobreEnviado(fetchMock, PRIMERA_AL_ORM).params.args;
    expect([modelo, metodo]).toEqual(["purchase.order", "create"]);
    // En los vals, para que el registro quede en la empresa correcta...
    expect(args[0]).toEqual({ partner_id: 44, company_id: 2 });
    // ...y en el contexto, porque de ahí saca Odoo el diario y la secuencia.
    expect(kwargs.context.allowed_company_ids).toEqual([2]);
  });

  it("contarPorEmpresa devuelve id, nombre y cantidad por empresa", async () => {
    encolarSesion(fetchMock, [1, 2]);
    fetchMock.mockResolvedValueOnce(
      respuestaOk([
        { company_id: [1, "POLCECAL"], __count: 120 },
        { company_id: [2, "POLYSAN"], __count: 34 },
      ])
    );

    await expect(contarPorEmpresa("purchase.order")).resolves.toEqual([
      { empresa: 1, nombre: "POLCECAL", cantidad: 120 },
      { empresa: 2, nombre: "POLYSAN", cantidad: 34 },
    ]);

    const [, , , modelo, metodo, args] = sobreEnviado(fetchMock, PRIMERA_AL_ORM).params.args;
    expect([modelo, metodo]).toEqual(["purchase.order", "read_group"]);
    expect(args[2]).toEqual(["company_id"]);
  });
});

describe("llamadas al ORM", () => {
  beforeEach(() => {
    encolarSesion(fetchMock);
  });

  it("execute_kw va con el orden que Odoo espera y el contexto puesto", async () => {
    fetchMock.mockResolvedValueOnce(respuestaOk([{ id: 1, name: "ACME" }]));

    await llamar("res.partner", "read", [[1], ["name"]]);

    const { params } = sobreEnviado(fetchMock, PRIMERA_AL_ORM);
    expect(params.service).toBe("object");
    expect(params.method).toBe("execute_kw");

    const [db, uid, clave, modelo, metodo, args, kwargs] = params.args;
    expect([db, uid, clave]).toEqual(["polcecal", 7, "clave-de-prueba"]);
    expect(modelo).toBe("res.partner");
    expect(metodo).toBe("read");
    expect(args).toEqual([[1], ["name"]]);
    // La tz importa: sin ella, agrupar por día corre los registros de la noche.
    expect(kwargs.context).toMatchObject({ tz: "America/Argentina/Buenos_Aires" });
  });

  it("buscarLeer traduce las opciones a los kwargs de Odoo", async () => {
    fetchMock.mockResolvedValueOnce(respuestaOk([]));

    await buscarLeer("purchase.order", [["state", "=", "purchase"]], ["name", "amount_total"], {
      limite: 5,
      orden: "date_order desc",
      desplazamiento: 10,
    });

    const [, , , modelo, metodo, args, kwargs] = sobreEnviado(fetchMock, PRIMERA_AL_ORM).params.args;
    expect(modelo).toBe("purchase.order");
    expect(metodo).toBe("search_read");
    expect(args).toEqual([[["state", "=", "purchase"]]]);
    expect(kwargs).toMatchObject({
      fields: ["name", "amount_total"],
      limit: 5,
      offset: 10,
      order: "date_order desc",
    });
  });

  it("buscarLeer nunca manda un search_read sin fields", async () => {
    fetchMock.mockResolvedValueOnce(respuestaOk([]));

    await buscarLeer("account.move", [], ["name"]);

    // Sin `fields`, Odoo devuelve los 200+ campos de account.move.
    const [, , , , , , kwargs] = sobreEnviado(fetchMock, PRIMERA_AL_ORM).params.args;
    expect(kwargs.fields).toEqual(["name"]);
  });

  it("agrupar manda lazy en false para que agrupe por todos los campos pedidos", async () => {
    fetchMock.mockResolvedValueOnce(respuestaOk([]));

    await agrupar(
      "account.move.line",
      [["parent_state", "=", "posted"]],
      ["balance:sum"],
      ["journal_id"]
    );

    const [, , , modelo, metodo, args, kwargs] = sobreEnviado(fetchMock, PRIMERA_AL_ORM).params.args;
    expect(modelo).toBe("account.move.line");
    expect(metodo).toBe("read_group");
    expect(args).toEqual([[["parent_state", "=", "posted"]], ["balance:sum"], ["journal_id"]]);
    expect(kwargs.lazy).toBe(false);
  });
});

describe("transporte", () => {
  it("normaliza la barra final de la URL", async () => {
    process.env.ODOO_URL = "https://polcecal.odoo.com/";
    encolarSesion(fetchMock);

    await autenticar();

    // Con `//jsonrpc`, Odoo contesta un 404 en HTML que no explica nada.
    expect(urlLlamada(fetchMock, 0)).toBe("https://polcecal.odoo.com/jsonrpc");
  });

  it("un error de Odoo llega con HTTP 200 y hay que mirarlo igual", async () => {
    encolarSesion(fetchMock);
    fetchMock.mockResolvedValueOnce(
      respuestaConError(
        "odoo.exceptions.AccessError",
        "You are not allowed to access 'Journal' (account.journal) records."
      )
    );

    await expect(contar("account.journal")).rejects.toThrow(/no tiene permiso/);
  });

  it("una respuesta que no es JSON no se propaga como crash de parseo", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>502 Bad Gateway</html>", { status: 502 }));

    await expect(autenticar()).rejects.toThrow(/respondió 502/);
  });

  it("un timeout se cuenta como no llegar a Odoo, con la URL a la vista", async () => {
    fetchMock.mockRejectedValueOnce(new DOMException("The operation was aborted", "TimeoutError"));

    await expect(autenticar()).rejects.toThrow(/No se pudo llegar a Odoo/);
  });
});

describe("errores de Odoo, traducidos", () => {
  it("un permiso faltante dice dónde se arregla", () => {
    const m = mensajeDeOdoo({
      data: {
        name: "odoo.exceptions.AccessError",
        message: "You are not allowed to access 'Journal' (account.journal) records.",
        debug: "Traceback ...",
      },
    });

    expect(m).toContain("no tiene permiso");
    expect(m).toContain("account.journal");
    expect(m).toContain("Ajustes");
    // Lo que no tiene que pasar: escupir el traceback de Python en pantalla.
    expect(m).not.toContain("Traceback");
  });

  it("una base inexistente no habla de psycopg2: habla de ODOO_DB", () => {
    const m = mensajeDeOdoo({
      data: {
        name: "psycopg2.OperationalError",
        message:
          'connection to server at "192.168.1.1", port 5432 failed: FATAL: database "polcecal" does not exist',
      },
    });

    expect(m).toContain("ODOO_DB");
    // En Odoo.sh el nombre lleva el id del build y un redeploy puede cambiarlo.
    expect(m).toContain("Odoo.sh");
    expect(m).not.toMatch(/^Odoo respondió con un error/);
  });

  it("un modelo inexistente apunta a la app sin instalar", () => {
    const m = mensajeDeOdoo({
      data: { name: "KeyError", message: "Object hr.payslip doesn't exist" },
    });

    expect(m).toContain("no esté instalada");
  });

  it("una regla de negocio se distingue de un problema técnico", () => {
    const m = mensajeDeOdoo({
      data: {
        name: "odoo.exceptions.UserError",
        message: "No se puede modificar un asiento publicado.",
      },
    });

    expect(m).toContain("Una regla de Odoo lo impide");
    expect(m).toContain("asiento publicado");
  });

  it("un error sin nombre ni detalle no queda en blanco", () => {
    expect(mensajeDeOdoo({})).toContain("sin detalle");
  });

  it("recorta los mensajes largos en vez de volcar la novela", () => {
    const m = mensajeDeOdoo({ data: { name: "X", message: "a".repeat(5000) } });
    expect(m.length).toBeLessThan(400);
  });
});

describe("ayudantes de many2one", () => {
  it("un many2one vacío es false, no null: no puede pasar como nombre", () => {
    expect(nombreDeRelacion(false)).toBeNull();
    expect(idDeRelacion(false)).toBeNull();
  });

  it("un many2one cargado se parte en id y nombre", () => {
    expect(idDeRelacion([14, "Banco Galicia"])).toBe(14);
    expect(nombreDeRelacion([14, "Banco Galicia"])).toBe("Banco Galicia");
  });
});
