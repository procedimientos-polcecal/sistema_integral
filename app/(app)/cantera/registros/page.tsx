import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { permisosCanteraDe } from "@/lib/cantera/auth";
import {
  traerBochones,
  traerConsumosDe,
  traerVoladuras,
  traerYacimientos,
} from "@/lib/cantera/consultas";
import { armarFilaBochon, armarFilaVoladura, type FilaBochon, type FilaVoladura } from "@/lib/cantera/tablero";
import type { Consumo } from "@/lib/cantera/types";
import CanteraClient from "./CanteraClient";

/**
 * Registros: el tablero de cantera. Por defecto todas las canteras; se puede
 * acotar a una y/o a un rango de fechas de voladura. El monto y las toneladas
 * se despejan al leer (nada de eso se guarda).
 *
 * Vivía en `/cantera` — se corrió acá cuando esa ruta pasó a ser la página de
 * inicio del módulo con los links a cada sección. `armarFilaVoladura`/
 * `armarFilaBochon` viven en `lib/cantera/tablero.ts` porque la página de
 * inicio también los necesita, para su adelanto de los últimos registros.
 */
export default async function RegistrosPage({
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
