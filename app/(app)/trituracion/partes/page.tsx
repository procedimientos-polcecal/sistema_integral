import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { traerPesadas } from "@/lib/cantera/consultas";
import { tipoDeAcarreo } from "@/lib/cantera/acarreo";
import { permisosTrituracionDe } from "@/lib/trituracion/auth";
import { traerOperariosDeTrituracion, traerPartes, traerPlantas } from "@/lib/trituracion/consultas";
import { llegadasPorDiaYPlanta } from "@/lib/trituracion/cruceCantera";
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

  const llegadasDelMes = llegadasPorDiaYPlanta(
    pesadas.map((p) => ({ fecha: p.fecha, destino: p.destino, toneladas: p.toneladas, tipo: p.tipo }))
  );
  // Sólo los días de esta planta, como objeto serializable (un Map no cruza
  // el límite servidor→cliente), con el código de material ya resuelto a su
  // etiqueta legible ("dolomita_d1" -> "Dolomita D1"). Cubre cualquier día
  // del mes, no sólo los que ya tienen parte cargado en el SdG.
  const llegadoPorFecha: Record<string, { total: number; porTipo: { etiqueta: string; toneladas: number }[] }> = {};
  for (const [clave, llegada] of llegadasDelMes) {
    const [codigo, fecha] = clave.split("|");
    if (codigo === planta.codigo && llegada.total > 0) {
      llegadoPorFecha[fecha] = {
        total: llegada.total,
        porTipo: llegada.porTipo.map((m) => ({ etiqueta: tipoDeAcarreo(m.tipo)?.etiqueta ?? m.tipo, toneladas: m.toneladas })),
      };
    }
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
