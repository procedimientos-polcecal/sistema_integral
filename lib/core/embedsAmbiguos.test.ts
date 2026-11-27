import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { AMBIGUOS, embedsSinFk } from "./embedsAmbiguos";

describe("embedsSinFk", () => {
  const par = AMBIGUOS.find((a) => a.origen === "compras_requerimientos")!;

  /*
   * El caso real: así estaba escrito el 24/11/2026 en `lib/odoo/pushOrden.ts`,
   * y contra la base devolvía 300 PGRST201 — o sea que **ninguna** orden de
   * compra se podía generar, tampoco las que ya funcionaban. La suite estaba
   * verde y `tsc` limpio: el embed lo resuelve PostgREST del otro lado del
   * cable, así que no hay forma de verlo desde acá sin un control como éste.
   */
  it("encuentra el embed sin el FK nombrado", () => {
    const fuente = `
      await admin
        .from("compras_requerimientos")
        .select("id, nro_ri, proveedor_id, proveedores(nombre, cuit)")
        .eq("id", requerimientoId);
    `;
    expect(embedsSinFk(fuente, [par])).toEqual(["compras_requerimientos → proveedores"]);
  });

  it("con el FK nombrado no dice nada", () => {
    const fuente = `
      .from("compras_requerimientos")
      .select("id, proveedores!compras_requerimientos_proveedor_id_fkey(nombre, cuit)")
    `;
    expect(embedsSinFk(fuente, [par])).toEqual([]);
  });

  /*
   * El embed sólo es ambiguo desde la tabla que tiene dos caminos. Leer
   * `proveedores(...)` desde otra tabla es correcto y no se toca: un control
   * que pide el FK en todos lados se vuelve ruido y se apaga.
   */
  it("el mismo embed desde otra tabla no es ambiguo", () => {
    const fuente = `
      .from("compras_cotizaciones")
      .select("precio_unitario, proveedores(nombre)")
    `;
    expect(embedsSinFk(fuente, [par])).toEqual([]);
  });

  /*
   * El primer falso positivo que dio este control, y por eso queda fijado:
   * `app/api/mensajes/route.ts` nombra bien el FK del autor y adentro de
   * `mensajes_menciones(...)` lleva otro `usuarios(...)`, que es un embed de
   * esa tabla y tiene un solo camino. Un control que acusa a lo que está bien
   * se apaga, y entonces no defiende nada.
   */
  it("un embed anidado de la misma tabla no cuenta", () => {
    const mensajes = AMBIGUOS.find((a) => a.origen === "mensajes")!;
    const fuente = `
      .from("mensajes")
      .select("id, autor:usuarios!mensajes_creado_por_fkey(nombre), menciones:mensajes_menciones(usuario:usuarios(nombre))")
    `;
    expect(embedsSinFk(fuente, [mensajes])).toEqual([]);
  });

  it("no se confunde con una consulta posterior a otra tabla", () => {
    const fuente = `
      .from("compras_requerimientos").select("id, nro_ri").eq("id", x);
      ${" ".repeat(50)}
      .from("compras_cotizaciones").select("id, proveedores(nombre)");
    `;
    expect(embedsSinFk(fuente, [par])).toEqual([]);
  });
});

/**
 * El control de verdad: ningún archivo del repo embebe uno de estos pares sin
 * nombrar el FK. Lee el árbol como `sw.test.ts` lee `public/sw.js`, así que un
 * archivo nuevo entra solo y no hay una lista que se quede corta.
 */
describe("el árbol no tiene embeds ambiguos", () => {
  function archivos(dir: string, salida: string[] = []): string[] {
    for (const nombre of readdirSync(dir)) {
      if (nombre.startsWith(".") || nombre === "node_modules") continue;
      const ruta = join(dir, nombre);
      if (statSync(ruta).isDirectory()) archivos(ruta, salida);
      else if (/\.tsx?$/.test(nombre) && !nombre.endsWith(".test.ts")) salida.push(ruta);
    }
    return salida;
  }

  /*
   * El tope va escrito y no es el de vitest. Esto lee **todo** `app/` y `lib/`
   * —1.800 y pico de archivos— y corre un regex por cada uno: solo tarda ~1 s,
   * pero adentro de la suite compite con otros 470 archivos y el 26/11/2026 se
   * pasó de los 5 s por omisión (5.107 ms) sin que nada estuviera roto. El
   * árbol crece todas las semanas, así que ese tope se iba a cruzar igual; lo
   * que esto compra no es evitar un rojo sino que un rojo de este archivo
   * vuelva a significar «hay un embed ambiguo» y nada más.
   */
  it("ni en app/ ni en lib/", () => {
    const malos: string[] = [];
    for (const ruta of [...archivos("app"), ...archivos("lib")]) {
      for (const hallazgo of embedsSinFk(readFileSync(ruta, "utf8"), AMBIGUOS)) {
        malos.push(`${ruta}: ${hallazgo}`);
      }
    }
    expect(malos).toEqual([]);
  }, 60_000);
});
