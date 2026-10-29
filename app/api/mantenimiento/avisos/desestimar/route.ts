import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { COLUMNA_OBSERVACIONES } from "@/lib/mantenimiento/avisos";
import { escribirEnLaFilaDelAviso } from "@/lib/mantenimiento/planillaDelAviso";
import { camposDelPendiente, elIntentoDelAviso } from "@/lib/mantenimiento/pendienteDelAviso";
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
 *
 * ── LOS DOS CAMINOS SE ENCOLAN, Y UNO DE ELLOS VACÍA ────────────────────────
 *
 * Desde el 29/10/2026. Antes el fallo iba sólo a la pantalla y eso era un
 * agujero: `filaDeAviso` relee `OBSERVACIONES`, así que la sincronización
 * siguiente pisaba el campo con la celda vacía. Sobreviven `desestimado_en` y
 * `motivo_desestimado` —los que mandan en `estaDesestimado`—, así que la
 * decisión nunca se perdió; lo que se perdía era que la planilla se enterara.
 *
 * El DELETE **vacía** la celda, y ésa es justamente la mitad de por qué la cola
 * de los avisos guarda qué campo falló en vez de rearmar todo desde la fila:
 * con la regla de las OT —lo vacío no viaja— este camino no se podría encolar
 * nunca. El porqué completo está en `lib/mantenimiento/pendienteDelAviso.ts`.
 *
 * Y el 26/10/2026 se corrigió acá un mensaje que **mentía**: decía «se escribe
 * sola en la próxima sincronización» cuando `sincronizarAvisos` sólo leía.
 * Ahora es cierto, pero conviene recordar que lo fue por el arreglo y no por el
 * texto: la frase estuvo mal mientras no hubo drenaje.
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
  // dijo Google, sin traducir, y queda anotado para que lo termine el drenaje
  // de la próxima sincronización.
  const planilla_error = await escribirEnLaFilaDelAviso(aviso, [
    { columna: COLUMNA_OBSERVACIONES, valor: observacion },
  ]);

  await admin
    .from("avisos")
    .update(
      elIntentoDelAviso(
        planilla_error,
        ["observaciones"],
        camposDelPendiente(guardado.sheets_pendiente_campos)
      )
    )
    .eq("id", id);

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

  // Vaciar la celda es el cambio, no un efecto: dejar ahí «Desestimado el 21/10»
  // cuando ya no lo está es peor que no decir nada. Por eso este camino también
  // se encola — y es la mitad de por qué la cola de los avisos guarda el campo
  // en vez de rearmar todo desde la fila (ver `pendienteDelAviso.ts`).
  const fallo = await escribirEnLaFilaDelAviso(aviso, [
    { columna: COLUMNA_OBSERVACIONES, valor: "" },
  ]);

  await admin
    .from("avisos")
    .update(
      elIntentoDelAviso(
        fallo,
        ["observaciones"],
        camposDelPendiente(guardado.sheets_pendiente_campos)
      )
    )
    .eq("id", id);

  const planilla_error = fallo
    ? `Volvió a quedar pendiente en el sistema, pero la planilla sigue diciendo que se ` +
      `desestimó: ${fallo}. Se reintenta solo en la próxima sincronización.`
    : null;

  return NextResponse.json({ data: guardado, planilla_error });
}
