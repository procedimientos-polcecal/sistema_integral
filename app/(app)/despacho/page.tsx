import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hoyEnArgentina } from "@/lib/core/fechas";
import { nivelDespachoDe } from "@/lib/despacho/auth";
import {
  traerOrdenesDelDia,
  traerOrdenesAbiertasAnteriores,
} from "@/lib/despacho/consultas";
import { traerCatalogoDeProductos, textoDeClasificacion } from "@/lib/core/productos";
import { clasificacionDeLaOrden } from "@/lib/despacho/clasificacion";
import { estadoDeLaOrden, horariosSalteados, tiemposDeLaOrden } from "@/lib/despacho/orden";
import type { EstadoDeOrden, HorarioDeOrden, OrdenDeCarga } from "@/lib/despacho/types";
import ColaClient from "./ColaClient";

/**
 * Movimientos diarios: la pantalla que queda abierta en la PC de la balanza.
 *
 * Todo lo derivado se resuelve **acá**, en el servidor, con las mismas
 * funciones que exportan a la planilla: el estado, los dos tiempos y la
 * clasificación del producto. El cliente sólo despliega — y calcula una única
 * cosa por su cuenta, el reloj del tramo en curso, porque avanza mientras la
 * pantalla está abierta.
 */

export interface FilaDeCola {
  orden: OrdenDeCarga;
  estado: EstadoDeOrden;
  /** "Filler A granel", o el nombre crudo del producto si nadie lo mapeó. */
  producto: string;
  /** El producto no está en `despacho_productos`: se ve que falta mapearlo. */
  sinClasificar: boolean;
  minutosDeCarga: number | null;
  minutosEnPredio: number | null;
  salteados: HorarioDeOrden[];
  /** Es de un día anterior y quedó sin cerrar. */
  atrasada: boolean;
}

export default async function DespachoPage({
  searchParams,
}: {
  searchParams: Promise<{ fecha?: string }>;
}) {
  const { fecha: pedida } = await searchParams;
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(pedida ?? "") ? pedida! : hoyEnArgentina();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const nivel = await nivelDespachoDe(supabase, user.id);
  if (!nivel) redirect("/");

  const [mapeo, delDia, abiertasAntes, empresas] = await Promise.all([
    traerCatalogoDeProductos(supabase),
    traerOrdenesDelDia(supabase, fecha),
    traerOrdenesAbiertasAnteriores(supabase, fecha),
    // Sólo hacen falta para el alta sin remito: con remito la empresa la dice
    // Odoo, y `empresas.odoo_company_id` la traduce.
    supabase.from("empresas").select("id, nombre").eq("activo", true).order("nombre"),
  ]);

  const armar = (orden: OrdenDeCarga, atrasada: boolean): FilaDeCola => {
    const clasificacion = clasificacionDeLaOrden(orden, mapeo);
    const tiempos = tiemposDeLaOrden(orden);
    return {
      orden,
      estado: estadoDeLaOrden(orden),
      producto: clasificacion
        ? textoDeClasificacion(clasificacion)
        : (orden.producto_raw ?? "—"),
      sinClasificar: clasificacion === null,
      minutosDeCarga: tiempos.carga,
      minutosEnPredio: tiempos.predio,
      salteados: horariosSalteados(orden),
      atrasada,
    };
  };

  return (
    <ColaClient
      fecha={fecha}
      hoy={hoyEnArgentina()}
      // Las que quedaron abiertas de días anteriores van primero: son camiones
      // que se fueron sin que nadie marcara la salida, y como el espejo escribe
      // al cerrar, todavía no llegaron a la planilla. Escondidas en el histórico
      // no las corrige nadie.
      filas={[
        ...abiertasAntes.map((o) => armar(o, true)),
        ...delDia.map((o) => armar(o, false)),
      ]}
      empresas={empresas.data ?? []}
      puedeEditar={nivel === "edicion" || nivel === "admin"}
    />
  );
}
