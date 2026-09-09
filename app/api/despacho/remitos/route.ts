import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hoyEnArgentina } from "@/lib/core/fechas";
import { avisoDeCredencialesFaltantes, hayCredencialesOdoo } from "@/lib/odoo/client";
import { tieneAccesoDespacho } from "@/lib/despacho/auth";
import { DIAS_DE_LA_VENTANA, remitosParaElAlta } from "@/lib/despacho/odoo";
import { remitosYaUsados } from "@/lib/despacho/consultas";

/**
 * Los remitos de salida de los últimos días que todavía no tienen orden de carga.
 *
 * Es la lista de la que el encargado elige, y con la que vienen cliente,
 * producto, toneladas y empresa sin tipear nada.
 *
 * **Se pide al abrir la pantalla y con un botón, no en cada tecla.** Odoo Online
 * tarda y el cliente corta a los 30 segundos: una búsqueda incremental contra
 * Odoo dejaría la pantalla colgada con un camión esperando. La ventana de siete
 * días son ~84 remitos, así que entran todos de una y el filtrado es en memoria.
 *
 * **Siete días y no uno.** 131 de 1.383 remitos tienen `scheduled_date` de un
 * día distinto al de su creación, así que filtrando por el día se le escondería
 * al encargado uno de cada diez remitos — y tendría que cargar la orden sin
 * enlace teniendo el remito en la mano.
 *
 * Los que ya tienen orden se marcan en vez de sacarse de la lista: que un remito
 * no esté puede ser porque ya se cargó o porque Odoo no lo devolvió, y son dos
 * problemas distintos. Verlo tachado con su Nº de orden al lado contesta la
 * pregunta sin abrir el histórico.
 */

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await tieneAccesoDespacho(supabase, user.id))) {
    return NextResponse.json({ error: "Sin acceso a Despacho" }, { status: 403 });
  }

  if (!hayCredencialesOdoo()) {
    // El aviso dice **dónde** ponerlas y no sólo cuáles faltan: "faltan las
    // cuatro" con las cuatro en .env.local es lo que pasa cuando el dev server
    // arrancó antes de que existieran.
    return NextResponse.json({ error: avisoDeCredencialesFaltantes() }, { status: 503 });
  }

  const pedida = new URL(request.url).searchParams.get("fecha");
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(pedida ?? "") ? pedida! : hoyEnArgentina();

  try {
    const remitos = await remitosParaElAlta(fecha);
    const usados = await remitosYaUsados(
      supabase,
      remitos.map((r) => r.picking_id)
    );

    return NextResponse.json({
      fecha,
      dias: DIAS_DE_LA_VENTANA,
      remitos: remitos.map((r) => ({ ...r, yaTieneOrden: usados.has(r.picking_id) })),
    });
  } catch (e) {
    // El mensaje ya viene traducido: el cliente pasa todo error de Odoo por
    // `mensajeDeOdoo` antes de lanzarlo, así que un cambio de nombre de la base
    // —que Odoo contesta hablando de psycopg2 y de un pool de conexiones— llega
    // acá diciendo "revisá ODOO_DB". Envolverlo otra vez lo taparía.
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }
}
