import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revisarElSecreto } from "@/lib/core/cron";
import { enviarCorreo, estaConfigurado } from "@/lib/core/correo";
import { hoyEnArgentina } from "@/lib/core/fechas";
import { leerNovedadesDelDia, recortarParaElCorreo, TOPE_POR_SECCION } from "@/lib/rrhh/leerNovedadesDelDia";
import {
  asuntoDelCorreo,
  cuerpoDelCorreo,
  destinatariosDelCorreo,
  hayAlgoQueMandar,
} from "@/lib/rrhh/novedadesDelDia";

/**
 * El correo de novedades de RR.HH., al cierre del día.
 *
 * Corre a las 18:50 UTC, que son **las 15:50 de Argentina**: la hora que pidió
 * el usuario el 16/11/2026.
 *
 * ## Lo que hay que saber antes de tocarlo
 *
 * - **Éste es el camino automático, y hay otro.** Desde el 26/11/2026 el mismo
 *   correo se puede mandar a mano desde `/rrhh/correo-novedades`, eligiendo a
 *   quién. Las dos puntas leen con `leerNovedadesDelDia()` y arman el texto con
 *   las mismas funciones: lo único que cambia es **quién decide que salga**.
 *   Si tocás lo que el correo dice, se toca una sola vez y vale para los dos.
 *
 * - **Sale de la casilla de RR.HH. y de ninguna otra.** `enviarCorreo(..., "rrhh")`
 *   usa `SDG_CORREO_RRHH_URL/SECRET`, que es un Apps Script publicado desde
 *   `gestiondepersonas@polcecal.com`. Si esa casilla no está configurada, esto
 *   **no manda nada y lo dice**: no cae a la casilla del sistema. El remitente
 *   es parte del mensaje —dice a dónde contestar— y mandarlo desde la cuenta
 *   equivocada es peor que no mandarlo. El porqué largo está en
 *   `lib/core/correo.ts`.
 *
 * - **Un correo por destinatario.** El Apps Script acepta una sola dirección y
 *   valida su dominio partiendo por `@`, así que una lista separada por comas
 *   la rechaza. Con los 13 encargados de hoy son 13 llamadas de ~2 s cada una,
 *   bien adentro del presupuesto de la función. Van una tras otra y no en
 *   paralelo: no hay apuro a las 15:50 y trece pedidos juntos al mismo Apps
 *   Script es la forma de que Google corte alguno.
 *
 * - **Si no hay novedades no se manda nada.** Medido sobre los 46 días desde
 *   el 01/10/2026: 23 de esos días no habrían tenido ninguna. Es lo único que
 *   esta ruta decide y el botón de la pantalla no: ahí manda lo que haya,
 *   porque lo apretó una persona que ya vio lo que dice.
 *
 * - **El día se recorta sobre `created_at` y en hora de Argentina.** Vercel
 *   corre en UTC: a las 18:50 UTC del 16 ya son las 15:50 del 16 acá, pero el
 *   corte de medianoche no es el mismo, y usar el día UTC se comería las
 *   novedades cargadas después de las 21:00.
 *
 * - **El correo cuenta dos cosas distintas y sólo una lo dispara.** Los
 *   *movimientos* son lo que se cargó ese día, y son los que deciden si sale.
 *   Las dos secciones de *presencia* —quién empieza o termina hoy, quién sigue
 *   ausente— viajan con él. **Si disparasen, el correo saldría todos los
 *   días**, porque hubo alguien ausente los 46 días de 46.
 *
 * - **Quién no viene se lee de dos tablas.** `ausencias` no alcanza: 20 de los
 *   41 períodos de vacaciones no crearon ausencia, y son justamente las
 *   licencias largas. Medido el 26/11/2026: ese día había 0 ausencias y 3
 *   personas de vacaciones, así que la sección salía vacía. El porqué y cómo
 *   se evita contar dos veces al mismo están en `lib/rrhh/novedadesDelDia.ts`.
 *
 * - **Lo que se cargó hoy pero ya terminó no se informa** (17/11/2026). Una
 *   ausencia del 02/11 cargada el 16/11 es trabajo administrativo poniéndose
 *   al día, no algo que mirar hoy. Eso se lleva de paso el montón de 17
 *   francos automáticos de los lunes, porque el recálculo los genera por el
 *   domingo anterior: 130 de 143 quedan afuera por esa sola regla. El porqué
 *   medido de las dos cosas está en `lib/rrhh/novedadesDelDia.ts`.
 *
 * - **La ruta devuelve el detalle de cada envío.** No hay nadie mirando a las
 *   15:50, así que el JSON de la corrida es lo único que después permite ver
 *   que a once les llegó y a uno no.
 */

