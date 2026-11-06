import { NextResponse } from "next/server";
import { revisarElSecreto } from "@/lib/core/cron";
import { importarDesdeSheets, reintentarPendientes } from "@/lib/compras/sheets";
import { avisarDeLosPedidosQueEsperan } from "@/lib/compras/avisoDeAprobacion";
import { reintentarSeguimiento } from "@/lib/compras/seguimientoSheets";

export const maxDuration = 300;

/**
 * Trae de la planilla los RI nuevos, mientras dure la transición.
 *
 * Lo llaman dos relojes: el cron diario de Vercel que está en vercel.json, y el
 * workflow de GitHub Actions que corre cada 15 minutos. El de Vercel queda como
 * red de seguridad por si Actions falla; la frecuencia real la marca el otro,
 * porque el plan Hobby no admite crons más seguidos que un día.
 *
 * Falla cerrado: sin CRON_SECRET configurado devuelve 503 en vez de quedar
 * abierto a cualquiera que conozca la URL.
 */
export async function GET(request: Request) {
  const rechazo = revisarElSecreto(request);
  if (rechazo) return rechazo;

  // Sin planilla configurada no hay nada que sincronizar; no es un error.
  if (!process.env.GOOGLE_SHEETS_COMPRAS_ID) {
    return NextResponse.json({ omitido: "GOOGLE_SHEETS_COMPRAS_ID no configurado" });
  }

  try {
    const importado = await importarDesdeSheets("cron");
    // Y de paso reintenta lo que la planilla había rechazado: casi siempre el
    // motivo se corrigió afuera (se cargó un alias, se dio un permiso).
    const reintento = await reintentarPendientes();
    // El libro de seguimiento tiene su propia cola: `seguimiento_pendiente`.
    const seguimiento = await reintentarSeguimiento();
    // El aviso al instante a quien aprueba. Va despues de todo lo demas y no
    // puede fallar la corrida: `avisarDeLosPedidosQueEsperan` no tira.
    //
    // Este cron corre 09:00 UTC, o sea las 6 de la manana de aca, que esta
    // fuera de la ventana 7:00-21:00 a proposito: lo que traiga a esa hora lo
    // levanta el resumen de las 8:30. Se llama igual porque el cron puede
    // correrse y porque la decision de la hora vive en un solo lugar.
    const aviso = await avisarDeLosPedidosQueEsperan(importado.nacen_esperando);
    return NextResponse.json({
      ...importado, reintento, seguimiento,
      avisos_al_instante: aviso.enviadas,
      ...(aviso.motivo ? { avisos_al_instante_motivo: aviso.motivo } : {}),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
