import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { nivelCalidadDe } from "@/lib/calidad/auth";
import {
  traerLimites,
  traerMuestrasDelDia,
  traerProductos,
  ultimoDiaConMuestras,
} from "@/lib/calidad/ensayos/consultas";
import { evaluarMuestra } from "@/lib/calidad/ensayos/limites";
import { armarReporte, type MuestraDelDia } from "@/lib/calidad/ensayos/reporte";
import type { Retenido } from "@/lib/calidad/ensayos/types";
import ReporteClient from "./ReporteClient";

/**
 * El reporte del día: la planilla que calidad reparte.
 *
 * Se abre parado en el último día con muestras y no en hoy: a la mañana, antes
 * del primer ensayo, "hoy" es una pantalla vacía que se lee como un error.
 */
export default async function ReportePage({
  searchParams,
}: {
  searchParams: Promise<{ fecha?: string }>;
}) {
  const { fecha: pedida } = await searchParams;
  const supabase = await createClient();

  const user = await usuarioActual();
  if (!user) redirect("/login");

  const nivel = await nivelCalidadDe(supabase, user.id);
  if (!nivel) redirect("/");

  const hoy = new Date().toISOString().slice(0, 10);
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(pedida ?? "")
    ? pedida!
    : (await ultimoDiaConMuestras(supabase)) ?? hoy;

  const [productos, limites, muestras] = await Promise.all([
    traerProductos(supabase),
    traerLimites(supabase),
    traerMuestrasDelDia(supabase, fecha),
  ]);

  // Los retenidos de esas muestras y de ninguna otra. Son pocas —un día son
  // entre una y cinco— así que el `.in()` no se acerca al largo de URL que
  // PostgREST rechaza.
  let retenidos: Retenido[] = [];
  if (muestras.length > 0) {
    const { data } = await supabase
      .from("calidad_ensayos_retenidos")
      .select("muestra_id, malla, retenido_g")
      .in(
        "muestra_id",
        muestras.map((m) => m.id)
      )
      .order("malla");
    retenidos = (data ?? []) as Retenido[];
  }

  const porId = new Map(productos.map((p) => [p.id, p]));

  const delDia: MuestraDelDia[] = muestras
    .map((m) => {
      const producto = porId.get(m.producto_id);
      if (!producto) return null;
      return {
        muestra: m,
        evaluada: evaluarMuestra(
          m,
          retenidos.filter((r) => r.muestra_id === m.id),
          limites
        ),
        producto: { id: producto.id, nombre: producto.nombre, orden: producto.orden },
      };
    })
    .filter((d): d is MuestraDelDia => d !== null);

  return <ReporteClient reporte={armarReporte(fecha, delDia)} />;
}
