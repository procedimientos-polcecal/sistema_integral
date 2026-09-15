import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { esAdminCantera, tieneAccesoCantera } from "@/lib/cantera/auth";
import { traerTarifasAcarreo } from "@/lib/cantera/consultas";
import { esTipoDeAcarreoValido } from "@/lib/cantera/acarreo";

/**
 * Las tarifas de acarreo, por tipo y vigencia. `GET` con acceso al módulo
 * (las necesita el cálculo del pago); alta y edición sólo el admin.
 *
 * No se edita una vigencia vieja para "corregirla": se carga una nueva con su
 * propio `desde`, y si hace falta se le pone `hasta` a la anterior desde acá
 * mismo (`cerrar_anterior` en el alta). Cambiar el número de una vigencia ya
 * usada reescribiría el pago de meses que ya se cerraron.
 */

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await tieneAccesoCantera(supabase, user.id))) {
    return NextResponse.json({ error: "Sin acceso a Cantera" }, { status: 403 });
  }
  return NextResponse.json({ data: await traerTarifasAcarreo(supabase) });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await esAdminCantera(supabase, user.id))) {
    return NextResponse.json({ error: "Sólo un admin de Cantera edita las tarifas de acarreo" }, { status: 403 });
  }

  const b = await cuerpoJson(request);
  if (!esTipoDeAcarreoValido(b?.tipo)) {
    return NextResponse.json({ error: "Tipo de acarreo inválido" }, { status: 400 });
  }
  if (typeof b?.desde !== "string" || !FECHA.test(b.desde)) {
    return NextResponse.json({ error: "Falta la fecha desde (YYYY-MM-DD)" }, { status: 400 });
  }
  const tarifa = Number(b?.tarifa);
  if (!isFinite(tarifa) || tarifa < 0) {
    return NextResponse.json({ error: "La tarifa tiene que ser un número" }, { status: 400 });
  }

  // Cerrar la vigencia anterior del mismo tipo el día antes de la nueva, para
  // no dejar dos "vigentes" (hasta null) al mismo tiempo.
  if (b?.cerrar_anterior !== false) {
    const diaAnterior = new Date(`${b.desde}T00:00:00Z`);
    diaAnterior.setUTCDate(diaAnterior.getUTCDate() - 1);
    await supabase
      .from("cantera_tarifas_acarreo")
      .update({ hasta: diaAnterior.toISOString().slice(0, 10) })
      .eq("tipo", b.tipo)
      .is("hasta", null);
  }

  const { data, error } = await supabase
    .from("cantera_tarifas_acarreo")
    .insert({ tipo: b.tipo, desde: b.desde, hasta: null, tarifa })
    .select("id, tipo, desde, hasta, tarifa")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ data });
}
