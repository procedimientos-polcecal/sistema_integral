import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { hoyEnArgentina } from "@/lib/core/fechas";
import { puedeEditarDespacho } from "@/lib/despacho/auth";
import { empresasPorOdoo } from "@/lib/despacho/consultas";

/**
 * Dar de alta una orden de carga: el camión llegó y el encargado tiene el papel
 * del talonario en la mano.
 *
 * Lo primero que se pide es el **Nº del talonario**, porque es lo que tiene
 * delante. Es la clave natural de la tabla, así que el alta puede chocar con una
 * ya cargada: eso se contesta con un mensaje que diga cuál, no con un 500.
 *
 * El remito es **opcional a propósito**. Polysan deja remitos en `draft` y en
 * `confirmed` —39 en 90 días—, así que exigirlo dejaría al encargado sin poder
 * registrar un camión que está ahí. Cuando no hay remito, cliente y producto
 * entran a mano y la orden queda marcada como sin enlace, a la vista. **Nunca se
 * engancha "el que se le parece"**: un enlace equivocado no se nota nunca.
 */

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarDespacho(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permiso para cargar órdenes" }, { status: 403 });
  }

  const b = await cuerpoJson(request);

  const numero = String(b?.numero ?? "").trim();
  if (!numero) {
    return NextResponse.json(
      { error: "Falta el Nº de la orden de carga (el del talonario)" },
      { status: 400 }
    );
  }

  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(b?.fecha ?? ""))
    ? String(b!.fecha)
    : hoyEnArgentina();

  // La empresa se deduce del remito cuando hay remito, y si no viene explícita.
  // Sin ninguna de las dos no se inventa: es una columna `not null` y elegir una
  // al azar pondría el camión en el patrimonio que no es.
  const empresas = await empresasPorOdoo(supabase);
  const empresaId =
    (typeof b?.odoo_company_id === "number" ? empresas.get(b.odoo_company_id) : undefined) ??
    (typeof b?.empresa_id === "string" && b.empresa_id !== "" ? b.empresa_id : undefined);

  if (!empresaId) {
    return NextResponse.json(
      { error: "No se pudo determinar la empresa de la orden. Elegí el remito o la empresa." },
      { status: 400 }
    );
  }

  const fila = {
    numero,
    fecha,
    empresa_id: empresaId,
    odoo_picking_id: numeroOpcional(b?.odoo_picking_id),
    odoo_picking_name: textoOpcional(b?.odoo_picking_name),
    odoo_sale_name: textoOpcional(b?.odoo_sale_name),
    odoo_product_id: numeroOpcional(b?.odoo_product_id),
    cliente_raw: textoOpcional(b?.cliente_raw),
    producto_raw: textoOpcional(b?.producto_raw),
    cantidad: numeroOpcional(b?.cantidad),
    unidad: textoOpcional(b?.unidad),
    notas: textoOpcional(b?.notas),
    supervisor_raw: textoOpcional(b?.supervisor_raw),
    // El camión suele estar entrando justo cuando se da de alta la orden, así
    // que la pantalla puede pedir que se marque la entrada de una vez. Si no lo
    // pide, queda en `esperando` y se marca con el botón.
    entrada_predio: b?.marcar_entrada === true ? new Date().toISOString() : null,
    cargado_por: user.id,
  };

  const { data, error } = await supabase
    .from("despacho_ordenes_carga")
    .insert(fila)
    .select(
      "id, numero, fecha, empresa_id, odoo_picking_id, odoo_picking_name, odoo_sale_name, odoo_product_id, cliente_raw, producto_raw, cantidad, unidad, entrada_predio, inicio_carga, fin_carga, salida_predio, notas, supervisor_raw, supervisor_id, sheets_fila, sheets_pendiente, sheets_pendiente_en"
    )
    .single();

  if (error) {
    // 23505 es la violación de unicidad. Puede ser el Nº del talonario o el
    // remito, y decir cuál de los dos es la diferencia entre corregir un dígito
    // y no entender qué pasó.
    if (error.code === "23505") {
      const porRemito = error.message.includes("picking");
      return NextResponse.json(
        {
          error: porRemito
            ? "Ese remito ya tiene una orden de carga cargada."
            : `La orden Nº ${numero} ya está cargada.`,
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ data });
}

function textoOpcional(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const s = valor.trim();
  return s === "" ? null : s;
}

/** Odoo manda `false` para lo ausente, y `Number(false)` es 0: eso no entra. */
function numeroOpcional(valor: unknown): number | null {
  return typeof valor === "number" && !isNaN(valor) ? valor : null;
}
