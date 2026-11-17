import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ENTIDADES, TIPOS_DE_ENTIDAD, queEs, quienesLoVen, quienesLoVenConDatos } from "./entidades";

/**
 * Un cliente de Supabase de mentira con las dos tablas que leen las funciones
 * de nivel: `usuarios` y `usuario_modulos`. Sólo implementa los eslabones de
 * cadena que esas funciones usan, y devuelve lo que devolvería PostgREST.
 */
type Usuario = { id: string; nombre: string; apellido: string; email: string | null; rol: string; activo: boolean };
type Grant = { id: string; usuario_id: string; modulo: string; nivel: string };

function falsoSupabase(
  usuarios: Usuario[],
  grants: Grant[],
  { fallaUsuarios = false }: { fallaUsuarios?: boolean } = {}
): SupabaseClient {
  const tabla = (nombre: string) => {
    const filtros: Record<string, unknown> = {};
    const filas = (): Record<string, unknown>[] => {
      const base = nombre === "usuarios" ? usuarios : grants;
      return base.filter((f) =>
        Object.entries(filtros).every(([c, v]) => (f as Record<string, unknown>)[c] === v)
      );
    };
    const respuesta = (data: unknown) =>
      fallaUsuarios && nombre === "usuarios"
        ? { data: null, error: { message: "la base no contesta" } }
        : { data, error: null };
    const b = {
      select: () => b,
      eq: (c: string, v: unknown) => { filtros[c] = v; return b; },
      order: () => b,
      range: (desde: number, hasta: number) =>
        Promise.resolve(respuesta(filas().slice(desde, hasta + 1))),
      single: () => Promise.resolve(respuesta(filas()[0] ?? null)),
      maybeSingle: () => Promise.resolve(respuesta(filas()[0] ?? null)),
      then: (resolver: (r: unknown) => unknown) => resolver(respuesta(filas())),
    };
    return b;
  };
  return { from: tabla } as unknown as SupabaseClient;
}

const u = (id: string, rol = "operario", extra: Partial<Usuario> = {}): Usuario => ({
  id, nombre: id, apellido: "Pérez", email: `${id}@polcecal.com`, rol, activo: true, ...extra,
});
const g = (usuario_id: string, modulo: string, nivel = "lectura"): Grant => ({
  id: `${usuario_id}-${modulo}`, usuario_id, modulo, nivel,
});

