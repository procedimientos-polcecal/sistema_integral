import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { permisosCanteraDe } from "@/lib/cantera/auth";
import {
  traerConsumos,
  traerInsumos,
  traerVoladura,
  traerYacimientos,
} from "@/lib/cantera/consultas";
import VoladuraClient from "./VoladuraClient";

/**
 * El editor de una voladura: la etapa de perforación y la de voladura, con el
 * monto y las toneladas que se recalculan a medida que se carga, y la grilla de
 * consumos que alimenta el monto de la voladura.
 *
 * La conciliación de facturas (vincular la de Odoo, marcar conforme) es de
 * finanzas y va en su propio bloque, más abajo — llega en la próxima entrega.
 */
export default async function VoladuraPage({
  params,
}: {
  params: Promise<{ codigo: string }>;
}) {
  const { codigo } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const permisos = await permisosCanteraDe(supabase, user.id);
  if (!permisos.tieneAcceso) redirect("/");

  const voladura = await traerVoladura(supabase, codigo);
  if (!voladura) notFound();

  const [yacimientos, consumos, insumos] = await Promise.all([
    traerYacimientos(supabase),
    traerConsumos(supabase, codigo),
    traerInsumos(supabase, true),
  ]);
  const yacimiento = yacimientos.find((y) => y.id === voladura.yacimiento_id) ?? null;

  return (
    <VoladuraClient
      voladura={voladura}
      yacimiento={yacimiento}
      consumos={consumos}
      insumos={insumos}
      puedeEditar={permisos.puedeEditar}
    />
  );
}
