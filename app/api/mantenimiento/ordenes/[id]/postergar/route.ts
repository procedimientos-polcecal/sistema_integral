import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { auditar, nombreParaAuditoria } from "@/lib/core/auditoria";
import {
  laNuevaFecha, loQueFaltaParaPostergar, porQueElEstadoNoDejaPostergar,
} from "@/lib/mantenimiento/postergar";
import { corregirLaFechaComprometida } from "@/lib/mantenimiento/formulario";
import { escribirEnLaFilaDeLaOT } from "@/lib/mantenimiento/planillaDeOT";
import { celdaDeObservacionPrevia } from "@/lib/mantenimiento/notas";
import { filaDeReprogramacionDelSistema } from "@/lib/mantenimiento/reprogramaciones";

type Params = { params: Promise<{ id: string }> };

/**
 * POST — correrle la fecha de inicio a una orden, con justificación.
 *
 * ── EL ORDEN DE LOS PASOS ES LA MITAD DEL DISEÑO ────────────────────────────
 *
 * **Primero la planilla y después la base.** La fecha de inicio de una OT en
 * el master es la columna J, que es derrame de un `IMPORTRANGE`: la de verdad
 * vive en `Altas del sistema`. Si se guardara primero en la base y la planilla
 * fallara, quedaría una fecha nueva acá y la vieja allá — que es exactamente la
 * divergencia que este módulo pasó tres semanas arreglando. Así que si la
 * planilla no contesta, **no se mueve nada** y se devuelve lo que dijo Google
 * sin traducir.
 *
 * **Y la fecha nueva queda anotada en `fecha_ejecucion_pendiente`.** El derrame
 * tarda de 3 a 53 horas en llegar al master; en esa ventana la sincronización
 * leería la J vieja y la pisaría, y encima el contraste la contaría como
 * divergencia disparando el push de `mant-divergencias`. Esa columna es lo que
 * la protege hasta que el derrame la alcance.
 *
 * ── SÓLO LAS QUE CREÓ EL SISTEMA ────────────────────────────────────────────
 *
 * Una OT que entró por el formulario vive en la pestaña que maneja Forms, y
 * escribir ahí fue lo que corrió la OT 2796 dos lugares el 16/10/2026. El
 * chequeo está acá además de en `celdaDeLaFechaComprometida` para poder
 * contestar 400 con el motivo antes de ir a leer la planilla.
 */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json(
      { error: "Postergar una OT requiere nivel de edición en Mantenimiento" },
      { status: 403 }
    );
  }

  const body = await cuerpoJson(request);
  const falta = loQueFaltaParaPostergar(body ?? {});
  if (falta.length > 0) {
    return NextResponse.json({ error: `Falta ${falta.join(", ")}.` }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: orden } = await admin
    .from("ordenes_trabajo")
    .select("id, ot_number, fecha_ejecucion, app_created, estado")
    .eq("id", id)
    .single();

  if (!orden) return NextResponse.json({ error: "No existe esa orden" }, { status: 404 });

  if (!orden.app_created) {
    return NextResponse.json({
      error:
        "Esta orden entró por el formulario, así que su fecha de inicio no se " +
        "puede mover desde el sistema: vive en la pestaña que maneja Google Forms " +
        "y escribir ahí corre las filas de las demás. Hay que cambiarla allá.",
    }, { status: 400 });
  }

  /*
   * Una orden ya hecha no se posterga, y hasta el 19/11/2026 esto faltaba: la
   * ruta traía `estado` en el `select` y no lo miraba. No se notaba porque las
   * dos pantallas filtran antes —el listado con `pideJustificacion` y el
   * calendario con `porQueNoSePuedeMover`—, o sea que la regla vivía entera del
   * lado del cliente, que es donde las reglas no viven.
   *
   * **Sólo `REALIZADO`, que es donde las dos puntas coinciden.** El calendario
   * además se niega con `SUSPENDIDA` y el listado la deja postergar; esa
   * diferencia es de pantalla y se decide allá, así que el servidor no la
   * arbitra — ver `lib/mantenimiento/moverLaOT.ts`.
   */
  const porElEstado = porQueElEstadoNoDejaPostergar(orden.estado);
  if (porElEstado) {
    return NextResponse.json({ error: porElEstado }, { status: 400 });
  }

  const nueva = laNuevaFecha(orden.fecha_ejecucion, Number(body.dias));
  if (!nueva) {
    return NextResponse.json({
      error: "Esta orden no tiene fecha de inicio, así que no hay de dónde correrla.",
    }, { status: 400 });
  }

  // ── 1. La planilla, que es donde manda ────────────────────────────────────
  const falloLaPlanilla = await corregirLaFechaComprometida(orden.ot_number, nueva);
  if (falloLaPlanilla) {
    return NextResponse.json({
      error: `No se postergó: la planilla no aceptó la fecha nueva. ${falloLaPlanilla}`,
    }, { status: 502 });
  }

  // ── 2. La base, con la marca que la protege hasta que el derrame llegue ───
  const { error } = await admin
    .from("ordenes_trabajo")
    .update({ fecha_ejecucion: nueva, fecha_ejecucion_pendiente: nueva })
    .eq("id", id);

  if (error) {
    // La planilla ya tiene la fecha nueva, así que la orden se postergó donde
    // manda. Se dice, y la próxima sincronización la trae.
    return NextResponse.json({
      error:
        `La fecha se cambió en la planilla pero no en el sistema (${error.message}). ` +
        `La próxima sincronización lo empareja.`,
    }, { status: 500 });
  }

  // ── 2b. El movimiento como dato, para el listado y el análisis ────────────
  //
  // **Si este insert falla se contesta 200 con un aviso y no un error.** A esta
  // altura la fecha ya está escrita en la planilla y guardada en la orden: un
  // 500 invita a reintentar, y reintentar posterga la orden OTRA VEZ, otros
  // siete días. Lo que se pierde es el rastro, y eso se dice con todas las
  // letras en `reprogramacion_error`, que lleva el mensaje CRUDO (como
  // `nota_error`) y deja que cada pantalla lo diga en su voz; lo ya hecho no se
  // puede deshacer.
  // La fila de `auditoria` de más abajo es otro registro, con otro lector
  // (sólo `admin_sistema`), y no se toca.
  //
  // **`razon_etiqueta` queda en null por dos causas, y una no es rara.** (1) La
  // razón se desactivó o se renombró después: histórico y poco frecuente.
  // (2) La razón nunca estuvo en `mant_razones_de_postergacion`: la
  // postergación que maneja el calendario del plan manda `planificacion_del_dia`,
  // que a propósito no es una fila de esa tabla (migración 20261104165733), así
  // que TODA postergación de ese origen guarda el código con la etiqueta en
  // null. No se repara ni se trata aparte: el código queda guardado y es
  // suficiente; mostrar una etiqueta de reemplazo es cosa de cada pantalla.
  //
  // El `try/catch` cierra el otro camino al 500: `postgrest-js` devuelve
  // `error` y no lanza, pero si algo lanzara igual, el framework contestaría 500
  // y el reintento posterga la orden otra semana.
  let errorHistorial: string | null = null;
  try {
    const { data: razonDelMenu } = await admin
      .from("mant_razones_de_postergacion")
      .select("etiqueta")
      .eq("codigo", String(body.razon))
      .maybeSingle();

    const { error } = await admin
      .from("mant_reprogramaciones_ot")
      .insert(filaDeReprogramacionDelSistema({
        otId: id,
        fechaAnterior: orden.fecha_ejecucion,
        fechaNueva: nueva,
        razon: String(body.razon),
        razonEtiqueta: razonDelMenu?.etiqueta ?? null,
        justificacion: String(body.justificacion),
        usuarioId: user.id,
      }));
    errorHistorial = error?.message ?? null;
  } catch (e) {
    errorHistorial = e instanceof Error ? e.message : String(e);
  }

  // ── 3. La justificación, que es obligatoria y queda como historial ────────
  //
  // Mismo camino que las justificaciones de siempre: no se editan, y a la
  // planilla va la última, que es la que dice por qué está parada hoy.
  const texto = `Postergada ${body.dias} día(s) por ${String(body.razon)}: ${String(body.justificacion).trim()}`;
  const { error: errorNota } = await admin
    .from("ordenes_trabajo_notas")
    .insert({ orden_id: id, texto, creado_por: user.id });

  const planillaNota = errorNota
    ? null
    : await escribirEnLaFilaDeLaOT(orden, [celdaDeObservacionPrevia(texto)]);

  // ── 4. Y se audita ────────────────────────────────────────────────────────
  //
  // `corregir` es el único verbo que no es un acto en una dirección sino el
  // paso de un valor a otro, y por eso **necesita** el par: sin él el registro
  // dice que alguien corrigió algo y no qué.
  const { data: quien } = await admin
    .from("usuarios").select("nombre, apellido").eq("id", user.id).single();

  await auditar(admin, {
    modulo: "mantenimiento",
    entidad: "orden_trabajo",
    entidadId: id,
    accion: "corregir",
    usuario: { id: user.id, nombre: nombreParaAuditoria(quien) },
    valorAnterior: orden.fecha_ejecucion,
    valorNuevo: nueva,
    motivo: String(body.justificacion).trim(),
    contexto: { ot_number: orden.ot_number, razon: String(body.razon), dias: Number(body.dias) },
  });

  return NextResponse.json({
    data: { fecha_ejecucion: nueva },
    nota_error: errorNota?.message ?? null,
    planilla_error: planillaNota,
    reprogramacion_error: errorHistorial,
  });
}
