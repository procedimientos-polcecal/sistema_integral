import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { ultimaSincronizacionDe } from "@/lib/core/sincronizaciones";
import type { TurnoLike } from "@/lib/rrhh/engine/recalcular-puro";
import { conCalculoDelDia } from "@/lib/rrhh/fichadas/calculoDelDia";
import FichadasClient from "./FichadasClient";

export default async function FichadasPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: empleados }, { data: fichadas }, { data: jornadas, error: errorJornadas }, ultimaSync] = await Promise.all([
    supabase.from("empleados").select("id, legajo, nombre, apellido").eq("activo", true).order("apellido").order("nombre"),
    // 500 y no 50, igual que el refresco de la lista (`GET /api/rrhh/fichadas`):
    // la pantalla muestra las primeras 50, pero lo acreditado se calcula por
    // empleado y día, y un día cortado a la mitad por el límite daría un
    // resultado que se ve bien y está mal. Con 500 el corte cae lejos de lo que
    // se muestra.
    supabase
      .from("fichadas")
      .select("id, empleado_id, fecha, hora_entrada, hora_salida, origen, empleados(legajo, nombre, apellido)")
      .order("fecha", { ascending: false })
      .limit(500),
    // Los mismos turnos y el mismo filtro que usa el motor al liquidar
    // (`recalcular.ts`): lo que se muestra acreditado sale de ahí.
    supabase.from("jornadas").select("id, hora_inicio, hora_fin, tolerancia_minutos").eq("activo", true),
    ultimaSincronizacionDe(supabase, "rrhh", "lenox-marcaciones"),
  ]);

  // Si el catálogo no se pudo leer, null y no []: con una lista vacía la
  // pantalla mostraría la marca como si fuera lo acreditado, que es justo el
  // error que esto viene a evitar.
  const turnos: TurnoLike[] | null = errorJornadas
    ? null
    : (jornadas ?? []).map((t) => ({
        id: t.id,
        horaInicio: t.hora_inicio,
        horaFin: t.hora_fin,
        toleranciaMinutos: t.tolerancia_minutos,
      }));

  // El cálculo que el motor guardó para cada día (tardanza, retiro, horas
  // fijadas a mano): se lee de `calculos_diarios` y no se deduce acá. Es la
  // misma función que usa el refresco de la lista.
  const fichadasConCalculo = await conCalculoDelDia(supabase, fichadas ?? []);

  return <FichadasClient empleados={empleados ?? []} fichadasIniciales={fichadasConCalculo} turnos={turnos} ultimaSync={ultimaSync} />;
}
