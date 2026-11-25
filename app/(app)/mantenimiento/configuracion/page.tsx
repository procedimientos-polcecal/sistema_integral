import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { esAdminMantenimiento, nivelMantenimientoDe } from "@/lib/mantenimiento/auth";
import ConfiguracionClient from "./ConfiguracionClient";
import { empresaDelSector } from "@/lib/mantenimiento/sectores";
import { traerTodo } from "@/lib/core/paginado";
import { comoSeLeeElPrograma } from "@/lib/mantenimiento/configurarElCiclo";
import { loQueHaraElCiclo } from "@/lib/mantenimiento/loQueHaraElCiclo";
import type { OTDelCiclo } from "@/lib/mantenimiento/cicloDeOT";
import type { CerradaParaMirar } from "@/lib/mantenimiento/sospechaDeCambio";
import type {
  CicloDeLaSeccion, ProgramadoDeLaSeccion,
} from "./LoQueCreaOrdenesSolo";

/**
 * Las listas de las que come el módulo.
 *
 * Nada de esto se carga en el momento de usarlo: quien registra una orden de
 * trabajo a las siete de la mañana elige de una lista, no escribe nombres. Acá
 * se arma esa lista.
 *
 * Y arriba de todo va lo único de esta pantalla que **no** es una lista: lo
 * que hace que el sistema cree órdenes solo.
 */
export default async function ConfiguracionMantenimientoPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const nivel = await nivelMantenimientoDe(supabase, user.id);
  if (!nivel) redirect("/");

  const esAdmin = await esAdminMantenimiento(supabase, user.id);

  const [
    { data: operarios }, { data: contratistas }, { data: tipos }, { data: sectores },
    { data: tarifas }, { data: razones }, loQueCrea,
  ] = await Promise.all([
      supabase.from("operarios").select("id, slot, nombre").order("slot").order("nombre"),
      supabase
        .from("proveedores")
        .select("id, nombre, cuit, activo")
        .eq("es_contratista", true)
        .order("nombre"),
      supabase
        .from("equipos_tipos")
        .select("tipo_id, categoria, nombre_tipo, lubricante_tipo, frecuencia_lubricacion")
        .order("categoria")
        .order("nombre_tipo"),
      supabase
        .from("sectores")
        .select("id, codigo, nombre, empresas(nombre)")
        .eq("es_de_planta", true)
        .order("codigo"),
      // De la más nueva a la más vieja: la primera cuya fecha ya pasó es la que
      // rige hoy.
      supabase
        .from("mantenimiento_tarifas_hora")
        .select("id, valor, vigente_desde")
        .order("vigente_desde", { ascending: false }),
      // Cuántos días corre una OT según por qué se posterga. El código de cada
      // razón es vocabulario cerrado del servidor; acá se calibran los días.
      supabase
        .from("mant_razones_de_postergacion")
        .select("codigo, etiqueta, dias, activa, orden")
        .order("orden")
        .order("etiqueta"),
      losQueCreanOrdenesSolo(supabase),
    ]);

  return (
    <ConfiguracionClient
      esAdmin={esAdmin}
      puedeEditar={nivel === "edicion" || nivel === "admin"}
      operarios={operarios ?? []}
      contratistas={contratistas ?? []}
      tipos={tipos ?? []}
      tarifas={tarifas ?? []}
      razones={razones ?? []}
      ciclos={loQueCrea.ciclos}
      programados={loQueCrea.programados}
      sectores={(sectores ?? []).map((s) => ({
        id: s.id as string,
        codigo: s.codigo as string | null,
        nombre: s.nombre as string,
        empresa: empresaDelSector(s.empresas),
      }))}
    />
  );
}

/**
 * Los dos motores de OT automáticas, con la previsión de cada ciclo ya
 * resuelta.
 *
 * **La previsión se calcula acá y no en el cliente**, porque sale de
 * `loQueHaraElCiclo()` —la misma función que usa el generador— y ésa necesita
 * las OT del ciclo y, para los que no arrancaron, las cerradas del equipo.
 * Son dos lecturas de tamaño `traerTodo`: no es algo que se recalcule por
 * tecla.
 *
 * Se lee con la sesión, como el resto de esta página. Quien llegó hasta acá
 * tiene el módulo, así que las policies de Mantenimiento lo dejan pasar.
 */
