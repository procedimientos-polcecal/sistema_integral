import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { traerTodo } from "@/lib/core/paginado";
import { normalizar, texto } from "@/lib/mantenimiento/planilla";
import { filaDeTipo, filaDeComponente, type FilaDelLibro } from "@/lib/mantenimiento/ficha";
import {
  filaDeSector, filaDeEquipo, estadoDelLibro, esPlantaCompartida,
} from "@/lib/mantenimiento/inventario";
import { detectarFormato, buscarHoja, porQueNoSePuede } from "@/lib/mantenimiento/importacion";
import * as XLSX from "xlsx";

export const maxDuration = 300;

/**
 * Importar equipos, del archivo que sea.
 *
 * Circulan dos y no se parecen en nada: el **libro BD Equipos** —una hoja por
 * tabla, columnas en snake_case, y además sectores, tipos y componentes— y una
 * **planilla plana**, una fila por equipo con encabezados en castellano.
 *
 * Se reconoce cuál es y se importa el que venga. Pedirle a alguien que convierta
 * el suyo al otro formato es pedirle que haga a mano lo que la máquina puede
 * hacer sola.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json(
      { error: "Importar equipos requiere nivel de edición en Mantenimiento" },
      { status: 403 }
    );
  }

  const formulario = await request.formData();
  const archivo = formulario.get("file") as File | null;
  if (!archivo) return NextResponse.json({ error: "Falta el archivo" }, { status: 400 });

  const libro = XLSX.read(Buffer.from(await archivo.arrayBuffer()), { type: "buffer" });
  const hojas = libro.SheetNames;

  const leer = (nombre: string): FilaDelLibro[] => {
    const real = buscarHoja(hojas, nombre);
    return real ? XLSX.utils.sheet_to_json<FilaDelLibro>(libro.Sheets[real], { defval: "" }) : [];
  };

  // Las columnas de equipos, que son las que dicen de qué formato es. En una
  // planilla plana la hoja puede no llamarse "EQUIPOS": ahí vale la primera.
  const deEquipos = buscarHoja(hojas, "EQUIPOS")
    ? leer("EQUIPOS")
    : XLSX.utils.sheet_to_json<FilaDelLibro>(libro.Sheets[hojas[0]], { defval: "" });
  const columnas = Object.keys(deEquipos[0] ?? {});

  const formato = detectarFormato(hojas, columnas);
  if (formato === "desconocido") {
    return NextResponse.json({ error: porQueNoSePuede(hojas, columnas) }, { status: 400 });
  }

  const admin = createAdminClient();

  return formato === "libro"
    ? importarLibro(admin, leer, deEquipos, hojas)
    : importarPlanilla(admin, deEquipos);
}

type Admin = ReturnType<typeof createAdminClient>;

/**
 * El libro BD Equipos: el padrón entero.
 *
 * Trae los sectores de planta, los equipos, el catálogo de tipos y los
 * componentes de cada máquina. Se puede volver a importar: todo se reconoce por
 * su código y una celda vacía no borra lo que ya está cargado.
 */
