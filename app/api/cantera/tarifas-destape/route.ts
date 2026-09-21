import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { esAdminCantera, tieneAccesoCantera } from "@/lib/cantera/auth";
import { traerTarifasDestape } from "@/lib/cantera/consultas";
import { CATEGORIAS_DE_TARIFA } from "@/lib/cantera/destape";

/**
 * Las tarifas de destape ($/h), por categoría+clave y vigencia. `GET` con
 * acceso al módulo (las necesita el cálculo del costo); alta sólo el admin
 * — mismo criterio que `/api/cantera/tarifas-acarreo`: no se edita una
 * vigencia vieja, se carga una nueva y se le pone `hasta` a la anterior.
 */

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await tieneAccesoCantera(supabase, user.id))) {
    return NextResponse.json({ error: "Sin acceso a Cantera" }, { status: 403 });
  }
  return NextResponse.json({ data: await traerTarifasDestape(supabase) });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await esAdminCantera(supabase, user.id))) {
    return NextResponse.json({ error: "Sólo un admin de Cantera edita las tarifas de destape" }, { status: 403 });
  }

  const b = await cuerpoJson(request);
  if (!(CATEGORIAS_DE_TARIFA as readonly string[]).includes(b?.categoria)) {
    return NextResponse.json({ error: "Categoría inválida" }, { status: 400 });
  }
  const clave = String(b?.clave ?? "").trim();
  if (!clave) return NextResponse.json({ error: "Falta la clave (equipo, tipo de camión, etc.)" }, { status: 400 });
  if (typeof b?.desde !== "string" || !FECHA.test(b.desde)) {
    return NextResponse.json({ error: "Falta la fecha desde (YYYY-MM-DD)" }, { status: 400 });
  }
  const tarifa = Number(b?.tarifa);
  if (!isFinite(tarifa) || tarifa < 0) {
    return NextResponse.json({ error: "La tarifa tiene que ser un número" }, { status: 400 });
  }

  if (b?.cerrar_anterior !== false) {
    const diaAnterior = new Date(`${b.desde}T00:00:00Z`);
    diaAnterior.setUTCDate(diaAnterior.getUTCDate() - 1);
    await supabase
      .from("cantera_tarifas_destape")
      .update({ hasta: diaAnterior.toISOString().slice(0, 10) })
      .eq("categoria", b.categoria)
      .eq("clave", clave)
      .is("hasta", null);
  }

  const { data, error } = await supabase
    .from("cantera_tarifas_destape")
    .insert({ categoria: b.categoria, clave, desde: b.desde, hasta: null, tarifa })
    .select("id, categoria, clave, desde, hasta, tarifa")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ data });
}
