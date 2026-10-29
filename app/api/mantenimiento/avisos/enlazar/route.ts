import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { marcarElAviso } from "@/lib/mantenimiento/marcarElAviso";
import { numeroDeOT } from "@/lib/mantenimiento/reutilizarOT";
import { COLUMNA_OT_ASIGNADA } from "@/lib/mantenimiento/avisos";
import { escribirEnLaFilaDelAviso } from "@/lib/mantenimiento/planillaDelAviso";
import { camposDelPendiente, elIntentoDelAviso } from "@/lib/mantenimiento/pendienteDelAviso";
import {
  loQueImpideEnlazar, loQueHayQueMirarAntesDeEnlazar, avisoDeEnlazada,
  loQueImpideDesenlazar, avisoDeDesenlazada,
  type AvisoAEnlazar, type OTAEnlazar, type AvisoADesenlazar,
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

  // El cuarto argumento es lo que distingue este camino del de «Generar OT»,
  // y es lo único que después habilita a desenlazar: acá la orden ya existía.
  const marca = await marcarElAviso(admin, aviso.id, ot.id, ot.ot_number, user.id);

  // No se pudo guardar es un fracaso, no una advertencia: el aviso sigue
  // pendiente y quien apretó tiene que volver a intentar.
  if (marca.error) return NextResponse.json({ error: marca.error }, { status: 500 });

  return NextResponse.json({
    ot_number: ot.ot_number,
    planilla_error: marca.planillaError,
    mensaje: avisoDeEnlazada(aviso.oa_number, ot.ot_number, marca.planillaError),
  });
}

/**
 * DELETE: deshacer el enlace. El aviso vuelve a estar pendiente.
 *
 * Existe por lo mismo que el DELETE de `avisos/desestimar`: sin esto, la única
 * forma de arreglar un número mal tipeado —la 2815 en lugar de la 2814— sería
 * editar la base a mano. Y acá hace más falta todavía, porque enlazar es
 * justamente escribir un número con los dedos.
 *
 * **Qué se puede desenlazar lo decide `loQueImpideDesenlazar`**, que es pura y
 * tiene los tests: no todo aviso con OT se deshace, y el que no se deshace es
 * el caso frecuente —182 de 186 tienen el número escrito a mano en la planilla
 * y vaciar esa celda sería pisarlo—. El porqué de los tres casos está en el
 * encabezado de `lib/mantenimiento/enlazarOtAlAviso.ts`.
 *
 * **Lee la orden antes de decidir.** No es por mostrarla: es para comprobar
 * que la celda de la planilla sigue diciendo lo que el sistema escribió. La
 * pantalla corre la misma regla sin ese dato y por eso puede ofrecer algo que
 * acá se rechace — con un mensaje que dice dónde arreglarlo.
 *
 * Primero la base y después la planilla, como `desestimar`. Si Google no
 * contesta se devuelve **lo que dijo, sin traducir**, pero el mensaje no se
 * conforma con avisar que la planilla «no se enteró»: acá la celda que quedó
 * escrita vuelve a entrar en la próxima sincronización y deja al aviso
 * contando como que ya tiene orden, así que hay que borrarla a mano.
 *
 * Ese «a mano» dejó de hacer falta el 29/10/2026: si la escritura no sale,
 * queda anotada en `sheets_pendiente` y la reescribe el drenaje de la
 * sincronización, que además no importa ese aviso hasta lograrlo. Lo que sigue
 * siendo cierto es el riesgo si eso fallara para siempre, y por eso el mensaje
 * no cambia de tono.
 *
 * **No se audita**, igual que retomar un aviso desestimado: esto *es* el
 * deshacer, y la orden de trabajo no se toca.
 */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const id = String(new URL(request.url).searchParams.get("id") ?? "").trim();
  if (!id) return NextResponse.json({ error: "Falta el aviso." }, { status: 400 });

  const admin = createAdminClient();

  const { data: aviso, error: errorDelAviso } = await admin
    .from("avisos")
    .select("id, oa_number, work_order_id, ot_asignada, ot_enlazada_en, sheets_row")
    .eq("id", id)
    .maybeSingle();

  if (errorDelAviso) {
    return NextResponse.json({ error: errorDelAviso.message }, { status: 500 });
  }
  if (!aviso) return NextResponse.json({ error: "Ese aviso no existe." }, { status: 404 });

  // El número de la orden a la que apunta hoy, que es contra lo que se compara
  // la celda. Si la orden ya no está, queda en null y esa comprobación no
  // corre: lo que falta no puede ser lo que frene.
  let otNumber: number | null = null;
  if (aviso.work_order_id) {
    const { data: ot } = await admin
      .from("ordenes_trabajo")
      .select("ot_number")
      .eq("id", aviso.work_order_id)
      .maybeSingle();
    otNumber = ot?.ot_number ?? null;
  }

  const impide = loQueImpideDesenlazar(aviso as AvisoADesenlazar, otNumber);
  if (impide.length > 0) {
    return NextResponse.json({ error: impide.join(" ") }, { status: 409 });
  }

  const { data: guardado, error } = await admin
    .from("avisos")
    .update({
      work_order_id: null,
      // Se limpia también acá y no sólo en la planilla: `finalDelAviso` lee
      // esta columna, así que dejarla escrita mantendría al aviso contando
      // como que tiene orden hasta la próxima sincronización.
      ot_asignada: null,
      ot_enlazada_en: null,
      ot_enlazada_por: null,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Vaciar la celda **es** el desenlace, no un efecto suyo, así que si no sale
  // queda anotado y lo termina el drenaje. Vaciar acá es seguro —y no lo es en
  // general— porque `loQueImpideDesenlazar` ya se negó arriba cuando el número
  // lo escribió una persona: lo único que se borra es lo que el sistema puso.
  const planilla_error = await escribirEnLaFilaDelAviso(aviso, [
    { columna: COLUMNA_OT_ASIGNADA, valor: "" },
  ]);

  await admin
    .from("avisos")
    .update(
      elIntentoDelAviso(
        planilla_error,
        ["ot_asignada"],
        camposDelPendiente(guardado.sheets_pendiente_campos)
      )
    )
    .eq("id", id);

  return NextResponse.json({
    data: guardado,
    planilla_error,
    mensaje: avisoDeDesenlazada(aviso.oa_number, otNumber, planilla_error),
  });
}
