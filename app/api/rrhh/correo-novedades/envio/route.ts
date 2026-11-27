import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { es_admin_check } from "@/lib/rrhh/route-utils";
import { cuerpoJson } from "@/lib/core/cuerpo";
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
 * Mandar el correo de novedades a mano, eligiendo a quién.
 *
 * El GET devuelve la **vista previa** de un día y el POST lo manda. Es el
 * segundo camino del mismo correo: el otro es el cron de las 15:50.
 *
 * ## Las cuatro cosas que no se deducen del código
 *
 * 1. **El POST vuelve a leer la base; no manda lo que le pasen.** El cuerpo
 *    del pedido trae el día y los destinatarios, y nada más: ni el texto ni la
 *    lista de gente. Si el cliente pudiera mandar el cuerpo, esta ruta sería
 *    una forma de escribirle cualquier cosa a cualquiera desde la casilla de
 *    RR.HH. Lo que cuesta, dicho: entre que alguien mira la vista previa y
 *    aprieta el botón puede haberse cargado una novedad más, y entonces sale
 *    con una línea que no vio. Es el lado correcto del error —sale el dato de
 *    verdad— y por eso la pantalla vuelve a pedir la vista previa después.
 *
 * 2. **Los destinatarios son ids de usuario, nunca direcciones.** Llegan como
 *    uuid y la dirección la resuelve `destinatariosDelCorreo()` contra la
 *    tabla. Un id que no existe, o de alguien inactivo o sin correo, se cae
 *    solo. Así esto no puede usarse para mandarle a una dirección de afuera.
 *
 * 3. **Acá sí se manda sin movimientos, y en el cron no.** Es la única
 *    diferencia de criterio entre los dos caminos, y es a propósito: el cron
 *    corre solo y un correo diario que casi siempre dice lo mismo enseña a
 *    archivarlo sin leer; acá lo aprieta una persona que ya vio en pantalla lo
 *    que dice. La respuesta avisa igual cuando no hubo movimientos.
 *
 * 4. **Pide admin de RR.HH.** No porque mandar un correo sea delicado, sino
 *    por lo que el correo lleva adentro: las observaciones de una ausencia
 *    —«Laringitis», «Acompañar a su mamá a un turno médico»— y quién la
 *    cargó. Es el mismo nivel que hace falta para elegir la lista fija.
 *
 * 5. **Las novedades se leen con el cliente admin, igual que el cron.** La
 *    sesión se usa para el permiso y nada más. No es comodidad: si esto leyera
 *    con el cliente de quien mira, RLS podría devolverle menos filas de las
 *    que el cron ve con el suyo, y entonces la vista previa mostraría un
 *    correo y saldría otro. Una vista previa que no es exacta es peor que no
 *    tenerla. El permiso lo pone la ruta —`es_admin_check` arriba de todo—,
 *    que es lo mismo que hacen las otras 108 rutas que usan admin.
 */

/** El día tiene que venir como lo escribe un `<input type="date">`. */
function diaPedido(valor: string | null): { dia: string } | { error: string } {
  if (!valor) return { dia: hoyEnArgentina() };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return { error: "El día tiene que ser AAAA-MM-DD" };
  return { dia: valor };
}

