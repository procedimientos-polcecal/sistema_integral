import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { permisosTrituracionDe } from "@/lib/trituracion/auth";
import { traerOperariosDeTrituracion, traerPartes, traerPlantas } from "@/lib/trituracion/consultas";
import PartesClient from "./PartesClient";

export default async function PartesTrituracionPage({
  searchParams,
}: {
  searchParams: Promise<{ planta?: string; mes?: string }>;
}) {
  const { planta: plantaParam, mes: mesParam } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const permisos = await permisosTrituracionDe(supabase, user.id);
  if (!permisos.tieneAcceso) redirect("/");

  const plantas = await traerPlantas(supabase);
  if (plantas.length === 0) {
    redirect("/trituracion");
  }

  const plantaId = plantas.find((p) => p.id === plantaParam)?.id ?? plantas[0].id;

  // eslint-disable-next-line react-hooks/purity -- se resuelve una vez por request, no en cada render
  const mesActual = new Date().toISOString().slice(0, 7);
  const mes = mesParam && /^\d{4}-\d{2}$/.test(mesParam) ? mesParam : mesActual;
  const [anio, mesNum] = mes.split("-").map(Number);
  const primerDia = `${mes}-01`;
  const ultimoDia = new Date(Date.UTC(anio, mesNum, 0)).toISOString().slice(0, 10);

  const [partes, empleados] = await Promise.all([
    traerPartes(supabase, { plantaId, desde: primerDia, hasta: ultimoDia }),
    traerOperariosDeTrituracion(supabase),
  ]);

  return (
    <PartesClient
      plantas={plantas}
      plantaId={plantaId}
      mes={mes}
      partes={partes}
      empleados={empleados}
      puedeEditar={permisos.puedeEditar}
    />
  );
}
