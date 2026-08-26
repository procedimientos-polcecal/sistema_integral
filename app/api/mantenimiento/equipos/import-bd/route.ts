import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { traerTodo } from "@/lib/core/paginado";
import { normalizar } from "@/lib/mantenimiento/planilla";
import { filaDeTipo, filaDeComponente, type FilaDelLibro } from "@/lib/mantenimiento/ficha";
import { filaDeSector, filaDeEquipo } from "@/lib/mantenimiento/inventario";
import * as XLSX from "xlsx";

export const maxDuration = 300;

/**
 * Importa el libro "BD Equipos": sectores, equipos, tipos y componentes.
 *
 * Es el padrón de la planta. Se puede volver a importar cuantas veces haga
 * falta: los sectores y los equipos se reconocen por su código, y una celda
 * vacía no borra lo que ya está cargado —el libro se completa a medida que
 * alguien recorre la planta—.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json(
      { error: "Importar el padrón de equipos requiere nivel de edición en Mantenimiento" },
      { status: 403 }
    );
  }

  const formulario = await request.formData();
  const archivo = formulario.get("file") as File | null;
  if (!archivo) return NextResponse.json({ error: "Falta el archivo" }, { status: 400 });

  const libro = XLSX.read(Buffer.from(await archivo.arrayBuffer()), { type: "buffer" });

  /** Una hoja del libro, buscada sin importar mayúsculas ni acentos. */
  const hoja = (nombre: string): FilaDelLibro[] => {
    const real = libro.SheetNames.find((n) => normalizar(n).toUpperCase() === nombre);
    return real ? XLSX.utils.sheet_to_json<FilaDelLibro>(libro.Sheets[real], { defval: "" }) : [];
  };

  const admin = createAdminClient();
  const resultado = {
    sectores: 0,
    equipos_nuevos: 0,
    equipos_actualizados: 0,
    tipos: 0,
    componentes: 0,
    sin_sector: [] as string[],
    hojas: libro.SheetNames,
  };

  // ── Los tipos, que los equipos referencian ───────────────────────
  const tipos = hoja("TIPO_EQUIPO").map(filaDeTipo).filter((t) => t !== null);
  for (let i = 0; i < tipos.length; i += 200) {
    const lote = tipos.slice(i, i + 200);
    const { error } = await admin.from("equipos_tipos").upsert(lote, { onConflict: "tipo_id" });
    if (error) return NextResponse.json({ error: `Tipos: ${error.message}` }, { status: 400 });
    resultado.tipos += lote.length;
  }

  // ── Los sectores de planta ───────────────────────────────────────
  // Se distinguen de los organizativos que usa RRHH: son dónde está una
  // máquina, no dónde trabaja una persona.
  const { data: empresas } = await admin.from("empresas").select("id, nombre");
  const empresaPorNombre = new Map(
    (empresas ?? []).map((e) => [normalizar(e.nombre), e.id as string])
  );

  const sectoresDelLibro = hoja("SECTORES").map(filaDeSector).filter((s) => s !== null);
  for (const sector of sectoresDelLibro) {
    const { error } = await admin.from("sectores").upsert(
      {
        codigo: sector.codigo,
        nombre: sector.nombre,
        // "AMBOS" no es una empresa: es donde van los equipos que sirven a las
        // dos, y esos sectores quedan sin empresa.
        empresa_id: empresaPorNombre.get(normalizar(sector.planta)) ?? null,
        es_de_planta: true,
      },
      { onConflict: "codigo" }
    );
    if (error) {
      return NextResponse.json(
        { error: `Sector ${sector.codigo}: ${error.message}` },
        { status: 400 }
      );
    }
    resultado.sectores += 1;
  }

  // ── Los equipos ──────────────────────────────────────────────────
  const sectores = await traerTodo<{ id: string; codigo: string | null }>((desde, hasta) =>
    admin.from("sectores").select("id, codigo").not("codigo", "is", null).range(desde, hasta)
  );
  const sectorPorCodigo = new Map(
    sectores.filter((s) => s.codigo).map((s) => [s.codigo!.toUpperCase(), s.id])
  );

  const existentes = await traerTodo<{ id: string; code: string | null }>((desde, hasta) =>
    admin.from("equipos").select("id, code").range(desde, hasta)
  );
  const equipoPorCodigo = new Map(
    existentes.filter((e) => e.code).map((e) => [e.code!.trim().toUpperCase(), e.id])
  );

  const sinSector = new Set<string>();

  for (const fila of hoja("EQUIPOS")) {
    const equipo = filaDeEquipo(fila);
    if (!equipo) continue;

    const sector_id = sectorPorCodigo.get(equipo.sector.toUpperCase());
    const yaEsta = equipoPorCodigo.get(equipo.code.toUpperCase());

    if (!sector_id && !yaEsta) {
      // Sin sector no se puede crear: la columna es obligatoria, y colgarlo de
      // cualquier sector lo pondría en una planta donde no está.
      sinSector.add(equipo.code);
      continue;
    }

    if (yaEsta) {
      const campos: Record<string, unknown> = { ...equipo.campos };
      if (sector_id) campos.sector_id = sector_id;

      const { error } = await admin.from("equipos").update(campos).eq("id", yaEsta);
      if (error) {
        return NextResponse.json({ error: `Equipo ${equipo.code}: ${error.message}` }, { status: 400 });
      }
      resultado.equipos_actualizados += 1;
    } else {
      const { data, error } = await admin
        .from("equipos")
        .insert({ ...equipo.campos, code: equipo.code, sector_id, is_active: true })
        .select("id")
        .single();
      if (error) {
        return NextResponse.json({ error: `Equipo ${equipo.code}: ${error.message}` }, { status: 400 });
      }
      equipoPorCodigo.set(equipo.code.toUpperCase(), data.id);
      resultado.equipos_nuevos += 1;
    }
  }

  resultado.sin_sector = [...sinSector];

  // ── Los componentes ──────────────────────────────────────────────
  const componentes: Record<string, unknown>[] = [];
  for (const fila of hoja("COMPONENTES")) {
    const leido = filaDeComponente(fila);
    if (!leido) continue;

    const equipment_id = equipoPorCodigo.get(leido.code.trim().toUpperCase());
    if (!equipment_id) continue;

    componentes.push({ equipment_id, ...leido.componente });
  }

  // Los que traen identificador se pueden volver a importar sin duplicarse;
  // los que no, se insertan y ya —no hay con qué reconocerlos—.
  const conId = componentes.filter((c) => c.componente_id);
  const sinId = componentes.filter((c) => !c.componente_id);

  for (let i = 0; i < conId.length; i += 300) {
    const lote = conId.slice(i, i + 300);
    const { error } = await admin
      .from("equipos_componentes")
      .upsert(lote, { onConflict: "componente_id" });
    if (error) return NextResponse.json({ error: `Componentes: ${error.message}` }, { status: 400 });
    resultado.componentes += lote.length;
  }

  for (let i = 0; i < sinId.length; i += 300) {
    const lote = sinId.slice(i, i + 300);
    const { error } = await admin.from("equipos_componentes").insert(lote);
    if (error) return NextResponse.json({ error: `Componentes: ${error.message}` }, { status: 400 });
    resultado.componentes += lote.length;
  }

  return NextResponse.json(resultado);
}
