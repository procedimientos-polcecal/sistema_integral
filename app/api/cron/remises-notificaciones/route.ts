import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revisarElSecreto } from "@/lib/core/cron";
import { enviarPush } from "@/lib/core/webpush";
import { diaEnArgentina, comoSeLee } from "@/lib/core/fechas";

/**
 * Corre vía Vercel Cron a las 22:00 UTC (19:00 Argentina), igual que la
 * Cloud Function del original: notifica a cada empleado con remis asignado
 * para el día siguiente. Usa el cliente admin (service role) porque no hay
 * sesión de usuario en un cron job — RLS no aplica acá.
 */
export async function GET(request: Request) {
  // Usa el helper compartido y no una comparación propia: la que había acá
  // fallaba ABIERTA. Sin CRON_SECRET en el entorno, el template literal daba
  // "Bearer undefined", así que cualquiera que mandara ese header disparaba las
  // notificaciones push a todo el personal. El helper devuelve 503 cuando el
  // secreto no está configurado, y además compara sin espacios ni saltos.
  const rechazo = revisarElSecreto(request);
  if (rechazo) return rechazo;

  const admin = createAdminClient();
  // Mañana en Argentina. Con `toISOString()` daba bien de casualidad —el cron
  // corre a las 19:00 de Argentina, antes de cruzar la medianoche UTC— y mover
  // el horario dos horas habria hecho que notificara el dia equivocado.
  const fecha = diaEnArgentina(1);
  const fmtFecha = comoSeLee(fecha);

  const { data: hojas } = await admin
    .from("hojas_ruta")
    .select("tipo, hora_salida, vehiculos(nombre), asientos(empleado_id)")
    .eq("fecha", fecha);

  const porEmpleado = new Map<string, { tipo: string; vehiculo: string | null; horaSalida: string | null }[]>();
  for (const h of (hojas ?? []) as any[]) {
    for (const a of h.asientos ?? []) {
      const lista = porEmpleado.get(a.empleado_id) ?? [];
      lista.push({ tipo: h.tipo, vehiculo: h.vehiculos?.nombre ?? null, horaSalida: h.hora_salida ?? null });
      porEmpleado.set(a.empleado_id, lista);
    }
  }

  let enviados = 0;
  let tokensInvalidos = 0;
  for (const [empleadoId, asignaciones] of porEmpleado) {
    const { data: usuario } = await admin.from("usuarios").select("id").eq("empleado_id", empleadoId).maybeSingle();
    if (!usuario) continue;

    // Todos los aparatos de esa persona, no uno: desde que la clave es
    // (usuario_id, endpoint), el celular y la computadora conviven. Con
    // `maybeSingle()` esto tiraba apenas alguien tuviera dos.
    const { data: aparatos } = await admin
      .from("push_suscripciones")
      .select("endpoint, p256dh, auth")
      .eq("usuario_id", usuario.id);
    if (!aparatos?.length) continue;

    const primera = asignaciones[0];
    const title = `Remis para mañana ${fmtFecha}`;
    const body = [
      primera.vehiculo ?? "tu remis",
      primera.horaSalida ? `Salida: ${primera.horaSalida}` : "",
      asignaciones.length > 1 ? `(${asignaciones.length} remises asignados)` : "",
    ].filter(Boolean).join("\n");

    for (const aparato of aparatos) {
      // `url` va siempre: el `notificationclick` del service worker la lee y
      // cae en `/` cuando no viene. Hasta el 18/10/2026 esto mandaba sólo
      // `{title, body}`, así que tocar el aviso del remis abría el inicio y la
      // persona tenía que ir a buscar sola de qué se trataba.
      const resultado = await enviarPush(aparato, { title, body, url: "/mi-remis" });
      if (resultado === "enviada") {
        enviados++;
      } else if (resultado === "vencida") {
        // Se borra ese aparato y no todos los de la persona: desinstaló la app
        // de un teléfono, no se dio de baja de todo.
        tokensInvalidos++;
        await admin.from("push_suscripciones").delete()
          .eq("usuario_id", usuario.id).eq("endpoint", aparato.endpoint);
      }
      // `fallo` no borra nada: el problema es del push service y la próxima
      // corrida puede andar.
    }
  }

  return NextResponse.json({ fecha, empleadosConRuta: porEmpleado.size, enviados, tokensInvalidos });
}