describe("el registro de entidades", () => {
  it("cada tipo del check de la migración está en el registro", () => {
    // Si alguien agrega un tipo a la migración y no acá, la ruta no sabría a
    // quién dejar entrar. Se lee el archivo y no una copia de la lista: una
    // copia es otra cosa que mantener sincronizada.
    const sql = readFileSync(
      path.join(import.meta.dirname, "../../supabase/migrations/20261111110717_mensajes_pegados_a_su_registro.sql"),
      "utf8"
    );
    const lista = /check \(entidad_tipo in \(([^)]*)\)\)/.exec(sql)?.[1];
    expect(lista).toBeTruthy();
    const delCheck = [...lista!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(delCheck.length).toBeGreaterThan(0);
    expect([...TIPOS_DE_ENTIDAD].sort()).toEqual(delCheck);
  });

  it("cada entidad declara la tabla, el nombre y el enlace", () => {
    for (const tipo of TIPOS_DE_ENTIDAD) {
      const e = ENTIDADES[tipo];
      expect(e.tabla).toMatch(/^[a-z_]+$/);
      expect(e.comoSeLlama.length).toBeGreaterThan(3);
      expect(e.ruta("11111111-1111-1111-1111-111111111111", 7)).toMatch(/^\//);
    }
  });

  it("un requerimiento lo ve cualquiera con sesión, y eso no es un error", async () => {
    // compras_requerimientos tiene el SELECT en `true` desde la migración 018,
    // con su razón escrita: «el circuito de compras es transversal a toda la
    // empresa». El hilo sigue al registro, no al módulo. Alguien sin ningún
    // módulo, ni siquiera Compras, lo ve igual.
    const sinNadaDeCompras = falsoSupabase([u("beto")], []);
    expect(await ENTIDADES.requerimiento.puedeVerlo(sinNadaDeCompras, "beto")).toBe(true);
  });

  it("una OT la ve quien tiene Mantenimiento, con el nivel que sea, y nadie más", async () => {
    const sb = falsoSupabase(
      [u("con"), u("sin"), u("otro")],
      [g("con", "mantenimiento"), g("otro", "compras", "admin")]
    );
    expect(await ENTIDADES.orden_trabajo.puedeVerlo(sb, "con")).toBe(true);
    expect(await ENTIDADES.orden_trabajo.puedeVerlo(sb, "sin")).toBe(false);
    // Ser admin de otro módulo no abre éste.
    expect(await ENTIDADES.orden_trabajo.puedeVerlo(sb, "otro")).toBe(false);
  });

  it("una condición insegura la ve quien tiene Seguridad e Higiene, y nadie más", async () => {
    const sb = falsoSupabase(
      [u("con"), u("sin")],
      [g("con", "seguridad_higiene"), g("sin", "mantenimiento", "admin")]
    );
    expect(await ENTIDADES.condicion_insegura.puedeVerlo(sb, "con")).toBe(true);
    expect(await ENTIDADES.condicion_insegura.puedeVerlo(sb, "sin")).toBe(false);
  });

  it("el admin del sistema ve todo", async () => {
    const sb = falsoSupabase([u("jefe", "admin_sistema")], []);
    expect(await ENTIDADES.orden_trabajo.puedeVerlo(sb, "jefe")).toBe(true);
    expect(await ENTIDADES.condicion_insegura.puedeVerlo(sb, "jefe")).toBe(true);
  });

  it("si no se pudo averiguar el permiso, lanza en vez de decir que no", async () => {
    // `nivelSyhDe` distingue «no tiene permiso» de «no se pudo averiguar». Un
    // `false` acá se contestaría con un 403 por una caída de la base.
    const sb = falsoSupabase([u("beto")], [g("beto", "seguridad_higiene")], { fallaUsuarios: true });
    await expect(ENTIDADES.condicion_insegura.puedeVerlo(sb, "beto")).rejects.toThrow(
      /Seguridad e Higiene.*la base no contesta/
    );
  });
});

describe("quienesLoVen", () => {
  const usuarios = [
    u("ana"), u("beto"), u("carla"),
    u("dora", "operario", { activo: false }),
    u("jefe", "admin_sistema"),
  ];
  const grants = [
    g("ana", "mantenimiento"), g("beto", "mantenimiento", "edicion"),
    g("carla", "compras"), g("dora", "mantenimiento"),
  ];

  it("devuelve a los activos que ven el tipo, y no a los inactivos aunque tengan el módulo", async () => {
    const sb = falsoSupabase(usuarios, grants);
    expect((await quienesLoVen(sb, "orden_trabajo")).sort()).toEqual(["ana", "beto", "jefe"]);
  });

  it("para el requerimiento son todos los activos", async () => {
    const sb = falsoSupabase(usuarios, grants);
    expect((await quienesLoVen(sb, "requerimiento")).sort()).toEqual(["ana", "beto", "carla", "jefe"]);
  });

  it("trae el nombre completo y deja el correo en null si no lo tiene", async () => {
    const sb = falsoSupabase(
      [u("ana"), u("beto", "operario", { email: null })],
      [g("ana", "mantenimiento"), g("beto", "mantenimiento")]
    );
    const r = await quienesLoVenConDatos(sb, "orden_trabajo");
    expect(r).toEqual([
      { id: "ana", nombre: "ana Pérez", email: "ana@polcecal.com" },
      { id: "beto", nombre: "beto Pérez", email: null },
    ]);
  });
});

describe("queEs y las rutas", () => {
  it("nombra el registro con su artículo y su número", () => {
    expect(queEs("orden_trabajo", 2983)).toBe("la orden de trabajo N° 2983");
    expect(queEs("requerimiento", 1234)).toBe("el requerimiento de compra N° 1234");
    expect(queEs("condicion_insegura", 12)).toBe("la condición insegura N° 12");
  });

  it("si el registro ya no está, queda sólo el nombre del tipo", () => {
    expect(queEs("orden_trabajo", null)).toBe("la orden de trabajo");
  });

  it("el enlace de una OT va al buscador con su número, porque no hay página por orden", () => {
    expect(ENTIDADES.orden_trabajo.ruta("x", 2983)).toBe("/mantenimiento/ordenes?q=2983");
    expect(ENTIDADES.orden_trabajo.ruta("x", null)).toBe("/mantenimiento/ordenes");
  });

  it("el enlace de un requerimiento lleva a Mis pedidos, que es de los catorce y no sólo de los ocho con Compras", () => {
    expect(ENTIDADES.requerimiento.ruta("abc")).toBe("/mis-pedidos?pedido=abc");
  });
});
