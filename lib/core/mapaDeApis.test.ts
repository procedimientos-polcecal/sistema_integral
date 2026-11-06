import { describe, it, expect } from "vitest";
import { dependenciasDe, exentasDeSesion, guardaDe, guardaEfectiva, metodosDe, rasgosDe, rutaDeLaUrl, tablasDe } from "./mapaDeApis";

/**
 * Los fragmentos de acá son **copiados de rutas reales**, no inventados.
 *
 * Es la lección del payload del push: un test que inventa la forma de lo que
 * lee afirma algo cierto sobre una forma que nadie produce. Cada caso dice de
 * qué archivo salió para que se pueda volver a mirar.
 */

describe("rutaDeLaUrl", () => {
  it("convierte la ruta del archivo en la url que se llama", () => {
    expect(rutaDeLaUrl("app/api/mantenimiento/avisos/route.ts")).toBe("/api/mantenimiento/avisos");
  });

  it("conserva el parámetro entre corchetes, que es como se lee en el código", () => {
    expect(rutaDeLaUrl("app/api/mantenimiento/ordenes/[id]/gut/route.ts")).toBe(
      "/api/mantenimiento/ordenes/[id]/gut",
    );
  });

  it("acepta separadores de Windows, que es donde corre esto", () => {
    expect(rutaDeLaUrl("app\\api\\home\\avisos\\route.ts")).toBe("/api/home/avisos");
  });
});

describe("metodosDe", () => {
  it("saca los verbos exportados, en el orden en que se leen", () => {
    const fuente = `
      export async function GET() {}
      export async function POST(request: Request) {}
      export async function DELETE(request: Request) {}
    `;
    expect(metodosDe(fuente)).toEqual(["GET", "POST", "DELETE"]);
  });

  it("no cuenta una mención en un comentario", () => {
    // El de `avisos/route.ts` habla del POST en su encabezado.
    const fuente = `/** El POST escribe primero en la planilla. */\nexport async function POST() {}`;
    expect(metodosDe(fuente)).toEqual(["POST"]);
  });

  it("una ruta sin handlers devuelve lista vacía y no rompe", () => {
    expect(metodosDe("// todavía nada")).toEqual([]);
  });
});

describe("guardaDe", () => {
  it("el secreto del cron gana sobre todo lo demás", () => {
    // `app/api/cron/compras-sync/route.ts`
    const fuente = `
      import { revisarElSecreto } from "@/lib/core/cron";
      const rechazo = revisarElSecreto(request);
      if (rechazo) return rechazo;
    `;
    expect(guardaDe(fuente).clase).toBe("secreto-de-cron");
  });

  it("un secreto propio es un webhook, y se nombra la variable", () => {
    // `app/api/facturacion/correo/webhook/route.ts`
    const fuente = `const secreto = process.env.FACTURACION_CORREO_SECRET;`;
    const guarda = guardaDe(fuente);
    expect(guarda.clase).toBe("secreto-propio");
    expect(guarda.detalle).toBe("FACTURACION_CORREO_SECRET");
  });

  it("un token del pedido contra la base también es una guarda", () => {
    // `app/api/agenda/google/route.ts`: Google avisa con el X-Goog-Channel-Token
    // que se guardó en `agenda_canales` al abrir el canal.
    const fuente = `
      import { tokenValido } from "@/lib/agenda/canales";
      const token = request.headers.get("x-goog-channel-token");
      if (!tokenValido(canal, token)) return noAutorizado();
    `;
    expect(guardaDe(fuente).clase).toBe("secreto-en-base");
  });

  it("pedir sesión y nada más es la guarda mínima", () => {
    // `app/api/home/avisos/route.ts`
    const fuente = `
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    `;
    expect(guardaDe(fuente).clase).toBe("sesion");
  });

  it("un permiso de módulo es más que una sesión, y se nombra cuál", () => {
    // `app/api/mantenimiento/avisos/route.ts`
    const fuente = `
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
      if (!(await puedeEditarMantenimiento(supabase, user.id))) {
        return NextResponse.json({ error: "..." }, { status: 403 });
      }
    `;
    const guarda = guardaDe(fuente);
    expect(guarda.clase).toBe("permiso");
    expect(guarda.detalle).toBe("puedeEditarMantenimiento");
  });

  it("sin ninguna de las cuatro lo dice, en vez de suponer que está protegida", () => {
    // Es el caso que hay que poder encontrar: el silencio no es una guarda.
    expect(guardaDe("export async function GET() { return Response.json({}); }").clase).toBe(
      "sin-guarda",
    );
  });
});

describe("tablasDe", () => {
  it("junta las tablas de los `.from(...)`, sin repetir y ordenadas", () => {
    const fuente = `
      await admin.from("ordenes_trabajo").insert(record);
      await admin.from("avisos").update(x);
      await admin.from("ordenes_trabajo").select("id");
    `;
    expect(tablasDe(fuente)).toEqual(["avisos", "ordenes_trabajo"]);
  });

  it("ignora un `.from(` que no sea un nombre literal", () => {
    // Con una variable adentro no se puede saber la tabla leyendo el archivo,
    // y decir el nombre de la variable sería peor que no decir nada.
    expect(tablasDe(`admin.from(tabla).select("*")`)).toEqual([]);
  });
});

