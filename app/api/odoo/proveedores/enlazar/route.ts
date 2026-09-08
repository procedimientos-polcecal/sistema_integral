import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { es_admin_check } from "@/lib/core/route-utils";
import { traerTodo } from "@/lib/core/paginado";
import { buscarLeer, credencialesQueFaltan, hayCredencialesOdoo } from "@/lib/odoo/client";
import { cruzarProveedores, filasParaGuardar } from "@/lib/odoo/proveedores";
import type { PartnerDeOdoo, ProveedorSdG } from "@/lib/odoo/proveedores";

/**
 * Guardar los enlaces proveedor del SdG ↔ partner de Odoo.
 * `POST /api/odoo/proveedores/enlazar` — sólo admin.
 *
 * Escribe en Supabase, **no en Odoo**. Lo que hace es persistir el cruce que
 * `/api/odoo/proveedores/preview` deja ver primero: por eso son dos rutas y no
 * una con un parámetro. Sin estos enlaces no hay `partner_id`, y sin
 * `partner_id` no hay orden de compra posible.
 *
 * Sólo enlaza lo que se puede afirmar por CUIT. Los que no —sin CUIT, con CUIT
 * que no está en Odoo, o con CUIT repetido en el padrón del SdG— se cuentan y se
 * informan, y no se enlazan por nombre parecido. Nunca.
 */

export const maxDuration = 120;

export async function POST() {
  const supabase = await createClient();
  const noAutorizado = await es_admin_check(supabase);
  if (noAutorizado) return noAutorizado;

  if (!hayCredencialesOdoo()) {
    return NextResponse.json(
      { error: `Faltan variables de entorno de Odoo: ${credencialesQueFaltan().join(", ")}` },
      { status: 503 }
    );
  }

  const admin = createAdminClient();

  try {
    const [delSdG, deOdoo, { data: empresas }] = await Promise.all([
      traerTodo<ProveedorSdG>((desde, hasta) =>
        admin.from("proveedores").select("id, nombre, cuit").range(desde, hasta)
      ),
      buscarLeer<PartnerDeOdoo>("res.partner", [["supplier_rank", ">", 0]], [
        "name",
        "vat",
        "company_id",
      ], { limite: 2000, orden: "name asc" }),
      admin.from("empresas").select("id, nombre, odoo_company_id"),
    ]);

    // Odoo habla de ids de `res.company`; el SdG, de uuids de `empresas`.
    const empresaPorOdoo = new Map<number, string>();
    for (const e of empresas ?? []) {
      if (e.odoo_company_id !== null) empresaPorOdoo.set(e.odoo_company_id, e.id);
    }
    const todasLasEmpresas = [...empresaPorOdoo.values()];

    if (!todasLasEmpresas.length) {
      return NextResponse.json(
        {
          error:
            "Ninguna empresa tiene odoo_company_id. Falta correr la migración que llena el mapeo.",
        },
        { status: 409 }
      );
    }

    const cruce = cruzarProveedores(delSdG, deOdoo);

    // Las reglas de qué fila va por empresa —y cuál gana cuando hay un partner
    // compartido y otro propio— viven en `filasParaGuardar`, con sus tests.
    const { filas, empresaDesconocida, compartidoPisado } = filasParaGuardar(
      cruce,
      empresaPorOdoo
    );

    /*
     * De a lotes: son cientos de filas y un upsert gigante arma una petición que
     * PostgREST puede rechazar sin decir por qué. 200 es el mismo tamaño que usa
     * el resto del repo para los `.in()`.
     */
    let guardadas = 0;
    for (let i = 0; i < filas.length; i += 200) {
      const lote = filas.slice(i, i + 200);
      const { error } = await admin
        .from("proveedores_odoo")
        .upsert(lote, { onConflict: "proveedor_id,empresa_id" });

      if (error) {
        return NextResponse.json(
          {
            error: `Falló el lote que arranca en la fila ${i}: ${error.message}`,
            guardadasAntesDeFallar: guardadas,
          },
          { status: 500 }
        );
      }
      guardadas += lote.length;
    }

    const porMotivo = { "sin cuit": 0, "cuit invalido": 0, "no esta en odoo": 0 };
    for (const s of cruce.sinEnlazar) porMotivo[s.motivo]++;

    return NextResponse.json({
      guardadas,
      proveedoresEnlazados: cruce.enlaces.length,
      enLasDosEmpresas: cruce.enlaces.filter((e) => e.partners.length > 1).length,
      sinEnlazar: cruce.sinEnlazar.length,
      porMotivo,
      cuitRepetidoEnSdG: cruce.cuitRepetidoEnSdG.length,
      empresaDesconocida,
      // Cuántas veces un partner propio de la empresa le ganó al compartido.
      compartidoPisado,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
