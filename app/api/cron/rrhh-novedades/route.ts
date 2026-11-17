import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revisarElSecreto } from "@/lib/core/cron";
import { traerPaginado } from "@/lib/rrhh/paginado";
import { enviarCorreo, estaConfigurado } from "@/lib/core/correo";
import { hoyEnArgentina, instanteDeArgentina, sumarDias } from "@/lib/core/fechas";
import {
  asuntoDelCorreo,
  cuantasSon,
  cuerpoDelCorreo,
  destinatariosDelCorreo,
  hayAlgoQueMandar,
  repartirVacacionesYAusencias,
  type NovedadesDelDia,
} from "@/lib/rrhh/novedadesDelDia";

/**
 * El correo de novedades de RR.HH., al cierre del día.
 *
 * Corre a las 18:50 UTC, que son **las 15:50 de Argentina**: la hora que pidió
 * el usuario el 16/11/2026.
 *
 * ## Lo que hay que saber antes de tocarlo
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
 *   la rechaza. Con los 12 encargados de hoy son 12 llamadas de ~2 s cada una,
 *   bien adentro del presupuesto de la función. Van una tras otra y no en
 *   paralelo: no hay apuro a las 15:50 y doce pedidos juntos al mismo Apps
 *   Script es la forma de que Google corte alguno.
 *
 * - **Si no hay novedades no se manda nada.** Medido sobre los 46 días desde
 *   el 01/10/2026: 23 de esos días no habrían tenido ninguna.
 *
 * - **El día se recorta sobre `created_at` y en hora de Argentina.** Vercel
 *   corre en UTC: a las 18:50 UTC del 16 ya son las 15:50 del 16 acá, pero el
 *   corte de medianoche no es el mismo, y usar el día UTC se comería las
 *   novedades cargadas después de las 21:00.
 *
 * - **Los francos generados son el montón automático del lunes.** Entran
 *   porque se pidieron, en su propia sección y diciendo lo que son. El día que
 *   molesten, lo que se saca es `francosGenerados` de acá —una línea— y no el
 *   correo entero; el porqué medido está en `lib/rrhh/novedadesDelDia.ts`.
 *
 * - **La ruta devuelve el detalle de cada envío.** No hay nadie mirando a las
 *   15:50, así que el JSON de la corrida es lo único que después permite ver
 *   que a once les llegó y a uno no.
 */