describe("rasgosDe", () => {
  it("reconoce los seis rasgos que decide cada ruta", () => {
    const fuente = `
      import { createAdminClient } from "@/lib/supabase/admin";
      import { traerTodo } from "@/lib/core/paginado";
      import { agregarFila } from "@/lib/core/sheets";
      import { auditar } from "@/lib/core/auditoria";
      import { validar } from "@/lib/core/validar";
      const admin = createAdminClient();
      await traerTodo((d, h) => admin.from("x").select("*").range(d, h));
      await agregarFila(planilla, pestana, fila);
      await auditar(admin, { accion: "borrar" });
      const datos = validar(Esquema, cuerpo);
      export const maxDuration = 240;
    `;
    expect(rasgosDe(fuente)).toEqual({
      clienteAdmin: true,
      escribeEnPlanilla: true,
      audita: true,
      paginado: true,
      zod: true,
      maxDuration: 240,
    });
  });

  it("una ruta pelada no declara ninguno", () => {
    expect(rasgosDe("export async function GET() {}")).toEqual({
      clienteAdmin: false,
      escribeEnPlanilla: false,
      audita: false,
      paginado: false,
      zod: false,
      maxDuration: null,
    });
  });

  it("leer una planilla no es escribirla", () => {
    // La diferencia importa: lo que obliga a anotar un pendiente es escribir.
    const fuente = `import { leerValores } from "@/lib/core/sheets";\nconst filas = await leerValores(id, hoja);`;
    expect(rasgosDe(fuente).escribeEnPlanilla).toBe(false);
  });
});

describe("dependenciasDe", () => {
  it("junta los módulos de `lib/` de los que depende, que es con qué está conectada", () => {
    // `app/api/mantenimiento/avisos/route.ts`, recortado.
    const fuente = `
      import { createClient } from "@/lib/supabase/server";
      import { leerValores, agregarFila } from "@/lib/core/sheets";
      import { proximoNumeroDeAviso } from "@/lib/mantenimiento/avisos";
      import { NextResponse } from "next/server";
    `;
    expect(dependenciasDe(fuente)).toEqual([
      "lib/core/sheets",
      "lib/mantenimiento/avisos",
      "lib/supabase/server",
    ]);
  });

  it("deja afuera lo que no es del repo", () => {
    expect(dependenciasDe(`import { z } from "zod";`)).toEqual([]);
  });
});

/*
 * Lo que de verdad contesta «qué protege esta ruta».
 *
 * 87 de las 282 no escriben ninguna guarda en su archivo, y eso no quiere decir
 * abiertas: el docstring de `usuarioActual` dice que **el proxy es el que
 * protege a las que no validan por su cuenta**. La lista de las que el proxy
 * deja pasar se **lee del propio middleware** en vez de copiarse acá: dos
 * listas que tienen que coincidir es exactamente cómo este repo ya se cortó
 * tres veces.
 */
describe("exentasDeSesion", () => {
  it("saca del middleware las rutas que pasan sin sesión", () => {
    // Copiado de `lib/supabase/middleware.ts`.
    const fuente = `
      const esEndpointDeMaquina =
        path.startsWith("/api/cron/") ||
        path === "/api/compras/sheets/webhook" ||
        path === "/api/agenda/google";
    `;
    expect(exentasDeSesion(fuente)).toEqual([
      "/api/agenda/google",
      "/api/compras/sheets/webhook",
      "/api/cron/",
    ]);
  });
});

describe("guardaEfectiva", () => {
  const exentas = ["/api/cron/", "/api/agenda/google"];

  it("sin guarda en el archivo y detrás del proxy: la pone el proxy", () => {
    expect(guardaEfectiva("sin-guarda", "/api/administracion/empresas", exentas)).toBe("el proxy");
  });

  it("lo que el archivo sí declara manda sobre el proxy", () => {
    expect(guardaEfectiva("permiso", "/api/mantenimiento/avisos", exentas)).toBe("permiso");
  });

  it("exenta del proxy y sin guarda propia es ABIERTA, y hay que poder encontrarla", () => {
    // Es el único caso que de verdad no tiene nada: ni proxy ni archivo.
    expect(guardaEfectiva("sin-guarda", "/api/agenda/google", exentas)).toBe("ABIERTA");
  });

  it("una exenta por prefijo también cuenta, no sólo la igualdad", () => {
    expect(guardaEfectiva("secreto-de-cron", "/api/cron/compras-sync", exentas)).toBe("secreto-de-cron");
    expect(guardaEfectiva("sin-guarda", "/api/cron/lo-que-sea", exentas)).toBe("ABIERTA");
  });
});
