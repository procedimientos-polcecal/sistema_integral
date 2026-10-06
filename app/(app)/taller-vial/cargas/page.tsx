import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { permisosTallerVialDe } from "@/lib/tallerVial/auth";
import { traerCargas, traerEquiposTallerVial } from "@/lib/tallerVial/consultas";
import { calcularTrabajoEntreCargas } from "@/lib/tallerVial/combustible";
import CargasClient from "./CargasClient";

export default async function CargasTallerVialPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const { mes: mesParam } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const permisos = await permisosTallerVialDe(supabase, user.id);
  if (!permisos.tieneAcceso) redirect("/");

  // eslint-disable-next-line react-hooks/purity -- se resuelve una vez por request, no en cada render
  const mesActual = new Date().toISOString().slice(0, 7);
  const mes = mesParam && /^\d{4}-\d{2}$/.test(mesParam) ? mesParam : mesActual;

  const [equipos, todasLasCargas] = await Promise.all([
    traerEquiposTallerVial(supabase),
    traerCargas(supabase, {}),
  ]);

  // El trabajado encadena contra la carga anterior CON lectura del mismo
  // equipo, así que se calcula sobre el historial completo y recién después
  // se filtra al mes que se está mirando — filtrar antes cortaría la cadena
  // en cada borde de mes.
  const conTrabajo = calcularTrabajoEntreCargas(
    todasLasCargas
      .filter((c) => c.equipo_id !== null)
      .map((c) => ({ id: c.id, equipoId: c.equipo_id!, fecha: c.fecha, litros: c.litros, lectura: c.lectura }))
  );
  const trabajoPorId = new Map(conTrabajo.map((c) => [c.id, c]));

  const cargasDelMes = todasLasCargas
    .filter((c) => c.fecha.startsWith(mes))
    .map((c) => ({
      ...c,
      trabajado: trabajoPorId.get(c.id)?.trabajado ?? null,
      consumoPorUnidad: trabajoPorId.get(c.id)?.consumoPorUnidad ?? null,
    }))
    .sort((a, b) => (a.fecha === b.fecha ? 0 : a.fecha < b.fecha ? 1 : -1));

  return (
    <CargasClient
      mes={mes}
      equipos={equipos}
      cargas={cargasDelMes}
      puedeEditar={permisos.puedeEditar}
    />
  );
}
