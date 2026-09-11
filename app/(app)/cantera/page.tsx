import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { permisosCanteraDe } from "@/lib/cantera/auth";
import {
  traerBochones,
  traerConsumosDe,
  traerVoladuras,
  traerYacimientos,
} from "@/lib/cantera/consultas";
import { montoBochon, montoPerforacion, montoVoladura, cruce } from "@/lib/cantera/costos";
import { desvioContraPlanilla, toneladasEstimadas } from "@/lib/cantera/toneladas";
import { metrosYPozos } from "@/lib/cantera/tramos";
import type { Bochon, Consumo, Voladura, Yacimiento } from "@/lib/cantera/types";
import CanteraClient, { type FilaBochon, type FilaVoladura } from "./CanteraClient";

/**
 * El tablero de cantera: por defecto todas las canteras; se puede acotar a una
 * y/o a un rango de fechas de voladura. El monto y las toneladas se despejan al
 * leer (nada de eso se guarda).
 */
export default async function CanteraPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string; desde?: string; hasta?: string }>;
}) {
  const { y, desde, hasta } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const permisos = await permisosCanteraDe(supabase, user.id);
  if (!permisos.tieneAcceso) redirect("/");

  const yacimientos = await traerYacimientos(supabase, true);
  const porId = new Map(yacimientos.map((yy) => [yy.id, yy]));
  const yacimientoId = yacimientos.some((yy) => yy.id === y) ? y : undefined;
  const filtros = { yacimientoId, desde: desde || undefined, hasta: hasta || undefined };

  const [vs, bs] = await Promise.all([
    traerVoladuras(supabase, filtros),
    traerBochones(supabase, filtros),
  ]);

  const consumos = await traerConsumosDe(supabase, vs.map((v) => v.codigo));
  const consumosPorCodigo = new Map<string, Consumo[]>();
  for (const c of consumos) {
    const lista = consumosPorCodigo.get(c.voladura_codigo) ?? [];
    lista.push(c);
    consumosPorCodigo.set(c.voladura_codigo, lista);
  }

  const voladuras: FilaVoladura[] = vs.map((v) =>
    armarFilaVoladura(v, porId.get(v.yacimiento_id) ?? null, consumosPorCodigo.get(v.codigo) ?? [])
  );
  const bochones: FilaBochon[] = bs.map((b) => armarFilaBochon(b, porId.get(b.yacimiento_id) ?? null));

  return (
    <CanteraClient
      yacimientos={yacimientos}
      yacimientoId={yacimientoId ?? ""}
      desde={desde ?? ""}
      hasta={hasta ?? ""}
      voladuras={voladuras}
      bochones={bochones}
      puedeEditar={permisos.puedeEditar}
      puedeFacturar={permisos.puedeFacturar}
    />
  );
}

function armarFilaVoladura(
  v: Voladura,
  yac: Yacimiento | null,
  consumos: { cantidad: number | null; precio_usd: number | null; tipo: string | null }[]
): FilaVoladura {
  const perf = metrosYPozos(v.perf_tramos, v.pozos, v.metros_por_pozo);
  const vol = metrosYPozos(v.vol_tramos, v.vol_pozos, v.vol_metros_por_pozo);
  const metrosVol = vol.metros ?? perf.metros;

  const montoPerf = montoPerforacion({
    metros: perf.metros,
    precioUsdM: v.perf_precio_usd_m,
    tc: v.perf_tc_usd,
    nochesSereno: v.perf_noches_sereno,
    montoNoche: v.perf_monto_noche,
  });
  const montoVol = montoVoladura(consumos, v.vol_tc_usd);
  const toneladas = toneladasEstimadas({
    metros: metrosVol,
    densidad: v.densidad_t_m3 ?? yac?.densidad_t_m3 ?? null,
    burden: v.vol_burden_m ?? v.burden_m ?? yac?.burden_m ?? null,
    espaciamiento: v.vol_espaciamiento_m ?? v.espaciamiento_m ?? yac?.espaciamiento_m ?? null,
  });

  return {
    codigo: v.codigo,
    yacimiento: yac?.codigo ?? "?",
    vol_fecha: v.vol_fecha,
    perf_fin: v.perf_fin,
    pozos: perf.pozos,
    montoPerf,
    montoVol,
    toneladas,
    toneladas_planilla: v.toneladas_planilla,
    desvioFuera: desvioContraPlanilla(toneladas, v.toneladas_planilla).fueraDeRango,
    crucePerf: cruce(montoPerf, v.perf_odoo_importe).lectura,
    cruceVol: cruce(montoVol, v.vol_odoo_importe).lectura,
    sheets_pendiente: v.sheets_pendiente,
  };
}

function armarFilaBochon(b: Bochon, yac: Yacimiento | null): FilaBochon {
  const monto = montoBochon({
    cantidad: b.cantidad,
    metrosPerforados: b.metros_perforados,
    precioUsdM: b.precio_usd_m,
    tc: b.tc_usd,
  });
  return {
    codigo: b.codigo,
    yacimiento: yac?.codigo ?? "?",
    fecha: b.fecha_voladura ?? b.fin,
    voladura_codigo: b.voladura_codigo,
    cantidad: b.cantidad,
    metros_perforados: b.metros_perforados,
    monto,
    cruce: cruce(monto, b.odoo_importe).lectura,
    sheets_pendiente: b.sheets_pendiente,
  };
}
