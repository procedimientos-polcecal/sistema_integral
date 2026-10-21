import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { escribirCeldas } from "@/lib/core/sheets";
import { COLUMNA_OBSERVACIONES } from "@/lib/mantenimiento/avisos";
import { hoyEnArgentina } from "@/lib/core/fechas";
import {
  loQueFaltaParaDesestimar, observacionDeLaDesestimacion,
} from "@/lib/mantenimiento/desestimarAviso";

/**
 * Un aviso que no va a ser orden de trabajo.
 *
 * Escribe en los dos lados, y en este orden: **primero la base y después la
 * planilla**. Es el contrario del alta de una OT y por una razón concreta —
 * allá la planilla manda, así que una orden sin fila no existe; acá el aviso
 * ya existe en las dos y lo que se agrega es una decisión del sistema. Si
 * Google no contesta, la decisión igual quedó tomada y se dice que la planilla
 * no se enteró, en vez de perder la decisión por una red caída.
 *
 * El texto va a `OBSERVACIONES` y **no a `OT ASIGNADA`**: esa columna quiere
 * decir *cuál* orden, y un aviso desestimado no tiene ninguna. El porqué
 * completo está en el encabezado de `lib/mantenimiento/desestimarAviso.ts`.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const body = await cuerpoJson(request);
  const id = String(body?.id ?? "").trim();
  const motivo = String(body?.motivo ?? "").trim();

  if (!id) return NextResponse.json({ error: "Falta el aviso" }, { status: 400 });

  const admin = createAdminClient();

  const { data: quien } = await admin
    .from("usuarios").select("nombre, apellido").eq("id", user.id).maybeSingle();
  const nombre = [quien?.nombre, quien?.apellido].filter(Boolean).join(" ").trim() || null;

  const cuando = hoyEnArgentina();
  const falta = loQueFaltaParaDesestimar({ motivo, cuando, quien: nombre });
  if (falta.length > 0) {
    return NextResponse.json({ error: `Falta ${falta.join(", ")}.` }, { status: 400 });
  }

  // Un aviso que ya tiene orden no se desestima: el trabajo existe. Se dice en
  // vez de dejarlo pasar — marcarlo escondería una OT en curso detrás de una
  // decisión que ya no corresponde.
  const { data: aviso, error: errorAlLeer } = await admin
    .from("avisos")
    .select("id, oa_number, sheets_row, work_order_id, ot_asignada")
    .eq("id", id)
    .maybeSingle();

  if (errorAlLeer) return NextResponse.json({ error: errorAlLeer.message }, { status: 500 });
  if (!aviso) return NextResponse.json({ error: "Ese aviso no existe" }, { status: 404 });

  if (aviso.work_order_id || String(aviso.ot_asignada ?? "").trim()) {
    return NextResponse.json(
      {
        error:
          `El aviso ${aviso.oa_number} ya tiene orden de trabajo ` +
          `(${aviso.ot_asignada ?? "creada desde el sistema"}), así que no se puede ` +
          `desestimar. Si esa orden no corresponde, hay que darla de baja a ella.`,
      },
      { status: 409 }
    );
  }

  const observacion = observacionDeLaDesestimacion({ motivo, cuando, quien: nombre });

  const { data: guardado, error } = await admin
    .from("avisos")
    .update({
      desestimado_en: new Date().toISOString(),
      desestimado_por: user.id,
      motivo_desestimado: motivo,
      // Se guarda también acá porque es lo que la planilla va a decir, y la
      // próxima importación lo va a traer de vuelta: si el sistema guardara
      // otra cosa, la sincronización la pisaría y parecería que se perdió.
      observaciones: observacion,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // La planilla. Un fallo acá **no deshace la decisión**: se informa con lo que
  // dijo Google, sin traducir, y queda para la próxima sincronización.
  let planilla_error: string | null = null;
  const planilla = process.env.GOOGLE_SHEETS_AVISOS_ID ?? "";
  const pestana = process.env.GOOGLE_SHEETS_AVISOS_TAB ?? "AVISOS";

  if (!planilla) {
    planilla_error =
      "Falta configurar GOOGLE_SHEETS_AVISOS_ID, así que la planilla no dice por qué " +
      "se desestimó. Quien la mire va a seguir viendo el aviso como pendiente.";
  } else if (!aviso.sheets_row) {
    planilla_error =
      `El aviso ${aviso.oa_number} no tiene fila conocida en la planilla, así que no se ` +
      `pudo escribir la observación. Se escribe sola en la próxima sincronización.`;
  } else {
    try {
      await escribirCeldas(planilla, [{
        pestana,
        fila: aviso.sheets_row,
        columna: COLUMNA_OBSERVACIONES,
        valor: observacion,
      }]);
    } catch (e) {
      planilla_error = e instanceof Error ? e.message : String(e);
    }
  }

  return NextResponse.json({ data: guardado, planilla_error });
}

/**
 * Deshacer: el aviso vuelve a estar pendiente.
 *
 * Existe porque desestimar **no es irreversible** —por eso tampoco se audita—
 * y porque la alternativa sería editar la base a mano. Limpia las tres
 * columnas juntas, que es lo que el `check` de la migración exige, y vacía la
 * observación de la planilla: dejar ahí «Desestimado el 21/10» cuando ya no lo
 * está es peor que no decir nada.
 */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "Falta el aviso" }, { status: 400 });

  const admin = createAdminClient();

  const { data: aviso } = await admin
    .from("avisos").select("id, oa_number, sheets_row, observaciones").eq("id", id).maybeSingle();
  if (!aviso) return NextResponse.json({ error: "Ese aviso no existe" }, { status: 404 });

  const { data: guardado, error } = await admin
    .from("avisos")
    .update({
      desestimado_en: null, desestimado_por: null,
      motivo_desestimado: null, observaciones: null,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let planilla_error: string | null = null;
  const planilla = process.env.GOOGLE_SHEETS_AVISOS_ID ?? "";
  const pestana = process.env.GOOGLE_SHEETS_AVISOS_TAB ?? "AVISOS";
  if (planilla && aviso.sheets_row) {
    try {
      await escribirCeldas(planilla, [{
        pestana, fila: aviso.sheets_row, columna: COLUMNA_OBSERVACIONES, valor: "",
      }]);
    } catch (e) {
      planilla_error =
        `Volvió a quedar pendiente en el sistema, pero la planilla sigue diciendo que se ` +
        `desestimó: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  return NextResponse.json({ data: guardado, planilla_error });
}
