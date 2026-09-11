import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tieneAccesoCantera } from "@/lib/cantera/auth";
import { traerDatosParaInforme } from "@/lib/cantera/consultas";
import { armarInforme } from "@/lib/cantera/informe";
import { xlsxMultiSheetResponse } from "@/lib/core/xlsxExport";

/**
 * El .xlsx del informe: una hoja por tabla, para que la persona arme el
 * informe en Word/Excel con lo que ya está calculado. No arma un texto: da las
 * tablas, que es lo que pidió el usuario en vez de una prosa que el SdG no
 * puede escribir por él.
 *
 * Las mismas tablas que muestra la pantalla, en el mismo orden que las de la
 * planilla — sin los colores: `xlsx` (SheetJS, gratuita) no pinta celdas al
 * escribir. Si hace falta igual el color en el Excel, es una librería aparte.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await tieneAccesoCantera(supabase, user.id))) {
    return NextResponse.json({ error: "Sin acceso a Cantera" }, { status: 403 });
  }

  const url = new URL(request.url);
  const desde = url.searchParams.get("desde");
  const hasta = url.searchParams.get("hasta");
  if (!desde || !hasta || !/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
    return NextResponse.json({ error: "Faltan desde/hasta (YYYY-MM-DD)" }, { status: 400 });
  }

  const { voladuras, bochones } = await traerDatosParaInforme(supabase);
  const informe = armarInforme(desde, hasta, voladuras, bochones);

  const resumenHeaders = [
    "Cantera", "Toneladas", "Costo total USD", "Perf. USD", "Explosivo USD",
    "Accesorios USD", "Servicio USD", "Gr Expl./Ton", "USD/Ton", "Ton/m Perf.",
  ];
  const resumenRows = informe.porCantera.map((c) => [
    c.cantera, c.toneladas, c.costoTotalUsd, c.perforacionUsd, c.detonadorUsd,
    c.otrosInsumosUsd, c.servicioUsd, c.grExplosivoPorTon, c.usdPorTon, c.tonPorMetroPerforado,
  ]);

  const perforacionesHeaders = ["Código", "Cantera", "Fin Perf.", "Prof. (mts)", "Pozos", "Metros Perf.", "Total USD", "Total ARS"];
  const perforacionesRows = informe.perforaciones.map((p) => [
    p.codigo, p.cantera, p.fin, p.profundidadProm, p.pozos, p.metros, p.montoUsd, p.montoArs,
  ]);

  const voladurasHeaders = ["Código", "Cantera", "Fecha Voladura", "Gr Detonador", "Toneladas", "Total USD", "Total ARS"];
  const voladurasRows = informe.voladuras.map((v) => [v.codigo, v.cantera, v.fecha, v.gramosDetonador, v.toneladas, v.montoUsd, v.montoArs]);

  const bochonesHeaders = ["Código", "Cantera", "Fecha Voladura", "Metros Perf.", "Total USD", "Total ARS"];
  const bochonesRows = informe.bochones.map((b) => [b.codigo, b.cantera, b.fecha, b.metros, b.montoUsd, b.montoArs]);

  const consumosHeaders = ["Código", "Tipo", "Insumo", "Cantidad", "Precio USD", "Total USD", "Total ARS"];
  const consumosRows = informe.consumosDetalle.map((c) => [
    c.codigo, c.tipo, c.insumo, c.cantidad, c.precioUsd, c.totalUsd, c.totalArs,
  ]);

  return xlsxMultiSheetResponse(`cantera_informe_${desde}_a_${hasta}.xlsx`, [
    { name: "Resumen por cantera", rows: [resumenHeaders, ...resumenRows], anchos: [10, 12, 14, 12, 14, 14, 12, 12, 10, 12] },
    { name: "Perforaciones", rows: [perforacionesHeaders, ...perforacionesRows], anchos: [12, 10, 12, 12, 8, 12, 12, 14] },
    { name: "Voladuras", rows: [voladurasHeaders, ...voladurasRows], anchos: [12, 10, 14, 12, 12, 12, 14] },
    { name: "Bochones", rows: [bochonesHeaders, ...bochonesRows], anchos: [12, 10, 14, 12, 12, 14] },
    { name: "Consumos", rows: [consumosHeaders, ...consumosRows], anchos: [12, 12, 20, 10, 12, 12, 14] },
  ]);
}
