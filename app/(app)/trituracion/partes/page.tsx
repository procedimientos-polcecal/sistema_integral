import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { traerPesadas } from "@/lib/cantera/consultas";
import { permisosTrituracionDe } from "@/lib/trituracion/auth";
import { traerOperariosDeTrituracion, traerPartes, traerPlantas } from "@/lib/trituracion/consultas";
import { toneladasLlegadasPorDiaYPlanta } from "@/lib/trituracion/cruceCantera";
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

  const planta = plantas.find((p) => p.id === plantaParam) ?? plantas[0];
  const plantaId = planta.id;

  // eslint-disable-next-line react-hooks/purity -- se resuelve una vez por request, no en cada render
  const mesActual = new Date().toISOString().slice(0, 7);
  const mes = mesParam && /^\d{4}-\d{2}$/.test(mesParam) ? mesParam : mesActual;
  const [anio, mesNum] = mes.split("-").map(Number);
  const primerDia = `${mes}-01`;
  const ultimoDia = new Date(Date.UTC(anio, mesNum, 0)).toISOString().slice(0, 10);

  // Cantera es otro módulo: si el usuario no tiene acceso ahí, RLS devuelve
  // cero filas (no un error) y el cruce simplemente no muestra nada, sin
  // romper la pantalla de Trituración.
  const [partes, empleados, pesadas] = await Promise.all([
    traerPartes(supabase, { plantaId, desde: primerDia, hasta: ultimoDia }),
    traerOperariosDeTrituracion(supabase),
    traerPesadas(supabase, { mes }),
  ]);

  const llegadasDelMes = toneladasLlegadasPorDiaYPlanta(
    pesadas.map((p) => ({ fecha: p.fecha, destino: p.destino, toneladas: p.toneladas }))
  );
  // Sólo lo de esta planta, como Record serializable (un Map no cruza el
  // límite servidor→cliente): "codigo|fecha" -> "fecha" para esta planta.
  const llegadoPorFecha: Record<string, number> = {};
  for (const [clave, toneladas] of llegadasDelMes) {
    const [codigo, fecha] = clave.split("|");
    if (codigo === planta.codigo) llegadoPorFecha[fecha] = toneladas;
  }

  return (
    <PartesClient
      plantas={plantas}
      plantaId={plantaId}
      mes={mes}
      partes={partes}
      empleados={empleados}
      puedeEditar={permisos.puedeEditar}
      llegadoPorFecha={llegadoPorFecha}
    />
  );
}
