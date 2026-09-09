import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { leerValores, listarPestanas } from "@/lib/core/sheets";
import { hayCredencialesGoogle } from "@/lib/core/google";
import { esAdminDespacho } from "@/lib/despacho/auth";
import { ordenesDeLaPlanilla } from "@/lib/despacho/importar";
import { pestanaDelMes } from "@/lib/despacho/planilla";

/**
 * Traer el histórico de la planilla `Órdenes de Carga`. Se corre una vez.
 *
 * **Recorre todas las pestañas**, porque el libro tiene una por mes: se leyó el
 * 09/09/2026 y son seis (`ABRIL 2026` … `SEPTIEMBRE 2026`) con 1.714 órdenes
 * entre todas. Una pestaña cuyos encabezados no se reconocen **no aborta la
 * importación**: se informa y se sigue con las demás. Al revés, una que falla
 * en silencio es un mes entero que nadie sabe que falta.
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

/** De a mil: un insert de miles de filas en una sola llamada se cae por tamaño. */
const LOTE = 1000;

interface Leida {
  numero: string;
  fecha: string;
  cliente_raw: string | null;
  producto_raw: string | null;
  entrada_predio: string | null;
  inicio_carga: string | null;
  fin_carga: string | null;
  salida_predio: string | null;
  notas: string | null;
  sheets_fila: number | null;
}

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
      { error: "Faltan GOOGLE_SERVICE_ACCOUNT_JSON o GOOGLE_SHEETS_DESPACHO_ID." },
      { status: 503 }
    );
  }

  const b = await cuerpoJson(request);
  // Un ensayo que lee y cuenta sin escribir nada. Es lo primero que conviene
  // correr contra un libro que nunca se leyó: dice pestaña por pestaña si los
  // encabezados se reconocieron, antes de insertar miles de filas.
  const ensayo = b?.ensayo === true;

  let pestanas: string[];
  try {
    pestanas = await listarPestanas(PLANILLA());
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }

  const porPestana: {
    pestana: string;
    leidas: number;
    salteadas: number;
    filaFueraDeMes: number;
    encabezados: number | null;
    error?: string;
  }[] = [];
  const todas: Leida[] = [];

  for (const pestana of pestanas) {
    let valores: string[][];
    try {
      valores = await leerValores(PLANILLA(), pestana, { sinFormato: true });
    } catch (e) {
      porPestana.push({
        pestana, leidas: 0, salteadas: 0, filaFueraDeMes: 0, encabezados: null,
        error: e instanceof Error ? e.message : String(e),
      });
      continue;
    }

    const { ordenes, filaDeEncabezados, salteadas } = ordenesDeLaPlanilla(valores);

    if (filaDeEncabezados === null) {
      porPestana.push({
        pestana, leidas: 0, salteadas: 0, filaFueraDeMes: 0, encabezados: null,
        error: "No se reconocieron los encabezados en las primeras 10 filas.",
      });
      continue;
    }

    let fueraDeMes = 0;
    for (const o of ordenes) {
      /*
       * `sheets_fila` sólo se guarda si el mes de la orden coincide con la
       * pestaña donde está el renglón.
       *
       * Si alguien tipeó una fecha de marzo en la hoja de abril, la pestaña se
       * despeja de la fecha (`pestanaDelMes`) y apuntaría a MARZO: una
       * corrección posterior reescribiría la fila 45 de la hoja equivocada,
       * pisando una orden que no tiene nada que ver. Con la fila en null, esa
       * corrección agrega un renglón nuevo — molesto pero visible, que es
       * siempre mejor que pisar en silencio.
       */
      const coincide = pestanaDelMes(o.fecha) === pestana;
      if (!coincide) fueraDeMes++;
      todas.push({
        numero: o.numero,
        fecha: o.fecha,
        cliente_raw: o.cliente_raw,
        producto_raw: o.producto_raw,
        entrada_predio: o.entrada_predio,
        inicio_carga: o.inicio_carga,
        fin_carga: o.fin_carga,
        salida_predio: o.salida_predio,
        notas: o.notas,
        sheets_fila: coincide ? o.fila : null,
      });
    }

    porPestana.push({
      pestana,
      leidas: ordenes.length,
      salteadas,
      filaFueraDeMes: fueraDeMes,
      encabezados: filaDeEncabezados + 1,
    });
  }

  /*
   * El mismo Nº de orden en dos pestañas es un choque que Postgres rechazaría
   * con un 23505 y abortaría el lote entero. Se queda la primera y se cuenta:
   * el número es único en el talonario, así que un repetido es un error de
   * tipeo en la planilla y hay que poder verlo.
   */
  const vistos = new Set<string>();
  const ordenes: Leida[] = [];
  let repetidos = 0;
  for (const o of todas) {
    if (vistos.has(o.numero)) { repetidos++; continue; }
    vistos.add(o.numero);
    ordenes.push(o);
  }

  const resumen = {
    pestanas: porPestana,
    leidas: ordenes.length,
    repetidosEnLaPlanilla: repetidos,
    salteadas: porPestana.reduce((a, p) => a + p.salteadas, 0),
  };

  if (ensayo) {
    return NextResponse.json({ ensayo: true, ...resumen, muestra: ordenes.slice(0, 5) });
  }

  const admin = createAdminClient();
  let insertadas = 0;

  for (let i = 0; i < ordenes.length; i += LOTE) {
    const { data, error } = await admin
      .from("despacho_ordenes_carga")
      // `cargado_por` queda en null a propósito: nadie la cargó en el sistema.
      // Es lo que distingue una fila importada de una cargada en la balanza.
      .upsert(ordenes.slice(i, i + LOTE), { onConflict: "numero", ignoreDuplicates: true })
      .select("id");

    if (error) {
      // Se devuelve cuántas entraron antes de fallar: reintentar es seguro
      // porque el upsert ignora las que ya están.
      return NextResponse.json({ error: error.message, insertadas, hasta: i }, { status: 400 });
    }
    insertadas += (data ?? []).length;
  }

  return NextResponse.json({ ...resumen, insertadas, yaEstaban: ordenes.length - insertadas });
}
