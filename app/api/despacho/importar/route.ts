import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { leerValores } from "@/lib/core/sheets";
import { hayCredencialesGoogle } from "@/lib/core/google";
import { esAdminDespacho } from "@/lib/despacho/auth";
import { ordenesDeLaPlanilla } from "@/lib/despacho/importar";

/**
 * Traer el histórico de la planilla `Órdenes de Carga`. Se corre una vez.
 *
 * TRES DECISIONES
 *
 * **`ignoreDuplicates`: lo que ya está en el sistema gana.** El importador trae
 * historia, no la corrige. Si una orden ya se cargó desde la balanza —con sus
 * horarios marcados por el servidor y su remito elegido a mano— pisarla con la
 * fila de la planilla cambiaría datos buenos por datos transcriptos. Volver a
 * correr el importador es seguro: sólo agrega lo que falta.
 *
 * **Sin enlace a Odoo y sin empresa.** La planilla no tiene ninguna de las dos
 * cosas, y deducirlas por el nombre del cliente es exactamente lo que este repo
 * no hace: un enlace equivocado no se nota nunca. `odoo_picking_id` y
 * `empresa_id` quedan en null, que dice "no se sabe".
 *
 * **`sinFormato: true`.** Pide los valores crudos: las fechas llegan como serial
 * numérico en vez del texto formateado, que depende del locale de la planilla.
 * Confundir el día con el mes ya costó corregir 885 registros en Compras.
 *
 * Corre con el cliente admin porque inserta miles de filas y el rol del usuario
 * no cambia nada de lo que se inserta; el permiso se comprueba antes, a mano,
 * porque con el cliente admin RLS no corre.
 */

const PLANILLA = () => process.env.GOOGLE_SHEETS_DESPACHO_ID ?? "";
const PESTANA = () => process.env.GOOGLE_SHEETS_DESPACHO_TAB ?? "Órdenes de Carga";

/** De a mil: un insert de miles de filas en una sola llamada se cae por tamaño. */
const LOTE = 1000;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await esAdminDespacho(supabase, user.id))) {
    return NextResponse.json(
      { error: "Sólo un admin de Despacho importa el histórico" },
      { status: 403 }
    );
  }

  if (!hayCredencialesGoogle() || !PLANILLA()) {
    return NextResponse.json(
      {
        error:
          "Faltan GOOGLE_SERVICE_ACCOUNT_JSON o GOOGLE_SHEETS_DESPACHO_ID. " +
          "Las credenciales de Google sólo existen en el deploy: esto no corre en local.",
      },
      { status: 503 }
    );
  }

  const b = await cuerpoJson(request);
  // Un ensayo que lee y cuenta sin escribir nada. Es lo primero que conviene
  // correr contra un libro que nunca se leyó: dice si los encabezados se
  // reconocieron antes de insertar miles de filas.
  const ensayo = b?.ensayo === true;

  let valores: string[][];
  try {
    valores = await leerValores(PLANILLA(), PESTANA(), { sinFormato: true });
  } catch (e) {
    // El mensaje ya viene de `mensajeDeGoogle`: dice el código, la cuenta de
    // servicio y qué se estaba haciendo. Es lo que hace falta cuando el libro no
    // está compartido con la cuenta.
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }

  const { ordenes, filaDeEncabezados, salteadas } = ordenesDeLaPlanilla(valores);

  if (filaDeEncabezados === null) {
    return NextResponse.json(
      {
        error:
          `No se reconocieron los encabezados en las primeras 10 filas de "${PESTANA()}". ` +
          "Se buscan: Fecha Orden, Nro de Orden, Cliente, Material, las cuatro horas y Observaciones.",
      },
      { status: 422 }
    );
  }

  if (ensayo) {
    return NextResponse.json({
      ensayo: true,
      filaDeEncabezados: filaDeEncabezados + 1,
      leidas: ordenes.length,
      salteadas,
      muestra: ordenes.slice(0, 5),
    });
  }

  const admin = createAdminClient();
  let insertadas = 0;

  for (let i = 0; i < ordenes.length; i += LOTE) {
    const lote = ordenes.slice(i, i + LOTE).map((o) => ({
      numero: o.numero,
      fecha: o.fecha,
      cliente_raw: o.cliente_raw,
      producto_raw: o.producto_raw,
      entrada_predio: o.entrada_predio,
      inicio_carga: o.inicio_carga,
      fin_carga: o.fin_carga,
      salida_predio: o.salida_predio,
      notas: o.notas,
      sheets_fila: o.fila,
      // `cargado_por` en null a propósito: nadie la cargó en el sistema. Es lo
      // que distingue una fila importada de una cargada en la balanza.
    }));

    const { data, error } = await admin
      .from("despacho_ordenes_carga")
      .upsert(lote, { onConflict: "numero", ignoreDuplicates: true })
      .select("id");

    if (error) {
      // Se devuelve cuántas entraron antes de fallar: reintentar es seguro
      // porque el upsert ignora las que ya están.
      return NextResponse.json(
        { error: error.message, insertadas, hasta: i },
        { status: 400 }
      );
    }
    insertadas += (data ?? []).length;
  }

  return NextResponse.json({
    leidas: ordenes.length,
    insertadas,
    yaEstaban: ordenes.length - insertadas,
    salteadas,
    filaDeEncabezados: filaDeEncabezados + 1,
  });
}
