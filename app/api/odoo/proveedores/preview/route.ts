import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { es_admin_check } from "@/lib/core/route-utils";
import { traerTodo } from "@/lib/core/paginado";
import { buscarLeer, credencialesQueFaltan, hayCredencialesOdoo } from "@/lib/odoo/client";
import { cruzarProveedores } from "@/lib/odoo/proveedores";
import type { PartnerDeOdoo, ProveedorSdG } from "@/lib/odoo/proveedores";

/**
 * Qué pasaría si enlazáramos el padrón de proveedores con Odoo.
 * GET /api/odoo/proveedores/preview — sólo admin.
 *
 * **No escribe nada**, ni en Odoo ni en Supabase. Es un ensayo: muestra cuántos
 * enlazarían, cuántos quedarían afuera y por qué motivo, para poder revisarlo
 * antes de guardar una sola fila.
 *
 * Existe por una razón concreta: el 51% de los proveedores del SdG no tiene CUIT
 * y no se puede cruzar, y la tentación de resolverlos "por nombre parecido" es
 * exactamente el error que no se nota nunca. Que la decisión sea visible antes de
 * ejecutarse es más importante acá que en cualquier otra parte de la sync.
 */

export const maxDuration = 60;

export async function GET() {
  const supabase = await createClient();
  const noAutorizado = await es_admin_check(supabase);
  if (noAutorizado) return noAutorizado;

  if (!hayCredencialesOdoo()) {
    return NextResponse.json(
      { error: `Faltan variables de entorno de Odoo: ${credencialesQueFaltan().join(", ")}` },
      { status: 503 }
    );
  }

  try {
    // El padrón del SdG. `traerTodo` porque PostgREST corta en 1000 sin avisar y
    // este padrón crece: hoy son 287, pero el corte no se notaría.
    const delSdG = await traerTodo<ProveedorSdG>((desde, hasta) =>
      supabase.from("proveedores").select("id, nombre, cuit").range(desde, hasta)
    );

    /*
     * Los de Odoo, de las dos empresas. `supplier_rank > 0` es cómo Odoo marca a
     * un contacto como proveedor —no hay una bandera booleana—, y `company_id`
     * viene siempre porque un partner con empresa vacía es compartido por las dos
     * y eso cambia a qué empresa corresponde el enlace.
     */
    const deOdoo = await buscarLeer<PartnerDeOdoo>(
      "res.partner",
      [["supplier_rank", ">", 0]],
      ["name", "vat", "company_id"],
      { limite: 2000, orden: "name asc" }
    );

    const cruce = cruzarProveedores(delSdG, deOdoo);

    const porMotivo = { "sin cuit": 0, "cuit invalido": 0, "no esta en odoo": 0 };
    for (const s of cruce.sinEnlazar) porMotivo[s.motivo]++;

    const enDosEmpresas = cruce.enlaces.filter((e) => e.partners.length > 1).length;

    return NextResponse.json({
      padrones: { sdg: delSdG.length, odoo: deOdoo.length },
      resultado: {
        enlazarian: cruce.enlaces.length,
        deEsos_enLasDosEmpresas: enDosEmpresas,
        quedarianAfuera: cruce.sinEnlazar.length,
        porMotivo,
        cuitRepetidoEnSdG: cruce.cuitRepetidoEnSdG.length,
        // Proveedores que existen en Odoo y no en el padrón del SdG. No es un
        // error: puede ser el camino inverso (traerlos), pero conviene saberlo.
        partnersHuerfanos: cruce.partnersHuerfanos,
      },
      // Muestras cortas para poder mirar los casos con los ojos, no sólo contarlos.
      muestras: {
        enlaces: cruce.enlaces.slice(0, 5),
        enDosEmpresas: cruce.enlaces.filter((e) => e.partners.length > 1).slice(0, 3),
        cuitInvalido: cruce.sinEnlazar.filter((s) => s.motivo === "cuit invalido").slice(0, 10),
        noEstaEnOdoo: cruce.sinEnlazar.filter((s) => s.motivo === "no esta en odoo").slice(0, 10),
        sinCuit: cruce.sinEnlazar.filter((s) => s.motivo === "sin cuit").slice(0, 10),
        cuitRepetidoEnSdG: cruce.cuitRepetidoEnSdG.slice(0, 5),
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
