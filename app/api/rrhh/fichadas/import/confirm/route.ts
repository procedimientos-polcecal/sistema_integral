import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puede_editar_check } from "@/lib/rrhh/route-utils";
import { leerStaging, borrarStaging } from "@/lib/rrhh/staging";
import { tokenizeMarcaciones, toDateOnlyFromCell, type ParsedSheet } from "@/lib/rrhh/excelImport";
import { localDateTime } from "@/lib/rrhh/dates";
import { aplicarDias, type DiasDeEmpleado, type LoteAAplicar, type ResultadoAplicar, type TurnoNuevo } from "@/lib/rrhh/fichadas/aplicar";
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

  // Cada modo entra por su vía (ver `LoteAAplicar`): el combinado trae marcas
  // crudas que hay que reconciliar, y el separado ya trae el emparejamiento
  // dicho por las dos columnas, así que no se reconcilia nada.
  let lote: LoteAAplicar;
  if (mapping.modo === "combinado") {
    // Los días de cada empleado, ordenados ascendente: es lo que pide la
    // reconciliación, y `armarTurnos` toma el primero como el arranque de su
    // lote. Un empleado va una sola vez en la lista aunque tenga muchas filas.
    const porEmpleado = new Map<string, FilaValida[]>();
    for (const f of filasValidas) {
      const filas = porEmpleado.get(f.employeeId);
      if (filas) filas.push(f);
      else porEmpleado.set(f.employeeId, [f]);
    }

    const empleados: DiasDeEmpleado[] = [];
    for (const [employeeId, filas] of porEmpleado) {
      filas.sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
      const legajo = filas[0].legajo;
      const dias = filas.map((f) => {
        const raw = String(f.row[mapping.marcaciones ?? ""] ?? "").trim();
        const tokens = tokenizeMarcaciones(raw);
        if (raw && tokens.length === 0) {
          errores.push(`Fila ${f.idx + 2} (legajo ${legajo}): no se pudieron interpretar las marcaciones "${raw}"`);
        }
        return { fecha: f.fecha, tokens };
      });
      empleados.push({ empleadoId: employeeId, legajo, dias });
    }
    lote = { tipo: "marcas", empleados };
  } else {
    // Una fila es un turno, tal como lo dice el archivo: una entrada sin salida
    // queda abierta y una salida a pocos minutos de la entrada se conserva.
    const turnos: TurnoNuevo[] = [];
    for (const f of filasValidas) {
      const horaEntrada = combineFechaHora(f.fecha, f.row[mapping.horaEntrada ?? ""]);
      if (!horaEntrada) {
        errores.push(`Fila ${f.idx + 2}: hora de entrada inválida`);
        continue;
      }
      const horaSalida = mapping.horaSalida ? combineFechaHora(f.fecha, f.row[mapping.horaSalida]) : null;
      turnos.push({ empleadoId: f.employeeId, legajo: f.legajo, fecha: f.fecha, horaEntrada, horaSalida });
    }
    lote = { tipo: "turnos", turnos };
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
    resultado = await aplicarDias(admin, lote, { batchId: batch.id, protegerCorregidos: false });
  } catch (e) {
    // `aplicarDias` avisa qué quedó a medias en el mensaje, y un día vacío que
    // nadie anota es un día vacío que nadie sabe que está vacío: se deja en el
    // lote antes de contestar. El staging no se borra, así se puede reintentar.
    const mensaje = e instanceof Error ? e.message : String(e);

    // Lo que ya quedó en la base se cuenta de la base y no se supone: si el
    // fallo vino después de insertar algo, el lote tiene que decirlo, porque
    // ese es el registro de qué hay con este `import_batch_id`.
    const { count, error: countErr } = await admin
      .from("fichadas")
      .select("*", { count: "exact", head: true })
      .eq("import_batch_id", batch.id);

    const { error: updateErr } = await admin
      .from("rrhh_import_batches")
      .update({
        ...(countErr ? {} : { cantidad_registros: count ?? 0 }),
        cantidad_errores: errores.length + 1,
        log_detalle: [
          ...errores,
          `La importación quedó a medias: ${mensaje}`,
          ...(countErr ? [`No se pudo contar las fichadas ya insertadas: ${countErr.message}`] : []),
        ].join("\n"),
      })
      .eq("id", batch.id);

    // Si ni siquiera se puede anotar, se le dice a quien importó: es la única
    // constancia que va a haber de lo que quedó a medias.
    return NextResponse.json(
      {
        error: updateErr ? `${mensaje} (además no se pudo anotar en el lote ${batch.id}: ${updateErr.message})` : mensaje,
        batchId: batch.id,
      },
      { status: 500 }
    );
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
