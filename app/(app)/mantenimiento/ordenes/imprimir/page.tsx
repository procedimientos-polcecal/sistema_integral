import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { nivelMantenimientoDe } from "@/lib/mantenimiento/auth";
import { hoyEnArgentina } from "@/lib/core/fechas";
import { armarElCalendario } from "@/lib/mantenimiento/calendarioDeOT";
import { ordenesDelRango } from "@/lib/mantenimiento/ordenesDelRango";
import { leerParametros } from "@/lib/mantenimiento/urlDeImpresion";
import type { GenteDelDia } from "@/lib/mantenimiento/genteDelDia";
import ImprimirClient from "./ImprimirClient";

/**
 * La hoja para imprimir el mes, la semana o el día de órdenes.
 *
 * ── LAS DOS CONDICIONES DE LA FRANJA ────────────────────────────────────────
 *
 * Esta pantalla es **una URL que cualquiera con Mantenimiento puede tipear**,
 * así que `?taller=1` no puede ser el permiso: es sólo el pedido, el que arma
 * el botón de la pantalla que sí muestra la rotación. Quién puede verla lo
 * decide `nivel === "admin"`, acá. La franja sale con las dos cosas juntas.
 *
 * Y sin permiso **la hoja se arma igual, sin franja y sin aviso**: quien la
 * pidió por la URL no tiene por qué enterarse de que esa banda existe.
 *
 * ── POR QUÉ LAS ÓRDENES SE TRAEN ACÁ ────────────────────────────────────────
 *
 * En el servidor y no desde el cliente: la hoja tiene que estar entera antes de
 * que alguien apriete imprimir. La consulta es la misma que la de la grilla
 * (`ordenesDelRango`) a propósito — una copia aparte le faltaría órdenes a la
 * hoja sin que nada avisara.
 *
 * `armarElCalendario` quiere un mapa de gente por día. Acá va **vacío**, y no
 * es un olvido: la hoja no dibuja la gente por día —el cuadro de un día mide
 * 39 × 35 mm y ese número sale constante nueve semanas seguidas—, así que
 * traerlo serían cuatro consultas más para un dato que no se imprime. Los días
 * quedan en «no sé», que es la verdad.
 */
const SIN_GENTE = new Map<string, GenteDelDia>();

export default async function ImprimirOrdenesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const nivel = await nivelMantenimientoDe(supabase, user.id);
  if (!nivel) redirect("/");

  const crudos = await searchParams;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(crudos)) {
    if (typeof v === "string") params.set(k, v);
    else if (Array.isArray(v) && v[0] !== undefined) params.set(k, v[0]);
  }

  const pedido = leerParametros(params);
  if ("error" in pedido) {
    return <ImprimirClient error={pedido.error} />;
  }

  const hoy = hoyEnArgentina();
  let dias;
  try {
    const ordenes = await ordenesDelRango(supabase, pedido.desde, pedido.hasta);
    dias = armarElCalendario(ordenes, pedido.desde, pedido.hasta, SIN_GENTE, hoy);
  } catch (e) {
    return <ImprimirClient error={e instanceof Error ? e.message : String(e)} />;
  }

  return (
    <ImprimirClient
      pedido={pedido}
      dias={dias}
      hoy={hoy}
      conFranja={pedido.taller && nivel === "admin"}
    />
  );
}