/** Cuántos renglones de cada cosa entran. Por encima de esto, el correo dice cuántos quedaron afuera. */
const TOPE_POR_SECCION = 60;

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

  // ── Qué se cargó hoy ──
  //
  // El día de Argentina en instantes reales, que es con lo que se compara un
  // `timestamptz`. El límite de arriba es `lt` y no `lte`: la medianoche del
  // día siguiente ya es del día siguiente.
  const desde = instanteDeArgentina(`${dia}T00:00`);
  const hasta = instanteDeArgentina(`${sumarDias(dia, 1)}T00:00`);

  const EMPLEADO = "empleados(apellido, nombre, legajo)";

  let ausencias, vacaciones, francos;
  try {
    [ausencias, vacaciones, francos] = await Promise.all([
      traerPaginado(
        () =>
          admin
            .from("ausencias")
            .select(`id, fecha_desde, fecha_hasta, tipo, justificada, observaciones, ${EMPLEADO}, usuarios:cargado_por_id(nombre, apellido)`)
            .gte("created_at", desde)
            .lt("created_at", hasta)
            .order("created_at", { ascending: true })
            .order("id", { ascending: true }),
        "ausencias del día"
      ),
      traerPaginado(
        () =>
          admin
            .from("vacaciones")
            .select(`id, fecha_desde, fecha_hasta, dias_tomados, anio_correspondiente, ausencia_id, ${EMPLEADO}`)
            .gte("created_at", desde)
            .lt("created_at", hasta)
            .order("created_at", { ascending: true })
            .order("id", { ascending: true }),
        "vacaciones del día"
      ),
      // Los francos entran por dos puertas distintas y por eso se traen en una
      // sola consulta: `created_at` dice cuáles generó hoy el recálculo, y
      // `fecha_tomado` cuáles marcó hoy una persona. Un mismo franco puede
      // cumplir las dos —se generó y se tomó el mismo día— y entonces vale la
      // segunda, que es la que hizo alguien.
      traerPaginado(
        () =>
          admin
            .from("francos")
            .select(`id, fecha_generado, fecha_tomado, horas, created_at, ${EMPLEADO}`)
            .or(`and(created_at.gte.${desde},created_at.lt.${hasta}),fecha_tomado.eq.${dia}`)
            .order("created_at", { ascending: true })
            .order("id", { ascending: true }),
        "francos del día"
      ),
    ]);
  } catch (e) {
    const detalle = String((e as Error)?.message ?? e);
    console.error("rrhh-novedades: no se pudieron leer las novedades:", detalle);
    return NextResponse.json({ mandado: false, motivo: "fallo al leer", detalle }, { status: 500 });
  }

  // PostgREST devuelve un embed como objeto o como arreglo de uno según cómo
  // resuelva la cardinalidad; se aceptan las dos formas, como en el resto del
  // módulo.
  const uno = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

  type Fila = Record<string, unknown>;
  const tomados = (francos as Fila[]).filter((f) => f.fecha_tomado === dia);
  const generados = (francos as Fila[]).filter((f) => f.fecha_tomado !== dia);

  // Una licencia cargada como vacaciones deja DOS filas —la ausencia y el
  // período— y el reparto decide cuál se escribe, para que no salga dos veces.
  const repartidas = repartirVacacionesYAusencias(
    (ausencias as Fila[]).map((a) => {
      const quien = uno(a.usuarios as { nombre?: string; apellido?: string } | null);
      return {
        id: a.id as string,
        empleado: uno(a.empleados as never),
        fecha_desde: a.fecha_desde as string,
        fecha_hasta: a.fecha_hasta as string,
        tipo: a.tipo as string,
        justificada: a.justificada as boolean,
        observaciones: a.observaciones as string | null,
        cargadaPor: quien ? [quien.nombre, quien.apellido].filter(Boolean).join(" ") : null,
      };
    }),
    (vacaciones as Fila[]).map((v) => ({
      empleado: uno(v.empleados as never),
      fecha_desde: v.fecha_desde as string,
      fecha_hasta: v.fecha_hasta as string,
      dias_tomados: v.dias_tomados as number,
      anio_correspondiente: v.anio_correspondiente as number,
      ausencia_id: (v.ausencia_id as string | null) ?? null,
    }))
  );

  const novedades: NovedadesDelDia = {
    ausencias: repartidas.ausencias,
    vacaciones: repartidas.vacaciones,
    francosTomados: tomados.map((f) => ({
      empleado: uno(f.empleados as never),
      fecha_generado: f.fecha_generado as string,
      fecha_tomado: f.fecha_tomado as string,
      horas: f.horas as number,
    })),
    francosGenerados: generados.map((f) => ({
      empleado: uno(f.empleados as never),
      fecha_generado: f.fecha_generado as string,
      horas: f.horas as number,
    })),
  };

  const cuenta = {
    ausencias: novedades.ausencias.length,
    vacaciones: novedades.vacaciones.length,
    francosTomados: novedades.francosTomados.length,
    francosGenerados: novedades.francosGenerados.length,
  };

  if (!hayAlgoQueMandar(novedades)) {
    return NextResponse.json({ mandado: false, motivo: "sin novedades", dia, cuenta });
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
    return NextResponse.json({ mandado: false, motivo: "sin destinatarios", dia, cuenta }, { status: 500 });
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
        cuenta,
      },
      { status: 503 }
    );
  }

  const recortadas: NovedadesDelDia = {
    ausencias: novedades.ausencias.slice(0, TOPE_POR_SECCION),
    vacaciones: novedades.vacaciones.slice(0, TOPE_POR_SECCION),
    francosTomados: novedades.francosTomados.slice(0, TOPE_POR_SECCION),
    francosGenerados: novedades.francosGenerados.slice(0, TOPE_POR_SECCION),
  };
  const quedaronAfuera = cuantasSon(novedades) - cuantasSon(recortadas);

  const asunto = asuntoDelCorreo(novedades, dia);
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
    cuenta,
    quedaronAfuera,
    asunto,
    enviados,
    envios,
  });
}
