import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { esAdminCalidad, tieneAccesoCalidad } from "@/lib/calidad/auth";
import { traerBandeja, traerCarbonilleros } from "@/lib/calidad/consultas";
import type { CarbonReal } from "@/lib/calidad/types";

/**
 * Qué proveedor de Odoo es carbonillero, y de qué tipo.
 *
 * ES EL ÚNICO LUGAR DONDE SE DICE EL TIPO DE CARBÓN, porque no se puede deducir
 * de ningún lado: Membranex —el único residual— factura con el mismo producto
 * que los vegetales seis veces al año.
 *
 * El `GET` devuelve además **los partners que aparecieron en la bandeja sin
 * estar declarados**, para poder darlos de alta sin ir a buscar el id a Odoo.
 */
export async function GET() {
  const supabase = await createClient();
  const user = await usuarioActual();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await tieneAccesoCalidad(supabase, user.id))) {
    return NextResponse.json({ error: "Sin acceso a Calidad" }, { status: 403 });
  }

  const [carbonilleros, bandeja] = await Promise.all([
    traerCarbonilleros(supabase),
    traerBandeja(supabase),
  ]);

  const declarados = new Set(carbonilleros.map((c) => c.odoo_partner_id));
  const sinDeclarar = [
    ...new Map(
      bandeja
        .filter((l) => !declarados.has(l.odoo_partner_id))
        .map((l) => [l.odoo_partner_id, { id: l.odoo_partner_id, nombre: l.odoo_partner_nombre }])
    ).values(),
  ];

  return NextResponse.json({ carbonilleros, sinDeclarar });
}

interface CuerpoDelCarbonillero {
  id?: string;
  odoo_partner_id: number;
  empresa_id: string;
  proveedor_id?: string | null;
  carbon: CarbonReal;
  nombre_planilla: string;
  codigo_planilla: string;
  activo?: boolean;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const user = await usuarioActual();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await esAdminCalidad(supabase, user.id))) {
    return NextResponse.json({ error: "Sólo un admin de Calidad edita el catálogo" }, { status: 403 });
  }

  const c = await cuerpoJson<CuerpoDelCarbonillero>(request);

  if (!Number.isInteger(Number(c.odoo_partner_id))) {
    return NextResponse.json({ error: "Falta el partner de Odoo." }, { status: 400 });
  }
  if (c.carbon !== "vegetal" && c.carbon !== "residual") {
    return NextResponse.json({ error: "Falta el tipo de carbón." }, { status: 400 });
  }
  const nombre = (c.nombre_planilla ?? "").trim();
  const codigo = (c.codigo_planilla ?? "").trim();
  if (!nombre || !codigo) {
    return NextResponse.json(
      {
        error:
          "Faltan el código y el nombre de la planilla. Son los que el espejo escribe, y tienen que ser los que el libro ya usa.",
      },
      { status: 400 }
    );
  }

  const fila = {
    odoo_partner_id: Number(c.odoo_partner_id),
    empresa_id: c.empresa_id,
    proveedor_id: c.proveedor_id ?? null,
    carbon: c.carbon,
    nombre_planilla: nombre,
    codigo_planilla: codigo,
    activo: c.activo ?? true,
    actualizado_por: user.id,
    actualizado_en: new Date().toISOString(),
  };

  const { data, error } = c.id
    ? await supabase.from("calidad_carbonilleros").update(fila).eq("id", c.id).select("id").single()
    : await supabase
        .from("calidad_carbonilleros")
        .upsert(
          { ...fila, cargado_por: user.id },
          { onConflict: "odoo_partner_id,empresa_id" }
        )
        .select("id")
        .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Las líneas que estaban en la bandeja sólo por no estar declarado este
  // proveedor dejan de tener motivo: la próxima corrida las levanta.
  await supabase
    .from("calidad_odoo_sin_reconocer")
    .delete()
    .eq("odoo_partner_id", fila.odoo_partner_id);

  return NextResponse.json({ id: data.id });
}
