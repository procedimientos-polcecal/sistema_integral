import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puede_editar_check } from "@/lib/rrhh/route-utils";
import { leerStaging, borrarStaging } from "@/lib/rrhh/staging";
import {
  horaStringToDate, tokenizeMarcaciones, toDateOnlyFromCell, reconciliarMarcaciones, type ParsedSheet,
} from "@/lib/rrhh/excelImport";
import { localDateTime } from "@/lib/rrhh/dates";
import { recalcularEmpleadoPeriodo } from "@/lib/rrhh/engine/recalcular";
import { cuerpoJson } from "@/lib/core/cuerpo";

interface Mapping {
  legajo: string;
  fecha: string;
  modo: "separado" | "combinado";
  horaEntrada?: string;
  horaSalida?: string;
  marcaciones?: string;
}

function combineFechaHora(fecha: Date, value: unknown): Date | null {
  if (value instanceof Date) {
    return localDateTime(fecha, value.getUTCHours(), value.getUTCMinutes(), value.getUTCSeconds());
  }
  if (typeof value === "number") {
    const fractionalDay = value - Math.floor(value);
    const totalSeconds = Math.round(fractionalDay * 86400);
    return localDateTime(fecha, Math.floor(totalSeconds / 3600), Math.floor((totalSeconds % 3600) / 60), totalSeconds % 60);
  }
  if (typeof value === "string" && value.trim()) {
    const match = value.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (match) return localDateTime(fecha, Number(match[1]), Number(match[2]), match[3] ? Number(match[3]) : 0);
  }
  return null;
}

function fechaStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const check = await puede_editar_check(supabase);
  if (check) return check;
  const { data: { user } } = await supabase.auth.getUser();

  const { token, sheet, mapping } = (await cuerpoJson(request)) as { token: string; sheet: string; mapping: Mapping };
  if (!token || !sheet || !mapping?.legajo || !mapping?.fecha) {
    return NextResponse.json({ error: "Faltan datos de la importación" }, { status: 400 });
  }

  const entry = await leerStaging<{ nombreArchivo: string; sheetNames: string[]; sheets: Record<string, ParsedSheet> }>(supabase, token, "fichadas");
  if (!entry) return NextResponse.json({ error: "La vista previa expiró, volvé a subir el archivo" }, { status: 400 });
  const hoja = entry.sheets[sheet];
  if (!hoja) return NextResponse.json({ error: "Esa hoja no existe en el archivo" }, { status: 400 });

  const admin = createAdminClient();

  const { data: empleadosData } = await admin.from("empleados").select("id, legajo");
  const legajoToId = new Map((empleadosData ?? []).map((e) => [e.legajo.trim(), e.id]));

  const errores: string[] = [];
  const registrosPorEmpleado = new Map<string, { min: Date; max: Date }>();
  const created: { employeeId: string; fecha: Date; horaEntrada: Date; horaSalida: Date | null }[] = [];

  function marcarRango(employeeId: string, fecha: Date) {
    const rango = registrosPorEmpleado.get(employeeId);
    if (!rango) registrosPorEmpleado.set(employeeId, { min: fecha, max: fecha });
    else {
      if (fecha < rango.min) rango.min = fecha;
      if (fecha > rango.max) rango.max = fecha;
    }
  }

  interface FilaValida { idx: number; legajo: string; employeeId: string; fecha: Date; row: Record<string, unknown> }
  const filasValidas: FilaValida[] = [];

  hoja.rows.forEach((row, idx) => {
    const legajoRaw = String(row[mapping.legajo] ?? "").trim();
    if (!legajoRaw) return;
    const employeeId = legajoToId.get(legajoRaw);
    if (!employeeId) {
      errores.push(`Fila ${idx + 2}: legajo "${legajoRaw}" no encontrado`);
      return;
    }
    const fecha = toDateOnlyFromCell(row[mapping.fecha]);
    if (!fecha) {
      errores.push(`Fila ${idx + 2}: fecha inválida`);
      return;
    }
    filasValidas.push({ idx, legajo: legajoRaw, employeeId, fecha, row });
  });

  if (mapping.modo === "combinado") {
    const porEmpleado = new Map<string, FilaValida[]>();
    for (const f of filasValidas) {
      if (!porEmpleado.has(f.employeeId)) porEmpleado.set(f.employeeId, []);
      porEmpleado.get(f.employeeId)!.push(f);
    }

    for (const [employeeId, filas] of porEmpleado) {
      filas.sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
      const legajo = filas[0].legajo;

      for (const f of filas) {
        const raw = String(f.row[mapping.marcaciones ?? ""] ?? "").trim();
        if (raw && tokenizeMarcaciones(raw).length === 0) {
          errores.push(`Fila ${f.idx + 2} (legajo ${legajo}): no se pudieron interpretar las marcaciones "${raw}"`);
        }
      }

      // Si de una importación anterior quedó un turno sin marcación de
      // salida, se encadena acá para que el primer dato de este archivo
      // pueda cerrarlo en vez de quedar abierto para siempre.
      const { data: abierto } = await admin
        .from("fichadas")
        .select("id, fecha, hora_entrada")
        .eq("empleado_id", employeeId)
        .is("hora_salida", null)
        .lt("fecha", fechaStr(filas[0].fecha))
        .order("fecha", { ascending: false })
        .limit(1)
        .maybeSingle();
      const abiertoFecha = abierto ? new Date(abierto.fecha as string) : null;
      const abiertoPrevio = abierto
        ? { fecha: abiertoFecha!, entradaStr: new Date(abierto.hora_entrada as string).toLocaleTimeString("en-GB", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit" }) }
        : null;

      const dias = filas.map((f) => ({ fecha: f.fecha, raw: String(f.row[mapping.marcaciones ?? ""] ?? "").trim() }));
      const { turnos, avisos } = reconciliarMarcaciones(dias, abiertoPrevio);

      for (const turno of turnos) {
        if (abierto && abiertoFecha && turno.fecha.getTime() === abiertoFecha.getTime()) {
          if (turno.salidaStr) {
            await admin.from("fichadas").update({ hora_salida: horaStringToDate(turno.fechaSalida, turno.salidaStr).toISOString() }).eq("id", abierto.id);
            marcarRango(employeeId, turno.fecha);
            marcarRango(employeeId, turno.fechaSalida);
          }
          continue;
        }
        created.push({
          employeeId,
          fecha: turno.fecha,
          horaEntrada: horaStringToDate(turno.fecha, turno.entradaStr),
          horaSalida: turno.salidaStr ? horaStringToDate(turno.fechaSalida, turno.salidaStr) : null,
        });
        marcarRango(employeeId, turno.fecha);
        if (turno.fechaSalida.getTime() !== turno.fecha.getTime()) marcarRango(employeeId, turno.fechaSalida);
      }
      for (const aviso of avisos) {
        errores.push(`Legajo ${legajo}, ${fechaStr(aviso.fecha)}: ${aviso.mensaje}`);
      }
    }
  } else {
    for (const f of filasValidas) {
      const horaEntrada = combineFechaHora(f.fecha, f.row[mapping.horaEntrada ?? ""]);
      if (!horaEntrada) {
        errores.push(`Fila ${f.idx + 2}: hora de entrada inválida`);
        continue;
      }
      const horaSalida = mapping.horaSalida ? combineFechaHora(f.fecha, f.row[mapping.horaSalida]) : null;
      created.push({ employeeId: f.employeeId, fecha: f.fecha, horaEntrada, horaSalida });
      marcarRango(f.employeeId, f.fecha);
    }
  }

  // Descarta filas repetidas dentro del propio archivo.
  const firma = (r: { employeeId: string; fecha: Date; horaEntrada: Date; horaSalida: Date | null }) =>
    `${r.employeeId}|${r.fecha.getTime()}|${r.horaEntrada.getTime()}|${r.horaSalida?.getTime() ?? "null"}`;
  const firmasVistas = new Set<string>();
  const sinRepetirEnArchivo = created.filter((c) => {
    const f = firma(c);
    if (firmasVistas.has(f)) return false;
    firmasVistas.add(f);
    return true;
  });

  // Reemplaza las fichadas IMPORTADAS previas de los mismos (empleado, día)
  // que trae este archivo — las MANUAL nunca se tocan.
  const diasPorEmpleado = new Map<string, Set<string>>();
  for (const c of sinRepetirEnArchivo) {
    if (!diasPorEmpleado.has(c.employeeId)) diasPorEmpleado.set(c.employeeId, new Set());
    diasPorEmpleado.get(c.employeeId)!.add(fechaStr(c.fecha));
  }
  let reemplazados = 0;
  for (const [employeeId, fechasSet] of diasPorEmpleado) {
    const { data: borrados } = await admin
      .from("fichadas")
      .delete()
      .eq("empleado_id", employeeId)
      .eq("origen", "IMPORTADO")
      .in("fecha", [...fechasSet])
      .select("id");
    reemplazados += borrados?.length ?? 0;
  }
  const insertados = sinRepetirEnArchivo.length;

  const { data: batch, error: batchErr } = await admin
    .from("rrhh_import_batches")
    .insert({
      nombre_archivo: entry.nombreArchivo,
      usuario_id: user!.id,
      cantidad_registros: insertados,
      cantidad_errores: errores.length,
      log_detalle: errores.length ? errores.join("\n") : null,
    })
    .select("id")
    .single();
  if (batchErr) return NextResponse.json({ error: batchErr.message }, { status: 500 });

  if (sinRepetirEnArchivo.length > 0) {
    const rows = sinRepetirEnArchivo.map((c) => ({
      empleado_id: c.employeeId,
      fecha: fechaStr(c.fecha),
      hora_entrada: c.horaEntrada.toISOString(),
      hora_salida: c.horaSalida ? c.horaSalida.toISOString() : null,
      origen: "IMPORTADO",
      import_batch_id: batch.id,
    }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await admin.from("fichadas").insert(rows.slice(i, i + 500));
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  for (const [employeeId, rango] of registrosPorEmpleado) {
    await recalcularEmpleadoPeriodo(supabase, employeeId, rango.min, rango.max);
  }

  await borrarStaging(supabase, token);
  return NextResponse.json({ batchId: batch.id, insertados, reemplazados, errores });
}
