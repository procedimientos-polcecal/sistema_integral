import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hoyEnArgentina } from "@/lib/core/fechas";
import { nivelDespachoDe } from "@/lib/despacho/auth";
import {
  traerProveedoresDeRecepcion,
  traerRecepcionesAbiertasAnteriores,
  traerRecepcionesDelDia,
} from "@/lib/despacho/consultas";
import RecepcionesClient from "./RecepcionesClient";
import type { Recepcion } from "@/lib/despacho/types";

/**
 * La balanza: los camiones de material que entran al predio.
 *
 * Spec: docs/superpowers/specs/2026-09-11-despacho-recepcion-de-carbonilla-design.md
 *
 * Es la misma forma que la cola del día de las órdenes de carga, porque es el
 * mismo problema: alguien parado al lado de un camión. Una fila por recepción y
 * **un solo botón, el del próximo paso**.
 */

export interface ProveedorParaElAlta {
  id: string;
  nombre: string;
  /** Null si nadie cargó qué producto de Odoo le corresponde: no va a poder cerrarse. */
  producto: string | null;
}

export interface FilaDeRecepcion {
  recepcion: Recepcion;
  proveedor: string;
  /** De días anteriores y sin cerrar: va arriba y en ámbar. */
  atrasada: boolean;
}

export default async function RecepcionesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const nivel = await nivelDespachoDe(supabase, user.id);
  if (!nivel) redirect("/");

  const hoy = hoyEnArgentina();

  const [delDia, abiertas, config, proveedores, empresas] = await Promise.all([
    traerRecepcionesDelDia(supabase, hoy),
    traerRecepcionesAbiertasAnteriores(supabase, hoy),
    traerProveedoresDeRecepcion(supabase),
    // Los que traen material: los del rubro, más cualquiera que alguien haya
    // configurado aunque su rubro diga otra cosa.
    supabase
      .from("proveedores")
      .select("id, nombre, rubro")
      .eq("activo", true)
      .order("nombre"),
    supabase.from("empresas").select("id, nombre").eq("activo", true).order("nombre"),
  ]);

  const porProveedor = new Map(config.map((c) => [c.proveedor_id, c]));
  const todos = (proveedores.data ?? []) as { id: string; nombre: string; rubro: string | null }[];

  const paraElAlta: ProveedorParaElAlta[] = todos
    .filter((p) => porProveedor.has(p.id) || p.rubro === "CARBONILLA")
    .map((p) => ({
      id: p.id,
      nombre: p.nombre,
      producto: porProveedor.get(p.id)?.activo
        ? (porProveedor.get(p.id)?.odoo_product_nombre ?? null)
        : null,
    }));

  const nombreDe = new Map(todos.map((p) => [p.id, p.nombre]));
  const fila = (recepcion: Recepcion, atrasada: boolean): FilaDeRecepcion => ({
    recepcion,
    proveedor: nombreDe.get(recepcion.proveedor_id) ?? "—",
    atrasada,
  });

  return (
    <RecepcionesClient
      fecha={hoy}
      puedeEditar={nivel === "edicion" || nivel === "admin"}
      esAdmin={nivel === "admin"}
      filas={[...abiertas.map((r) => fila(r, true)), ...delDia.map((r) => fila(r, false))]}
      proveedores={paraElAlta}
      empresas={(empresas.data ?? []) as { id: string; nombre: string }[]}
    />
  );
}