async function importarLibro(
  admin: Admin,
  leer: (nombre: string) => FilaDelLibro[],
  deEquipos: FilaDelLibro[],
  hojas: string[]
) {
  const resultado = {
    formato: "libro" as const,
    sectores: 0,
    equipos_nuevos: 0,
    equipos_actualizados: 0,
    tipos: 0,
    componentes: 0,
    sin_sector: [] as string[],
    sin_tipo: [] as string[],
    hojas,
  };

  // ── Los tipos, primero: los equipos tienen una clave foránea al catálogo
  // y uno que no esté hace fallar el insert de todo el lote.
  const tipos = leer("TIPO_EQUIPO").map(filaDeTipo).filter((t) => t !== null);
  const tiposConocidos = new Set(tipos.map((t) => t.tipo_id));

  for (let i = 0; i < tipos.length; i += 200) {
    const lote = tipos.slice(i, i + 200);
    const { error } = await admin.from("equipos_tipos").upsert(lote, { onConflict: "tipo_id" });
    if (error) return NextResponse.json({ error: `Tipos: ${error.message}` }, { status: 400 });
    resultado.tipos += lote.length;
  }

  // ── Los sectores de planta ───────────────────────────────────────
  const { data: empresas } = await admin.from("empresas").select("id, nombre");
  const empresaPorNombre = new Map(
    (empresas ?? []).map((e) => [normalizar(e.nombre), e.id as string])
  );

  // Se buscan los que ya están por código en vez de hacer `upsert`: así no
  // depende de que exista un índice único, que es justo lo que hacía fallar la
  // importación entera en el primer sector.
  const sectoresEnBase = await traerTodo<{ id: string; codigo: string | null }>((desde, hasta) =>
    admin.from("sectores").select("id, codigo").range(desde, hasta)
  );
  const sectorPorCodigo = new Map(
    sectoresEnBase.filter((s) => s.codigo).map((s) => [s.codigo!.toUpperCase(), s.id])
  );

  for (const sector of leer("SECTORES").map(filaDeSector)) {
    if (!sector) continue;

    const empresa_id = empresaPorNombre.get(normalizar(sector.planta)) ?? null;
    const compartido = esPlantaCompartida(sector.planta) || !sector.planta;

    // Una planta que el libro nombra y el SdG no conoce es un error de datos,
    // no un sector transversal: marcarlo compartido lo escondería.
    if (!empresa_id && !compartido) {
      return NextResponse.json(
        { error: `Sector ${sector.codigo}: no existe la empresa "${sector.planta}"` },
        { status: 400 }
      );
    }

    const fila = {
      codigo: sector.codigo,
      nombre: sector.nombre,
      empresa_id,
      // El libro llama "AMBOS" a lo que el SdG llama transversal. La base exige
      // una cosa o la otra, nunca las dos ni ninguna.
      transversal: empresa_id === null,
      es_de_planta: true,
    };

    const yaEsta = sectorPorCodigo.get(sector.codigo.toUpperCase());
    const { data, error } = yaEsta
      ? await admin.from("sectores").update(fila).eq("id", yaEsta).select("id").single()
      : await admin.from("sectores").insert(fila).select("id").single();

    if (error) {
      return NextResponse.json({ error: `Sector ${sector.codigo}: ${error.message}` }, { status: 400 });
    }
    sectorPorCodigo.set(sector.codigo.toUpperCase(), data.id);
    resultado.sectores += 1;
  }

  // ── Los equipos ──────────────────────────────────────────────────
  const existentes = await traerTodo<{ id: string; code: string | null }>((desde, hasta) =>
    admin.from("equipos").select("id, code").range(desde, hasta)
  );
  const equipoPorCodigo = new Map(
    existentes.filter((e) => e.code).map((e) => [e.code!.trim().toUpperCase(), e.id])
  );

  // Los tipos que ya estaban de una importación anterior también valen.
  if (tiposConocidos.size > 0) {
    const enBase = await traerTodo<{ tipo_id: string }>((desde, hasta) =>
      admin.from("equipos_tipos").select("tipo_id").range(desde, hasta)
    );
    for (const t of enBase) tiposConocidos.add(t.tipo_id);
  }

  const sinSector = new Set<string>();
  const sinTipo = new Set<string>();
  const nuevos: Record<string, unknown>[] = [];

  for (const fila of deEquipos) {
    const equipo = filaDeEquipo(fila);
    if (!equipo) continue;

    // Un tipo que el catálogo no tiene se deja en blanco en vez de reventar el
    // insert entero: el equipo vale igual sin él.
    const tipo = equipo.campos.tipo_id;
    if (typeof tipo === "string" && !tiposConocidos.has(tipo)) {
      delete equipo.campos.tipo_id;
      sinTipo.add(`${equipo.code} (${tipo})`);
    }

    const sector_id = sectorPorCodigo.get(equipo.sector.toUpperCase());
    const yaEsta = equipoPorCodigo.get(equipo.code.toUpperCase());

    if (yaEsta) {
      const campos: Record<string, unknown> = { ...equipo.campos };
      if (sector_id) campos.sector_id = sector_id;

      const { error } = await admin.from("equipos").update(campos).eq("id", yaEsta);
      if (error) {
        return NextResponse.json({ error: `Equipo ${equipo.code}: ${error.message}` }, { status: 400 });
      }
      resultado.equipos_actualizados += 1;
      continue;
    }

    // Sin sector no se puede crear: la columna es obligatoria, y colgarlo de
    // cualquiera lo pondría en una planta donde no está.
    if (!sector_id) { sinSector.add(equipo.code); continue; }

    nuevos.push({ ...equipo.campos, code: equipo.code, sector_id, is_active: true });
  }

  // De a lotes: doscientos treinta y nueve inserts de a uno tardan una
  // eternidad y cualquier corte deja la importación por la mitad.
  for (let i = 0; i < nuevos.length; i += 200) {
    const lote = nuevos.slice(i, i + 200);
    const { data, error } = await admin.from("equipos").insert(lote).select("id, code");
    if (error) return NextResponse.json({ error: `Equipos: ${error.message}` }, { status: 400 });

    for (const e of data ?? []) {
      if (e.code) equipoPorCodigo.set(e.code.trim().toUpperCase(), e.id);
    }
    resultado.equipos_nuevos += lote.length;
  }

  resultado.sin_sector = [...sinSector];
  resultado.sin_tipo = [...sinTipo];

  // ── Los componentes ──────────────────────────────────────────────
  const componentes: Record<string, unknown>[] = [];
  for (const fila of leer("COMPONENTES")) {
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

const VALID_CRITICALITY = ["ALTA", "MEDIA", "BAJA"];

/** Un valor de la fila, se llame como se llame la columna. */
function columna(fila: FilaDelLibro, ...nombres: string[]): unknown {
  const buscados = nombres.map((n) => normalizar(n));
  for (const [clave, valor] of Object.entries(fila)) {
    if (buscados.includes(normalizar(clave))) return valor;
  }
  return undefined;
}

/**
 * Una planilla plana: una fila por equipo.
 *
 * El sector se busca por nombre —no tiene código— dentro de su empresa, que es
 * como se lo escribe a mano.
 */
async function importarPlanilla(admin: Admin, filas: FilaDelLibro[]) {
  const resultado = {
    formato: "planilla" as const,
    equipos_nuevos: 0,
    equipos_actualizados: 0,
    errores: [] as string[],
  };

  const { data: sectores } = await admin
    .from("sectores")
    .select("id, nombre, empresas(nombre)");

  // Por "empresa|sector" y también por el sector solo: quien completa la
  // planilla no siempre pone la empresa, y con un solo sector con ese nombre no
  // hace falta.
  const porEmpresaYSector = new Map<string, string>();
  const porNombre = new Map<string, string[]>();

  for (const s of sectores ?? []) {
    const embed = Array.isArray(s.empresas) ? s.empresas[0] : s.empresas;
    const empresa = normalizar((embed as { nombre?: string } | null)?.nombre ?? "");
    const nombre = normalizar(s.nombre);

    porEmpresaYSector.set(`${empresa}|${nombre}`, s.id as string);
    porNombre.set(nombre, [...(porNombre.get(nombre) ?? []), s.id as string]);
  }

  const existentes = await traerTodo<{ id: string; code: string | null }>((desde, hasta) =>
    admin.from("equipos").select("id, code").range(desde, hasta)
  );
  const equipoPorCodigo = new Map(
    existentes.filter((e) => e.code).map((e) => [e.code!.trim().toUpperCase(), e.id])
  );

  const nuevos: Record<string, unknown>[] = [];

  for (let i = 0; i < filas.length; i++) {
    const fila = filas[i];
    const enLaFila = `Fila ${i + 2}`;

    const code = texto(columna(fila, "Código", "codigo", "code", "equipo_id"));
    const name = texto(columna(fila, "Nombre", "name", "nombre_equipo"));
    if (!code || !name) {
      resultado.errores.push(`${enLaFila}: hacen falta el código y el nombre`);
      continue;
    }

    const criticidad = String(
      texto(columna(fila, "Criticidad", "criticality")) ?? "MEDIA"
    ).toUpperCase();
    if (!VALID_CRITICALITY.includes(criticidad)) {
      resultado.errores.push(`${enLaFila} (${code}): criticidad desconocida "${criticidad}"`);
      continue;
    }

    const empresa = normalizar(columna(fila, "Empresa", "Planta", "planta_id"));
    const sector = normalizar(columna(fila, "Sector", "sector_id"));
    const candidatos = porNombre.get(sector) ?? [];
    const sector_id =
      porEmpresaYSector.get(`${empresa}|${sector}`) ??
      // Sin empresa vale si el nombre no se repite: elegir uno al azar entre
      // dos plantas pondría la máquina en la que no es.
      (candidatos.length === 1 ? candidatos[0] : undefined);

    const yaEsta = equipoPorCodigo.get(code.toUpperCase());

    if (!sector_id && !yaEsta) {
      resultado.errores.push(
        candidatos.length > 1
          ? `${enLaFila} (${code}): hay más de un sector "${sector}" y la fila no dice de qué empresa`
          : `${enLaFila} (${code}): no existe el sector "${sector}"`
      );
      continue;
    }

    const campos: Record<string, unknown> = {
      name,
      status: estadoDelLibro(columna(fila, "Estado", "status")),
      criticality: criticidad,
      description: texto(columna(fila, "Descripción", "Descripcion", "description")),
      notes: texto(columna(fila, "Notas", "notes", "observaciones")),
    };
    const potencia = columna(fila, "kW", "Potencia_kW", "power_kw", "potencia_kw");
    if (potencia !== undefined && potencia !== "") campos.power_kw = Number(potencia) || null;
    if (sector_id) campos.sector_id = sector_id;

    if (yaEsta) {
      const { error } = await admin.from("equipos").update(campos).eq("id", yaEsta);
      if (error) resultado.errores.push(`${enLaFila} (${code}): ${error.message}`);
      else resultado.equipos_actualizados += 1;
    } else {
      nuevos.push({ ...campos, code, is_active: true });
    }
  }

  for (let i = 0; i < nuevos.length; i += 200) {
    const lote = nuevos.slice(i, i + 200);
    const { error } = await admin.from("equipos").insert(lote);
    if (error) return NextResponse.json({ error: `Equipos: ${error.message}` }, { status: 400 });
    resultado.equipos_nuevos += lote.length;
  }

  return NextResponse.json(resultado);
}