async function losQueCreanOrdenesSolo(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<{ ciclos: CicloDeLaSeccion[]; programados: ProgramadoDeLaSeccion[] }> {
  const [{ data: ciclosLeidos }, { data: programadosLeidos }] = await Promise.all([
    supabase
      .from("mant_ciclos_de_ot")
      .select(
        "id, equipment_id, repeticiones, especialidad, horas_estimadas, desde, vuelta_desde, activo, creado_en, tarea_madre_id, tarea_hija_id, equipos:equipment_id(code, name, is_active), madre:tarea_madre_id(nombre, componente, accion), hija:tarea_hija_id(nombre, componente, accion, periodo_dias)"
      )
      .order("creado_en"),
    supabase
      .from("mantenimientos_programados")
      .select("id, schedule_type, interval_days, next_date, status, equipos:equipment_id(code, name)")
      .order("next_date"),
  ]);

  // El mismo `as unknown as` que usa `generarEncadenadas` para leer esta
  // tabla: Supabase infiere los embebidos a-uno como arreglos.
  const ciclos = (ciclosLeidos ?? []) as unknown as CicloLeido[];
  const programados = comoSeLeenLosProgramados(
    (programadosLeidos ?? []) as unknown as ProgramadoLeido[]
  );

  if (ciclos.length === 0) return { ciclos: [], programados };

  // Todas las OT de ciclo: hoy son diez, pero una tabla que crece no avisa
  // cuando cruza las mil filas de PostgREST.
  const todasLasOT = await traerTodo<OTDelCiclo & { ciclo_id: string | null }>((de, a) =>
    supabase
      .from("ordenes_trabajo")
      .select("ot_number, ciclo_id, ciclo_vuelta, estado, fecha_cierre, fecha_ejecucion, created_at_app")
      .not("ciclo_id", "is", null)
      .range(de, a)
  );

  // Las tareas confirmadas de esos equipos, que son las que se le pueden
  // poner a un ciclo. Son pocas y por equipo; se traen enteras para que el
  // desplegable del cambio de tareas no tenga que pedirlas después.
  const { data: tareasLeidas } = await supabase
    .from("mant_tareas_preventivas")
    .select("id, equipment_id, nombre, accion, componente")
    .eq("estado", "CONFIRMADA")
    .in("equipment_id", ciclos.map((c) => c.equipment_id))
    .order("nombre");

  const tareasPorEquipo = new Map<string, { id: string; nombre: string }[]>();
  for (const t of (tareasLeidas ?? []) as { id: string; equipment_id: string; nombre: string }[]) {
    const lista = tareasPorEquipo.get(t.equipment_id) ?? [];
    lista.push({ id: t.id, nombre: t.nombre });
    tareasPorEquipo.set(t.equipment_id, lista);
  }

  // Y las cerradas de los equipos de los ciclos que todavía no arrancaron, que
  // es de donde sale su arranque. Si no hay ninguno, no se lee nada.
  const sinArrancar = ciclos.filter((c) => !c.desde);
  const cerradas = sinArrancar.length === 0 ? [] :
    await traerTodo<CerradaParaMirar>((de, a) =>
      supabase
        .from("ordenes_trabajo")
        .select("ot_number, equipment_id, descripcion, fecha_cierre, ciclo_id")
        .in("equipment_id", sinArrancar.map((c) => c.equipment_id))
        .gte("fecha_cierre", sinArrancar.map((c) => String(c.creado_en).slice(0, 10)).sort()[0])
        .range(de, a)
    );

  return {
    ciclos: ciclos.map((c) => {
      const hara = loQueHaraElCiclo(
        {
          id: c.id,
          equipment_id: c.equipment_id,
          repeticiones: c.repeticiones,
          desde: c.desde,
          vuelta_desde: c.vuelta_desde,
          creado_en: String(c.creado_en),
          equipoActivo: c.equipos?.is_active !== false,
          equipoCode: c.equipos?.code ?? null,
          madre: c.madre ?? null,
          hija: c.hija ?? null,
        },
        todasLasOT.filter((o) => o.ciclo_id === c.id),
        cerradas.filter((x) => x.equipment_id === c.equipment_id)
      );

      return {
        id: c.id,
        equipoId: c.equipment_id,
        equipoCode: c.equipos?.code ?? null,
        equipoNombre: c.equipos?.name ?? null,
        tareaMadreId: c.tarea_madre_id,
        tareaHijaId: c.tarea_hija_id,
        madre: c.madre?.nombre ?? "—",
        hija: c.hija?.nombre ?? "—",
        accionMadre: c.madre?.accion ?? "",
        componente: c.hija?.componente ?? c.madre?.componente ?? "",
        repeticiones: c.repeticiones,
        periodoDias: c.hija?.periodo_dias ?? null,
        especialidad: c.especialidad,
        horasEstimadas: c.horas_estimadas === null ? null : Number(c.horas_estimadas),
        activo: c.activo,
        desde: c.desde,
        vueltaDesde: c.vuelta_desde,
        tareasDelEquipo: tareasPorEquipo.get(c.equipment_id) ?? [],
        decision: hara.decision,
      };
    }),
    programados,
  };
}

type TareaLeida = {
  nombre: string;
  componente: string;
  accion: string;
  periodo_dias?: number | null;
};

type CicloLeido = {
  id: string;
  equipment_id: string;
  repeticiones: number;
  especialidad: string | null;
  horas_estimadas: number | string | null;
  desde: string | null;
  vuelta_desde: number | null;
  activo: boolean;
  creado_en: string;
  tarea_madre_id: string;
  tarea_hija_id: string;
  equipos: { code: string | null; name: string | null; is_active: boolean | null } | null;
  madre: TareaLeida | null;
  hija: TareaLeida | null;
};

type ProgramadoLeido = {
  id: string;
  schedule_type: string;
  interval_days: number | null;
  next_date: string | null;
  status: string;
  equipos: { code: string | null; name: string | null } | null;
};

function comoSeLeenLosProgramados(filas: ProgramadoLeido[]): ProgramadoDeLaSeccion[] {
  return filas.map((p) => ({
    id: p.id,
    equipo: [p.equipos?.code, p.equipos?.name].filter(Boolean).join(" – ") || "—",
    cadaCuanto: comoSeLeeElPrograma(p.schedule_type, p.interval_days),
    proxima: p.next_date,
    estado: p.status,
  }));
}
