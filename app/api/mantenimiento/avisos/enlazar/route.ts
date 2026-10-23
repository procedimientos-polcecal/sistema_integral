import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { marcarElAviso } from "@/lib/mantenimiento/marcarElAviso";
import { numeroDeOT } from "@/lib/mantenimiento/reutilizarOT";
import {
  loQueImpideEnlazar, loQueHayQueMirarAntesDeEnlazar, avisoDeEnlazada,
  type AvisoAEnlazar, type OTAEnlazar,
} from "@/lib/mantenimiento/enlazarOtAlAviso";

/**
 * Un aviso al que se le cuelga una orden de trabajo que ya existe.
 *
 * El encargado del área se adelanta y carga la OT por su lado; el aviso que
 * alguien había reportado queda pendiente para siempre aunque el trabajo ya
 * esté andando. Esto lo enlaza, sin crear nada y sin tocar la orden.
 *
 * El porqué de cada regla —por qué se muestra la orden antes de enlazar, qué
 * frena y qué sólo avisa— está en `lib/mantenimiento/enlazarOtAlAviso.ts`, que
 * es puro y tiene los tests. Acá sólo se busca, se escribe y se contesta.
 */

/**
 * GET: qué dice la OT de ese número, para poder mirarla antes de enlazar.
 *
 * **Va con el cliente del usuario y no con el admin**, igual que
 * `ordenes/reutilizar`: quien no puede ver una orden tampoco la puede enlazar,
 * y lo contesta RLS en vez de un chequeo aparte que después se desincronice.
 *
 * Sólo lee. Devuelve también lo que hay que mirar —equipo distinto, la orden
 * ya es de otro aviso— con la misma función que corre la pantalla.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const numero = numeroDeOT(params.get("numero") ?? "");
  const avisoId = String(params.get("aviso") ?? "").trim();

  if (numero === null) {
    return NextResponse.json({ error: "Falta el número de la OT." }, { status: 400 });
  }
  if (!avisoId) {
    return NextResponse.json({ error: "Falta el aviso." }, { status: 400 });
  }

  const { data: aviso, error: errorDelAviso } = await supabase
    .from("avisos")
    .select("oa_number, work_order_id, ot_asignada, equipment_id, equipo_raw, desestimado_en")
    .eq("id", avisoId)
    .maybeSingle();

  if (errorDelAviso) {
    return NextResponse.json({ error: errorDelAviso.message }, { status: 500 });
  }
  if (!aviso) return NextResponse.json({ error: "Ese aviso no existe." }, { status: 404 });

  const { data: ot, error } = await supabase
    .from("ordenes_trabajo")
    // Una sola línea y sin concatenar: partida con `+` deja de ser un literal y
    // Supabase pierde la inferencia de tipos. Es la regla de CLAUDE.md.
    .select("id, ot_number, fecha, descripcion, equipment_id, equipo_raw, sector_raw, especialidad, estado, avisos(oa_number)")
    .eq("ot_number", numero)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // El mismo mensaje para «no existe» y para «no la podés ver»: son dos cosas
  // distintas y lo que se puede hacer es lo mismo en los dos casos. Lo que sí
  // se dice es el camino, porque el caso frecuente es que la orden esté en la
  // planilla y todavía no se haya traído.
  if (!ot) {
    return NextResponse.json(
      {
        error:
          `No hay ninguna OT #${numero} en el sistema. Si el encargado la cargó en la ` +
          `planilla, traela primero desde Órdenes de trabajo y volvé a intentar.`,
      },
      { status: 404 }
    );
  }

  return NextResponse.json({
    data: ot,
    impide: loQueImpideEnlazar(aviso as AvisoAEnlazar, ot as OTAEnlazar),
    mirar: loQueHayQueMirarAntesDeEnlazar(aviso as AvisoAEnlazar, ot as OTAEnlazar),
  });
}

/**
 * POST: el aviso queda apuntando a esa orden.
 *
 * **Vuelve a buscar la OT por su número en vez de confiar en el id que mandó
 * la pantalla**, y vuelve a correr `loQueImpideEnlazar`. No es desconfianza
 * del formulario: entre que se miró la orden y se apretó el botón puede haber
 * pasado una sincronización, y lo que se guarda tiene que ser lo que la regla
 * aprueba ahora.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const body = await cuerpoJson(request);
  const avisoId = String(body?.id ?? "").trim();
  const numero = numeroDeOT(String(body?.numero ?? ""));

  if (!avisoId) return NextResponse.json({ error: "Falta el aviso." }, { status: 400 });
  if (numero === null) {
    return NextResponse.json({ error: "Falta el número de la OT." }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: aviso, error: errorDelAviso } = await admin
    .from("avisos")
    .select("id, oa_number, work_order_id, ot_asignada, equipment_id, equipo_raw")
    .eq("id", avisoId)
    .maybeSingle();

  if (errorDelAviso) {
    return NextResponse.json({ error: errorDelAviso.message }, { status: 500 });
  }
  if (!aviso) return NextResponse.json({ error: "Ese aviso no existe." }, { status: 404 });

  // La orden se busca con el cliente del usuario: enlazar una que no puede ver
  // sería ver por la ventana lo que RLS le tapa en la puerta.
  const { data: ot, error } = await supabase
    .from("ordenes_trabajo")
    .select("id, ot_number, fecha, descripcion, equipment_id, equipo_raw, sector_raw, especialidad, estado")
    .eq("ot_number", numero)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!ot) {
    return NextResponse.json(
      {
        error:
          `No hay ninguna OT #${numero} en el sistema. Si el encargado la cargó en la ` +
          `planilla, traela primero desde Órdenes de trabajo y volvé a intentar.`,
      },
      { status: 404 }
    );
  }

  const impide = loQueImpideEnlazar(aviso as AvisoAEnlazar, ot as OTAEnlazar);
  if (impide.length > 0) {
    return NextResponse.json({ error: impide.join(" ") }, { status: 409 });
  }

  const marca = await marcarElAviso(admin, aviso.id, ot.id, ot.ot_number);

  // No se pudo guardar es un fracaso, no una advertencia: el aviso sigue
  // pendiente y quien apretó tiene que volver a intentar.
  if (marca.error) return NextResponse.json({ error: marca.error }, { status: 500 });

  return NextResponse.json({
    ot_number: ot.ot_number,
    planilla_error: marca.planillaError,
    mensaje: avisoDeEnlazada(aviso.oa_number, ot.ot_number, marca.planillaError),
  });
}
