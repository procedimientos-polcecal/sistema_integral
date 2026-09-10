import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { permisosCanteraDe } from "@/lib/cantera/auth";
import {
  traerBochonesDeYacimiento,
  traerConsumos,
  traerVoladurasDeYacimiento,
  traerYacimientos,
} from "@/lib/cantera/consultas";
import { montoBochon, montoPerforacion, montoVoladura, cruce } from "@/lib/cantera/costos";
import { desvioContraPlanilla, toneladasEstimadas } from "@/lib/cantera/toneladas";
import type { Yacimiento } from "@/lib/cantera/types";
import CanteraClient, { type FilaBochon, type FilaVoladura } from "./CanteraClient";

/**
 * El tablero por yacimiento.
 *
 * Es la pantalla desde donde el capataz cierra una voladura en el frente y
 * desde donde finanzas mira los montos sin conciliar. Se elige una cantera y
 * abajo van sus perforaciones/voladuras y sus bochones, con el monto y las
 * toneladas despejados al leer (nada de eso se guarda).
 */
export default async function CanteraPage({
  searchParams,
}: {
  searchParams: Promise<{ y?: string }>;
}) {
  const { y } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const permisos = await permisosCanteraDe(supabase, user.id);
  if (!permisos.tieneAcceso) redirect("/");

  const yacimientos = await traerYacimientos(supabase, true);
  const elegido = yacimientos.find((yy) => yy.id === y) ?? yacimientos[0] ?? null;

  let voladuras: FilaVoladura[] = [];
  let bochones: FilaBochon[] = [];

  if (elegido) {
    const [vs, bs] = await Promise.all([
      traerVoladurasDeYacimiento(supabase, elegido.id),
      traerBochonesDeYacimiento(supabase, elegido.id),
    ]);

    // Los consumos de cada voladura, para el monto de la etapa de voladura.
    const consumosPorCodigo = new Map<string, { cantidad: number | null; precio_usd: number | null }[]>();
    await Promise.all(
      vs.map(async (v) => {
        consumosPorCodigo.set(v.codigo, await traerConsumos(supabase, v.codigo));
      })
    );

    voladuras = vs.map((v) => armarFilaVoladura(v, elegido, consumosPorCodigo.get(v.codigo) ?? []));
    bochones = bs.map(armarFilaBochon);
  }

  return (
    <CanteraClient
      yacimientos={yacimientos}
      elegido={elegido}
      voladuras={voladuras}
      bochones={bochones}
      puedeEditar={permisos.puedeEditar}
      puedeFacturar={permisos.puedeFacturar}
    />
  );
}

function armarFilaVoladura(
  v: Awaited<ReturnType<typeof traerVoladurasDeYacimiento>>[number],
  yac: Yacimiento,
  consumos: { cantidad: number | null; precio_usd: number | null }[]
): FilaVoladura {
  const montoPerf = montoPerforacion({
    pozos: v.pozos,
    metrosPorPozo: v.metros_por_pozo,
    precioUsdM: v.perf_precio_usd_m,
    tc: v.perf_tc_usd,
  });
  const montoVol = montoVoladura(consumos, v.vol_tc_usd);
  const toneladas = toneladasEstimadas({
    pozos: v.vol_pozos ?? v.pozos,
    metrosPorPozo: v.vol_metros_por_pozo ?? v.metros_por_pozo,
    densidad: yac.densidad_t_m3,
    burden: v.vol_burden_m ?? v.burden_m ?? yac.burden_m,
    espaciamiento: v.vol_espaciamiento_m ?? v.espaciamiento_m ?? yac.espaciamiento_m,
  });

  return {
    codigo: v.codigo,
    vol_fecha: v.vol_fecha,
    perf_fin: v.perf_fin,
    pozos: v.pozos,
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

function armarFilaBochon(b: Awaited<ReturnType<typeof traerBochonesDeYacimiento>>[number]): FilaBochon {
  const monto = montoBochon({
    metrosPerforados: b.metros_perforados,
    precioUsdM: b.precio_usd_m,
    tc: b.tc_usd,
  });
  return {
    codigo: b.codigo,
    fin: b.fin,
    voladura_codigo: b.voladura_codigo,
    metros_perforados: b.metros_perforados,
    monto,
    cruce: cruce(monto, b.odoo_importe).lectura,
    sheets_pendiente: b.sheets_pendiente,
  };
}
