import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { permisosCanteraDe } from "@/lib/cantera/auth";
import { traerBochon, traerYacimientos } from "@/lib/cantera/consultas";
import BochonClient from "./BochonClient";

/** El editor de un bochón. La conciliación de su factura es de finanzas. */
export default async function BochonPage({
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

  const bochon = await traerBochon(supabase, codigo);
  if (!bochon) notFound();

  const yacimientos = await traerYacimientos(supabase);
  const yacimiento = yacimientos.find((y) => y.id === bochon.yacimiento_id) ?? null;

  return (
    <BochonClient
      bochon={bochon}
      yacimiento={yacimiento}
      puedeEditar={permisos.puedeEditar}
      puedeFacturar={permisos.puedeFacturar}
    />
  );
}
