import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { nivelMantenimientoDe } from "@/lib/mantenimiento/auth";
import { semanaDe } from "@/lib/core/fechas";
import {
  comoReferencia,
  laQueRige,
  turnoDeLaPersona,
  type FilaDeReferencia,
} from "@/lib/mantenimiento/referenciaDelTaller";
import type { Grupo, Oficio } from "@/lib/mantenimiento/programacion";
import type { PersonaParaElParte } from "@/lib/mantenimiento/operariosDelParte";
import ParteDiarioClient from "./ParteDiarioClient";

/**
 * El parte diario del plan, para imprimir.
 *
 * Carga lo mismo que `imprimir/` y con los mismos controles de sesión y nivel:
 * son dos vistas del mismo plan —una OT por página aquélla, el turno entero en
 * una tabla ésta— y una ruta de impresión abierta por link directo es una ruta
 * abierta igual.
 */
export default async function ParteDiarioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const nivel = await nivelMantenimientoDe(supabase, user.id);
  if (!nivel) redirect("/");

  const { data: plan } = await supabase
    .from("planificacion_diaria")
    .select("id, fecha, titulo, planificacion_diaria_items(id, ot_number, sector_raw, equipo_raw, descripcion, repuesto, orden)")
    .eq("id", id)
    .single();

  if (!plan) notFound();

  /*
   * La gente del taller con el turno que el ciclo le da esa semana, para que el
   * parte pueda ofrecer primero a los del turno elegido.
   *
   * Se lee el padrón **vigente el día del plan** y no el de hoy: un parte de
   * hace tres meses tiene que ofrecer a quien estaba entonces. Y se usa
   * `laQueRige`, compartida con la programación semanal, porque cuál referencia
   * manda es una decisión que no puede contestarse distinto en dos pantallas.
   *
   * Sin referencia cargada —que es el estado de hoy— nadie tiene turno y todos
   * caen en «los demás», que `repartirPorTurno` ya resuelve.
   */
  const dia = String(plan.fecha).slice(0, 10);
  const lunes = semanaDe(dia)[0];

  const [{ data: padron }, { data: refs }] = await Promise.all([
    supabase
      .from("mant_personal_taller")
      .select("empleado_id, oficio, grupo, desde, hasta, empleados(nombre, apellido)")
      .lte("desde", dia)
      .or(`hasta.is.null,hasta.gte.${dia}`),
    supabase
      .from("mant_programacion_referencia")
      .select("lunes, grupo_en_4a12, electricista_4a12_id, electricista_8a16_id, electricista_12a20_id"),
  ]);

  const fila = laQueRige((refs ?? []) as FilaDeReferencia[], lunes);
  const ref = fila ? comoReferencia(fila) : null;

  const gente: PersonaParaElParte[] = (padron ?? []).map((p) => {
    const e = Array.isArray(p.empleados) ? p.empleados[0] : p.empleados;
    const persona = {
      empleadoId: p.empleado_id as string,
      oficio: p.oficio as Oficio,
      grupo: (p.grupo ?? null) as Grupo | null,
    };
    return {
      empleadoId: persona.empleadoId,
      nombre: e ? `${e.apellido}, ${e.nombre}` : "(sin nombre)",
      turno: ref ? turnoDeLaPersona(ref, lunes, persona) : null,
    };
  });

  const items = [...(plan.planificacion_diaria_items ?? [])].sort((a, b) => a.orden - b.orden);
  return (
    <ParteDiarioClient
      plan={plan}
      items={items}
      gente={gente}
      puedeEditar={nivel === "edicion" || nivel === "admin"}
    />
  );
}