async function armarElCorreo(admin: SupabaseClient, dia: string) {
  const [lo, { data: config }] = await Promise.all([
    leerNovedadesDelDia(admin, dia),
    admin.from("rrhh_correo_novedades").select("encabezado, cierre, destinatarios, activo").eq("id", 1).single(),
  ]);

  const { conPresencia, recortadas, quedaronAfuera } = recortarParaElCorreo(lo);
  // Del objeto entero y no de los movimientos: un día sin movimientos pero con
  // gente de licencia decía «sin novedades» mientras el cuerpo las listaba.
  const asunto = asuntoDelCorreo(conPresencia, dia);
  let cuerpo = cuerpoDelCorreo(recortadas, dia, {
    encabezado: config?.encabezado ?? "",
    cierre: config?.cierre ?? "",
  });
  if (quedaronAfuera > 0) {
    cuerpo += `\n\n(Se listaron las primeras ${TOPE_POR_SECCION} de cada sección; quedaron ${quedaronAfuera} sin listar. Están todas en el sistema.)`;
  }

  return { lo, config, asunto, cuerpo, quedaronAfuera };
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const check = await es_admin_check(supabase);
  if (check) return check;

  const pedido = diaPedido(new URL(request.url).searchParams.get("dia"));
  if ("error" in pedido) return NextResponse.json({ error: pedido.error }, { status: 400 });

  const admin = createAdminClient();
  let armado;
  try {
    armado = await armarElCorreo(admin, pedido.dia);
  } catch (e) {
    return NextResponse.json({ error: String((e as Error)?.message ?? e) }, { status: 500 });
  }

  // También con admin, por lo mismo: la lista que se ofrece tildar tiene que
  // ser la misma de la que después salen las direcciones.
  const { data: usuarios } = await admin
    .from("usuarios")
    .select("id, nombre, apellido, email, rol, activo")
    .order("apellido", { ascending: true });

  const candidatos = (usuarios ?? [])
    .filter((u) => u.activo !== false && (u.email ?? "").trim())
    .map((u) => ({
      id: u.id,
      nombre: [u.apellido, u.nombre].filter(Boolean).join(", "),
      email: u.email,
      rol: u.rol,
    }));

  // Con quién arranca tildada la pantalla: los de la lista fija, y si está
  // vacía, los encargados, que es lo que haría el cron ese día. Arrancar en
  // blanco obligaría a rearmar la lista completa cada vez.
  const sugeridos = (armado.config?.destinatarios as string[] | null)?.length
    ? (armado.config!.destinatarios as string[])
    : candidatos.filter((c) => c.rol === "encargado").map((c) => c.id);

  return NextResponse.json({
    dia: pedido.dia,
    asunto: armado.asunto,
    cuerpo: armado.cuerpo,
    cuenta: armado.lo.cuenta,
    ausentes: {
      empiezanOTerminan: armado.lo.empiezanOTerminan.length,
      siguenAusentes: armado.lo.siguenAusentes.length,
      ...armado.lo.ausentes,
    },
    hayMovimientos: hayAlgoQueMandar(armado.lo.movimientos),
    automaticoActivo: armado.config?.activo ?? false,
    casillaConfigurada: estaConfigurado("rrhh"),
    candidatos,
    sugeridos,
  });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const check = await es_admin_check(supabase);
  if (check) return check;

  const body = await cuerpoJson(request);

  const pedido = diaPedido(typeof body.dia === "string" ? body.dia : null);
  if ("error" in pedido) return NextResponse.json({ error: pedido.error }, { status: 400 });

  const elegidos = body.destinatarios;
  if (!Array.isArray(elegidos) || elegidos.some((d: unknown) => typeof d !== "string")) {
    return NextResponse.json({ error: "«destinatarios» tiene que ser una lista de usuarios" }, { status: 400 });
  }
  if (!elegidos.length) {
    return NextResponse.json({ error: "No elegiste a nadie" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: usuarios, error: errorDeUsuarios } = await admin
    .from("usuarios")
    .select("id, email, rol, activo");
  if (errorDeUsuarios) {
    return NextResponse.json({ error: errorDeUsuarios.message }, { status: 500 });
  }

  const para = destinatariosDelCorreo(usuarios ?? [], [...new Set(elegidos as string[])]);
  if (!para.length) {
    return NextResponse.json(
      { error: "Ninguno de los elegidos tiene un correo cargado, o ya no está activo" },
      { status: 400 }
    );
  }

  if (!estaConfigurado("rrhh")) {
    return NextResponse.json(
      {
        error:
          "La casilla de RR.HH. no está configurada: falta SDG_CORREO_RRHH_URL y SDG_CORREO_RRHH_SECRET en Vercel.",
      },
      { status: 503 }
    );
  }

  let armado;
  try {
    armado = await armarElCorreo(admin, pedido.dia);
  } catch (e) {
    return NextResponse.json({ error: String((e as Error)?.message ?? e) }, { status: 500 });
  }

  const envios: { para: string; estado: string; detalle?: string }[] = [];
  for (const direccion of para) {
    const r = await enviarCorreo({ para: direccion, asunto: armado.asunto, cuerpo: armado.cuerpo }, "rrhh");
    envios.push({ para: direccion, estado: r.estado, ...(r.detalle ? { detalle: r.detalle } : {}) });
  }

  const enviados = envios.filter((e) => e.estado === "enviado").length;
  if (enviados < envios.length) {
    console.error(`rrhh-novedades (a mano): ${envios.length - enviados} de ${envios.length} fallaron`, envios);
  }

  return NextResponse.json({
    mandado: enviados > 0,
    dia: pedido.dia,
    asunto: armado.asunto,
    hayMovimientos: hayAlgoQueMandar(armado.lo.movimientos),
    enviados,
    envios,
  });
}
