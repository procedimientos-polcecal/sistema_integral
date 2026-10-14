import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { ultimaSincronizacionDe } from "@/lib/core/sincronizaciones";
import { traerTodo } from "@/lib/core/paginado";
import type { TurnoLike } from "@/lib/rrhh/engine/recalcular-puro";
import { conCalculoDelDia } from "@/lib/rrhh/fichadas/calculoDelDia";
import { rangoDeLista } from "@/lib/rrhh/fichadas/rangoDeLista";
import FichadasClient from "./FichadasClient";

/**
 * Sólo lo que esta página necesita nombrar. La fila trae más columnas —y el
 * embed de `empleados`, que Supabase infiere como arreglo aunque acá llegue un
 * objeto solo—, pero lo único que se usa con tipo es lo que pide
 * `conCalculoDelDia`; el resto viaja al cliente tal cual.
 */
interface FichadaDeLaLista {
  id: string;
  empleado_id: string;
  fecha: string;
}

export default async function FichadasPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // La lista arranca en una semana de días y no en "las últimas N filas". El
  // tope por filas era lo que escondía días enteros: con 60 o 70 personas
  // fichando, 50 filas no llegan a cubrir dos jornadas. Ver `rangoDeLista`.
  const rangoInicial = rangoDeLista(new Date());

  const [{ data: empleados }, fichadas, { data: jornadas, error: errorJornadas }, ultimaSync] = await Promise.all([
    supabase.from("empleados").select("id, legajo, nombre, apellido").eq("activo", true).order("apellido").order("nombre"),
    // `traerTodo` y el mismo orden que `GET /api/rrhh/fichadas`, que es lo que
    // refresca esta misma lista: si los dos caminos no trajeran lo mismo, la
    // pantalla cambiaría sola al guardar cualquier cosa. Y un rango cortado
    // por el tope de PostgREST dejaría un día por la mitad, que se ve bien y
    // está mal, porque lo acreditado se calcula por empleado y día.
    traerTodo<FichadaDeLaLista>((d, h) =>
      supabase
        .from("fichadas")
        .select("id, empleado_id, fecha, hora_entrada, hora_salida, origen, empleados(legajo, nombre, apellido)")
        .gte("fecha", rangoInicial.desde)
        .lte("fecha", rangoInicial.hasta)
        .order("fecha", { ascending: false })
        .order("id")
        .range(d, h)
    ).catch(() => null),
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

  return (
    <FichadasClient
      empleados={empleados ?? []}
      fichadasIniciales={fichadasConCalculo}
      // Por la misma razón que `turnos`: una lista que no se pudo leer y una
      // semana sin nadie fichando se ven idénticas, y son cosas muy distintas.
      fallaLaLista={fichadas === null}
      rangoInicial={rangoInicial}
      turnos={turnos}
      ultimaSync={ultimaSync}
    />
  );
}
