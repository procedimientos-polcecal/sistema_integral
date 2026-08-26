import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { traerTodo } from "@/lib/core/paginado";
import { filaDeTipo, filaDeFicha, filaDeComponente, type FilaDelLibro } from "@/lib/mantenimiento/ficha";
import * as XLSX from "xlsx";

export const maxDuration = 300;

/**
 * Importa el libro "BD Equipos": tipos, fichas técnicas y componentes.
 *
 * No crea equipos: los enlaza por código con los que ya están cargados. Un
 * código que no existe se informa en vez de inventar una máquina.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json(
      { error: "Importar la ficha técnica requiere nivel de edición en Mantenimiento" },
      { status: 403 }
    );
  }

  const formulario = await request.formData();
  const archivo = formulario.get("file") as File | null;
  if (!archivo) return NextResponse.json({ error: "Falta el archivo" }, { status: 400 });

  const libro = XLSX.read(Buffer.from(await archivo.arrayBuffer()), { type: "buffer" });

  /** Una hoja del libro, buscada sin importar mayúsculas ni acentos. */
  const hoja = (nombre: string): FilaDelLibro[] => {
    const real = libro.SheetNames.find(
      (n) => n.trim().toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "") === nombre
    );
    return real ? XLSX.utils.sheet_to_json<FilaDelLibro>(libro.Sheets[real], { defval: "" }) : [];
  };

  const admin = createAdminClient();
  const resultado = {
    tipos: 0,
    equipos: 0,
    componentes: 0,
    sin_equipo: [] as string[],
    hojas: libro.SheetNames,
  };

  // ── Los tipos, que las fichas después referencian ────────────────
  const tipos = hoja("TIPO_EQUIPO").map(filaDeTipo).filter((t) => t !== null);
  const nombreDelTipo = new Map(tipos.map((t) => [t.tipo_id, t.nombre_tipo]));

  for (let i = 0; i < tipos.length; i += 200) {
    const lote = tipos.slice(i, i + 200);
    const { error } = await admin.from("equipos_tipos").upsert(lote, { onConflict: "tipo_id" });
    if (error) return NextResponse.json({ error: `Tipos: ${error.message}` }, { status: 400 });
    resultado.tipos += lote.length;
  }

  // ── Los equipos que ya existen, por código ───────────────────────
  const equipos = await traerTodo<{ id: string; code: string | null }>((desde, hasta) =>
    admin.from("equipos").select("id, code").range(desde, hasta)
  );
  const porCodigo = new Map(
    equipos.filter((e) => e.code).map((e) => [e.code!.trim().toUpperCase(), e.id])
  );
  const idDe = (code: string) => porCodigo.get(code.trim().toUpperCase());

  // ── Las fichas técnicas ──────────────────────────────────────────
  const noEncontrados = new Set<string>();

  for (const fila of hoja("EQUIPOS")) {
    const ficha = filaDeFicha(fila);
    if (!ficha) continue;

    const id = idDe(ficha.code);
    if (!id) { noEncontrados.add(ficha.code); continue; }

    const campos: Record<string, unknown> = { ...ficha.campos };
    if (ficha.tipo_id) {
      campos.tipo_id = ficha.tipo_id;
      // El nombre se copia para poder mostrarlo sin ir a buscar el tipo.
      const nombre = nombreDelTipo.get(ficha.tipo_id);
      if (nombre) campos.tipo_equipo = nombre;
    }

    // Una fila que sólo trae el código no tiene nada para actualizar.
    if (Object.keys(campos).length === 0) continue;

    const { error } = await admin.from("equipos").update(campos).eq("id", id);
    if (error) {
      return NextResponse.json(
        { error: `Equipo ${ficha.code}: ${error.message}` },
        { status: 400 }
      );
    }
    resultado.equipos += 1;
  }

  // ── Los componentes ──────────────────────────────────────────────
  const componentes: Record<string, unknown>[] = [];
  for (const fila of hoja("COMPONENTES")) {
    const leido = filaDeComponente(fila);
    if (!leido) continue;

    const id = idDe(leido.code);
    if (!id) { noEncontrados.add(leido.code); continue; }

    componentes.push({ equipment_id: id, ...leido.componente });
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

  resultado.sin_equipo = [...noEncontrados];
  return NextResponse.json(resultado);
}