export async function GET(request: Request) {
  const rechazo = revisarElSecreto(request);
  if (rechazo) return rechazo;

  const admin = createAdminClient();
  const dia = hoyEnArgentina();

  // ── La configuración ──
  //
  // La tabla la crea una migración y las migraciones las aplica una persona,
  // así que entre el deploy y esa aplicación no existe. Se dice con todas las
  // letras y se corta: seguir con valores por defecto mandaría un correo con
  // una lista de destinatarios que nadie revisó.
  const { data: config, error: errorDeConfig } = await admin
    .from("rrhh_correo_novedades")
    .select("*")
    .eq("id", 1)
    .single();

  if (errorDeConfig || !config) {
    const detalle = errorDeConfig?.message ?? "no está la fila id = 1";
    console.error("rrhh-novedades: no se pudo leer la configuración:", detalle);
    return NextResponse.json({ mandado: false, motivo: "sin configuración", detalle }, { status: 500 });
  }

  if (!config.activo) {
    return NextResponse.json({ mandado: false, motivo: "apagado desde RRHH → Configuración" });
  }

  let lo;
  try {
    lo = await leerNovedadesDelDia(admin, dia);
  } catch (e) {
    const detalle = String((e as Error)?.message ?? e);
    console.error("rrhh-novedades: no se pudieron leer las novedades:", detalle);
    return NextResponse.json({ mandado: false, motivo: "fallo al leer", detalle }, { status: 500 });
  }

  if (!hayAlgoQueMandar(lo.movimientos)) {
    return NextResponse.json({ mandado: false, motivo: "sin novedades", dia, cuenta: lo.cuenta });
  }

  // ── A quién ──
  const { data: usuarios, error: errorDeUsuarios } = await admin
    .from("usuarios")
    .select("id, email, rol, activo");

  if (errorDeUsuarios) {
    console.error("rrhh-novedades: no se pudo leer usuarios:", errorDeUsuarios.message);
    return NextResponse.json(
      { mandado: false, motivo: "fallo al leer usuarios", detalle: errorDeUsuarios.message },
      { status: 500 }
    );
  }

  const para = destinatariosDelCorreo(usuarios ?? [], config.destinatarios as string[]);

  // Sin destinatarios no se arma nada. Puede ser que alguien haya destildado a
  // todos, o que no quede ningún encargado: las dos cosas son «no hay a quién»
  // y las dos tienen que verse en el registro de la corrida, porque desde
  // afuera se leen igual que «no hubo novedades».
  if (!para.length) {
    console.error("rrhh-novedades: hay novedades pero no hay a quién mandarlas");
    return NextResponse.json(
      { mandado: false, motivo: "sin destinatarios", dia, cuenta: lo.cuenta },
      { status: 500 }
    );
  }

  // La casilla se revisa **antes** de armar el cuerpo, y la respuesta es un
  // error y no un «no había nada»: hay novedades que alguien tendría que estar
  // recibiendo.
  if (!estaConfigurado("rrhh")) {
    console.error("rrhh-novedades: falta SDG_CORREO_RRHH_URL/SECRET; no se manda desde otra casilla");
    return NextResponse.json(
      {
        mandado: false,
        motivo: "la casilla de RR.HH. no está configurada",
        detalle: "Falta publicar el Apps Script desde gestiondepersonas@polcecal.com y cargar SDG_CORREO_RRHH_URL y SDG_CORREO_RRHH_SECRET en Vercel.",
        dia,
        cuenta: lo.cuenta,
      },
      { status: 503 }
    );
  }

  const { conPresencia, recortadas, quedaronAfuera } = recortarParaElCorreo(lo);

  // El asunto sale del objeto entero y no de los movimientos: ahí la presencia
  // va vacía. Con movimientos da exactamente lo mismo, que es el caso de esta
  // ruta; la diferencia se ve del otro lado, cuando lo manda una persona.
  const asunto = asuntoDelCorreo(conPresencia, dia);
  let cuerpo = cuerpoDelCorreo(recortadas, dia, {
    encabezado: config.encabezado as string,
    cierre: config.cierre as string,
  });
  if (quedaronAfuera > 0) {
    cuerpo += `\n\n(Se listaron las primeras ${TOPE_POR_SECCION} de cada sección; quedaron ${quedaronAfuera} sin listar. Están todas en el sistema.)`;
  }

  // ── El envío, uno por destinatario ──
  const envios: { para: string; estado: string; detalle?: string }[] = [];
  for (const direccion of para) {
    const r = await enviarCorreo({ para: direccion, asunto, cuerpo }, "rrhh");
    envios.push({ para: direccion, estado: r.estado, ...(r.detalle ? { detalle: r.detalle } : {}) });
  }

  const enviados = envios.filter((e) => e.estado === "enviado").length;
  if (enviados < envios.length) {
    console.error(`rrhh-novedades: ${envios.length - enviados} de ${envios.length} envíos fallaron`, envios);
  }

  return NextResponse.json({
    mandado: enviados > 0,
    dia,
    cuenta: lo.cuenta,
    ausentes: {
      empiezanOTerminan: lo.empiezanOTerminan.length,
      siguenAusentes: lo.siguenAusentes.length,
      ...lo.ausentes,
    },
    quedaronAfuera,
    asunto,
    enviados,
    envios,
  });
}
