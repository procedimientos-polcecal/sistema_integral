import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { hoyEnArgentina, comoSeLee } from "@/lib/core/fechas";
import { loQueHayQueExportar } from "@/lib/mantenimiento/cierreDeOT";
import { celdasParaRegistrar } from "@/lib/mantenimiento/ordenes";
import { escribirEnLaFilaDeLaOT } from "@/lib/mantenimiento/planillaDeOT";
import { elPendienteDelIntento } from "@/lib/mantenimiento/pendienteDeLaOT";
import { celdaDeObservacionPrevia } from "@/lib/mantenimiento/notas";

type Params = { params: Promise<{ id: string }> };

/**
 * POST — reiniciar un ciclo: la pieza se cambió fuera de turno.
 *
 * ── POR QUÉ ESTE BOTÓN EXISTE ───────────────────────────────────────────────
 *
 * Preguntado qué lo haría dejar de confiar en los ciclos y volver a manejarlos
 * a mano, quien los pidió contestó: **«que genere OT sobre martillos que ya se
 * cambiaron»**. Pasa de verdad —en el historial hay ciclos de 0 rotaciones: se
 * rompió algo y hubo que cambiarlos antes de tiempo— y esa OT la carga una
 * persona en el formulario, no el sistema. Si el ciclo no se entera, sigue
 * contando rotaciones sobre piezas nuevas.
 *
 * Un clic, sin leer el texto de ninguna descripción.
 *
 * ── LOS DOS CASOS, QUE NO SON EL MISMO ──────────────────────────────────────
 *
 * **Si la OT viva es una hija**, queda SUSPENDIDA y sale del ciclo. Dejarla
 * viva sería literalmente el anti-objetivo: una orden abierta que manda a rotar
 * a 3ª cara un juego que está en la 1ª.
 *
 * **Si la OT viva es la madre**, no se toca y se explica. Es el momento más
 * probable para apretar el botón —el trabajo se hizo y la planilla todavía no
 * se cerró— y ahí suspender estaría mal, porque el trabajo existió. Cerrarla
 * desde un botón tampoco: sería el sistema registrando trabajo ajeno,
 * escribiendo REALIZADO y la fecha de cierre en las columnas M y K del master
 * por un camino que no es el de cerrar una OT. Cerrándola a mano el ciclo
 * arranca solo, que es lo que hay que decirle a quien apretó.
 *
 * ── Y POR QUÉ ALCANZA CON MOVER `desde` ─────────────────────────────────────
 *
 * Porque las OT del ciclo que cuentan son las creadas en `desde` o después.
 * Moverlo a hoy deja afuera todo lo anterior de una sola vez, así que no hay
 * que ir a desenganchar nada más. El `ciclo_id` de la hija suspendida se limpia
 * igual, por el borde de la que se creó hoy mismo.
 */
export async function POST(_request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json(
      { error: "Reiniciar un ciclo requiere nivel de edición en Mantenimiento" },
      { status: 403 }
    );
  }

  const admin = createAdminClient();
  const { data: ciclo } = await admin
    .from("mant_ciclos_de_ot")
    .select("id, hija:tarea_hija_id(componente)")
    .eq("id", id)
    .single();

  if (!ciclo) return NextResponse.json({ error: "No existe ese ciclo" }, { status: 404 });

  const componente =
    (ciclo.hija as unknown as { componente?: string } | null)?.componente ?? "La pieza";

  // La OT viva del ciclo: ni hecha ni suspendida.
  const { data: vivas } = await admin
    .from("ordenes_trabajo")
    .select("id, ot_number, ciclo_vuelta, estado, fecha_cierre, horas, contratista, operario_1, operario_2, operario_3")
    .eq("ciclo_id", id)
    .not("estado", "in", "(REALIZADO,SUSPENDIDA)");

  const viva = (vivas ?? [])[0];

  if (viva && viva.ciclo_vuelta === 0) {
    return NextResponse.json({
      error:
        `La OT ${viva.ot_number} que está abierta es justamente el cambio. ` +
        `Cerrala y el ciclo arranca solo desde su fecha de cierre — no hace ` +
        `falta reiniciarlo.`,
    }, { status: 400 });
  }

  const hoy = hoyEnArgentina();
  let planilla_error: string | null = null;
  let nota_error: string | null = null;

  if (viva) {
    const texto =
      `${componente} se cambiaron el ${comoSeLee(hoy)}, antes de que tocara esta ` +
      `rotación. El ciclo se reinició y esta orden ya no corresponde.`;

    const { error: errorOT } = await admin
      .from("ordenes_trabajo")
      .update({ estado: "SUSPENDIDA", ciclo_id: null, synced_at: new Date().toISOString() })
      .eq("id", viva.id);

    if (errorOT) return NextResponse.json({ error: errorOT.message }, { status: 500 });

    const { error: errorNota } = await admin
      .from("ordenes_trabajo_notas")
      .insert({ orden_id: viva.id, texto, creado_por: user.id });
    nota_error = errorNota?.message ?? null;

    // ── El estado nuevo se exporta, o se encola ───────────────────────────
    //
    // Cambiar un estado sin escribirlo en la planilla es una divergencia que no
    // avisa: la sincronización siguiente lee la celda vieja y lo borra.
    const actualizada = { ...viva, estado: "SUSPENDIDA" };
    const paraLaPlanilla = loQueHayQueExportar(actualizada);
    if (paraLaPlanilla) {
      planilla_error = await escribirEnLaFilaDeLaOT(
        { ot_number: viva.ot_number },
        [...celdasParaRegistrar(paraLaPlanilla), celdaDeObservacionPrevia(texto)]
      );
      const pendiente = elPendienteDelIntento(actualizada, planilla_error);
      await admin
        .from("ordenes_trabajo")
        .update({ sheets_pendiente: pendiente, sheets_intentado_en: new Date().toISOString() })
        .eq("id", viva.id);
    }
  }

  const { error } = await admin
    .from("mant_ciclos_de_ot")
    .update({ desde: hoy, vuelta_desde: 0 })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    data: { desde: hoy, vuelta_desde: 0, suspendida: viva?.ot_number ?? null },
    planilla_error,
    nota_error,
  });
}
