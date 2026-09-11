import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { permisosCanteraDe } from "@/lib/cantera/auth";
import { traerBochones, traerConsumosDe, traerVoladuras, traerYacimientos } from "@/lib/cantera/consultas";
import { montoPerforacion } from "@/lib/cantera/costos";
import { toneladasEstimadas } from "@/lib/cantera/toneladas";
import { metrosYPozos } from "@/lib/cantera/tramos";
import {
  armarInformeMensual,
  type BochonParaInforme,
  type VoladuraParaInforme,
} from "@/lib/cantera/informe";
import type { Consumo } from "@/lib/cantera/types";
import InformeClient from "./InformeClient";

function mesActual(): string {
  return new Date().toISOString().slice(0, 7);
}

/**
 * El informe mensual: perforaciones, voladuras y bochones del mes elegido, y
 * los indicadores por cantera. Reemplaza la pestaña `INFORME <MES>` que hoy
 * arma un Apps Script sobre la planilla.
 */
export default async function InformesPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const { mes: mesParam } = await searchParams;
  const mes = mesParam && /^\d{4}-\d{2}$/.test(mesParam) ? mesParam : mesActual();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const permisos = await permisosCanteraDe(supabase, user.id);
  if (!permisos.tieneAcceso) redirect("/");

  const yacimientos = await traerYacimientos(supabase);
  const porId = new Map(yacimientos.map((y) => [y.id, y]));

  const [vs, bs] = await Promise.all([traerVoladuras(supabase, {}), traerBochones(supabase, {})]);
  const consumos = await traerConsumosDe(supabase, vs.map((v) => v.codigo));
  const consumosPorCodigo = new Map<string, Consumo[]>();
  for (const c of consumos) {
    const lista = consumosPorCodigo.get(c.voladura_codigo) ?? [];
    lista.push(c);
    consumosPorCodigo.set(c.voladura_codigo, lista);
  }

  const voladuras: VoladuraParaInforme[] = vs.map((v) => {
    const yac = porId.get(v.yacimiento_id) ?? null;
    const perf = metrosYPozos(v.perf_tramos, v.pozos, v.metros_por_pozo);
    return {
      codigo: v.codigo,
      cantera: yac?.codigo ?? "?",
      perfFin: v.perf_fin,
      perfMetros: perf.metros,
      perfMontoUsd: perf.metros != null && v.perf_precio_usd_m != null ? perf.metros * v.perf_precio_usd_m : null,
      perfMontoArs: montoPerforacion({
        metros: perf.metros,
        precioUsdM: v.perf_precio_usd_m,
        tc: v.perf_tc_usd,
        nochesSereno: v.perf_noches_sereno,
        montoNoche: v.perf_monto_noche,
      }),
      volFecha: v.vol_fecha,
      volTc: v.vol_tc_usd,
      toneladas: null, // se recalcula abajo con metrosYPozos de la etapa de voladura
      consumos: (consumosPorCodigo.get(v.codigo) ?? []).map((c) => ({
        tipo: c.tipo,
        cantidad: c.cantidad,
        precio_usd: c.precio_usd,
      })),
    };
  });

  const bochones: BochonParaInforme[] = bs.map((b) => {
    const yac = porId.get(b.yacimiento_id) ?? null;
    const montoArs =
      b.metros_perforados != null && b.precio_usd_m != null && b.tc_usd != null
        ? b.metros_perforados * b.precio_usd_m * b.tc_usd
        : null;
    return {
      codigo: b.codigo,
      cantera: yac?.codigo ?? "?",
      fecha: b.fecha_voladura ?? b.fin,
      metros: b.metros_perforados,
      montoUsd: b.metros_perforados != null && b.precio_usd_m != null ? b.metros_perforados * b.precio_usd_m : null,
      montoArs,
    };
  });

  // Las toneladas van con la fórmula de cantera, la misma que usa el tablero.
  for (let i = 0; i < voladuras.length; i++) {
    const v = vs[i];
    const yac = porId.get(v.yacimiento_id) ?? null;
    const vol = metrosYPozos(v.vol_tramos, v.vol_pozos, v.vol_metros_por_pozo);
    voladuras[i].toneladas = toneladasEstimadas({
      metros: vol.metros ?? voladuras[i].perfMetros,
      densidad: v.densidad_t_m3 ?? yac?.densidad_t_m3 ?? null,
      burden: v.vol_burden_m ?? v.burden_m ?? yac?.burden_m ?? null,
      espaciamiento: v.vol_espaciamiento_m ?? v.espaciamiento_m ?? yac?.espaciamiento_m ?? null,
    });
  }

  const informe = armarInformeMensual(mes, voladuras, bochones);

  return <InformeClient informe={informe} mes={mes} />;
}
