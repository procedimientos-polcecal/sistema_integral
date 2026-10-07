import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puede_editar_check } from "@/lib/rrhh/route-utils";
import { leerStaging, borrarStaging } from "@/lib/rrhh/staging";
import { tokenizeMarcaciones, toDateOnlyFromCell, type ParsedSheet, type TokenMarcacion } from "@/lib/rrhh/excelImport";
import { localDateTime, formatHHMM } from "@/lib/rrhh/dates";
import { aplicarDias, type DiasDeEmpleado, type ResultadoAplicar } from "@/lib/rrhh/fichadas/aplicar";
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

  // Los días de cada empleado, ordenados ascendente: es lo que pide la capa de
  // alta, y `armarTurnos` toma el primero como el arranque de su lote. Un
  // empleado va una sola vez en la lista aunque tenga muchas filas.
  const porEmpleado = new Map<string, FilaValida[]>();
  for (const f of filasValidas) {
    const filas = porEmpleado.get(f.employeeId);
    if (filas) filas.push(f);
    else porEmpleado.set(f.employeeId, [f]);
  }

  const empleados: DiasDeEmpleado[] = [];
  for (const [employeeId, filas] of porEmpleado) {
    // El sort de JS es estable: dos filas del mismo día conservan el orden del archivo.
    filas.sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
    const legajo = filas[0].legajo;
    const dias: DiasDeEmpleado["dias"] = [];

    for (const f of filas) {
      if (mapping.modo === "combinado") {
        const raw = String(f.row[mapping.marcaciones ?? ""] ?? "").trim();
        const tokens = tokenizeMarcaciones(raw);
        if (raw && tokens.length === 0) {
          errores.push(`Fila ${f.idx + 2} (legajo ${legajo}): no se pudieron interpretar las marcaciones "${raw}"`);
        }
        dias.push({ fecha: f.fecha, tokens });
      } else {
        // Modo "separado": la entrada y la salida ya vienen emparejadas en dos
        // columnas, así que cada fila es un día con un par de marcas. Una fila
        // por día y no una sola con todas, para que dos filas del mismo día
        // sigan siendo dos turnos independientes.
        const horaEntrada = combineFechaHora(f.fecha, f.row[mapping.horaEntrada ?? ""]);
        if (!horaEntrada) {
          errores.push(`Fila ${f.idx + 2}: hora de entrada inválida`);
          continue;
        }
        const horaSalida = mapping.horaSalida ? combineFechaHora(f.fecha, f.row[mapping.horaSalida]) : null;
        const tokens: TokenMarcacion[] = [{ tipo: "E", hora: formatHHMM(horaEntrada) }];
        if (horaSalida) tokens.push({ tipo: "S", hora: formatHHMM(horaSalida) });
        dias.push({ fecha: f.fecha, tokens });
      }
    }
    empleados.push({ empleadoId: employeeId, legajo, dias });
  }

  // El lote se crea antes de aplicar porque las fichadas llevan su id; los
  // conteos y el detalle se completan después.
  const { data: batch, error: batchErr } = await admin
    .from("rrhh_import_batches")
    .insert({ nombre_archivo: entry.nombreArchivo, usuario_id: user!.id })
    .select("id")
    .single();
  if (batchErr) return NextResponse.json({ error: batchErr.message }, { status: 500 });

  // `protegerCorregidos: false` es deliberado: quien sube un archivo a mano
  // está eligiendo pisar un período, igual que siempre. La liquidación cerrada
  // se respeta igual; eso lo decide `aplicarDias`.
  let resultado: ResultadoAplicar;
  try {
    resultado = await aplicarDias(admin, empleados, { batchId: batch.id, protegerCorregidos: false });
  } catch (e) {
    // `aplicarDias` avisa qué quedó a medias en el mensaje, y un día vacío que
    // nadie anota es un día vacío que nadie sabe que está vacío: se deja en el
    // lote antes de contestar. El staging no se borra, así se puede reintentar.
    const mensaje = e instanceof Error ? e.message : String(e);
    await admin
      .from("rrhh_import_batches")
      .update({
        cantidad_errores: errores.length + 1,
        log_detalle: [...errores, `La importación quedó a medias: ${mensaje}`].join("\n"),
      })
      .eq("id", batch.id);
    return NextResponse.json({ error: mensaje, batchId: batch.id }, { status: 500 });
  }

  errores.push(...resultado.avisos);

  // Los pendientes (fichadas abiertas de antes que alguien tiene que cerrar a
  // mano) van al detalle pero no al conteo: no son un fallo de esta
  // importación, y si contaran, todas arrancarían con decenas de "errores".
  const detalle = [...errores, ...resultado.pendientes];
  const { error: updateErr } = await admin
    .from("rrhh_import_batches")
    .update({
      cantidad_registros: resultado.insertados,
      cantidad_errores: errores.length,
      log_detalle: detalle.length ? detalle.join("\n") : null,
    })
    .eq("id", batch.id);
  if (updateErr) {
    return NextResponse.json(
      { error: `Las fichadas se importaron, pero no se pudo completar el registro del lote: ${updateErr.message}`, batchId: batch.id },
      { status: 500 }
    );
  }

  await borrarStaging(supabase, token);
  return NextResponse.json({
    batchId: batch.id,
    insertados: resultado.insertados,
    reemplazados: resultado.reemplazados,
    errores,
    pendientes: resultado.pendientes,
  });
}
