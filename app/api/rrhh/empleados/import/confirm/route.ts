import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { esAdminRrhh } from "@/lib/rrhh/auth";
import { leerStaging, borrarStaging } from "@/lib/rrhh/staging";
import { parseNumeroAR, toDateOnlyFromCell, type ParsedSheet } from "@/lib/rrhh/excelImport";
import { utcDateOnlyFrom } from "@/lib/rrhh/dates";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { indiceDeSectores, sectorQueNombra } from "@/lib/core/sectores";

interface Mapping {
  legajo: string;
  nombre: string;
  apellido: string;
  valorHoraNormal: string;
  fechaIngreso?: string;
  sindicato?: string;
  empresa?: string;
  sector?: string;
  horasTeoricasDiarias?: string;
  fechaNacimiento?: string;
  genero?: string;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await esAdminRrhh(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { token, sheet, mapping } = (await cuerpoJson(request)) as { token: string; sheet: string; mapping: Mapping };
  if (!token || !sheet || !mapping?.legajo || !mapping?.nombre || !mapping?.apellido || !mapping?.valorHoraNormal) {
    return NextResponse.json({ error: "Faltan datos de la importación" }, { status: 400 });
  }

  const entry = await leerStaging<{ sheetNames: string[]; sheets: Record<string, ParsedSheet> }>(supabase, token, "empleados");
  if (!entry) return NextResponse.json({ error: "La vista previa expiró, volvé a subir el archivo" }, { status: 400 });
  const hoja = entry.sheets[sheet];
  if (!hoja) return NextResponse.json({ error: "Esa hoja no existe en el archivo" }, { status: 400 });

  const admin = createAdminClient();

  const { data: empresas } = await admin.from("empresas").select("id, nombre");
  const empresaByNombre = new Map((empresas ?? []).map((e) => [e.nombre.trim().toLowerCase(), e.id]));
  // Sólo los activos: un nombre repetido por una fila dada de baja —quedaron
  // diez en la 20260904112044— haría ambiguo un sector que en realidad es uno
  // solo, y dejaría sin enlazar a todo el mundo.
  const { data: sectores } = await admin
    .from("sectores").select("id, nombre").eq("activo", true);
  const indiceSectores = indiceDeSectores(sectores ?? []);

  async function resolverEmpresaId(nombre: string): Promise<string> {
    const key = nombre.toLowerCase();
    const existente = empresaByNombre.get(key);
    if (existente) return existente;
    const { data, error } = await admin.from("empresas").insert({ nombre }).select("id").single();
    if (error) throw new Error(error.message);
    empresaByNombre.set(key, data.id);
    return data.id;
  }

  /**
   * El sector que nombra la planilla. Si no se lo reconoce, queda vacío.
   *
   * Antes creaba el que no encontraba, como transversal y en silencio. Así
   * nacieron "Administración (RRHH)", "Calidad (RRHH)" y compañía: cuatro áreas
   * que terminaron existiendo tres veces cada una —una por empresa y una acá—,
   * que no sumaban juntas en ningún tablero y que costaron una migración
   * (20260904112044) y el repunte de 189 filas.
   *
   * Un typo en el Excel creaba un sector nuevo del catálogo del núcleo, que
   * comparten los cinco módulos, sin que nadie lo decidiera ni se enterara.
   * Ahora no se crea nada: el enlace queda vacío, se informa con el nombre tal
   * como lo escribió la planilla, y quien mira decide si corregir el Excel o
   * dar de alta el sector en Administración, donde además se chequea que no
   * duplique uno que ya existe.
   *
   * Se cuenta cuántas filas quedaron sin enlazar con cada nombre: una lista con
   * el mismo nombre repetido treinta veces no se lee.
   */
  const sinReconocer = new Map<string, { filas: number; motivo: string }>();
  function resolverSectorId(nombre: string): string | null {
    const hallado = sectorQueNombra(indiceSectores, nombre);
    if (hallado.id) return hallado.id;
    const previo = sinReconocer.get(nombre);
    sinReconocer.set(nombre, {
      filas: (previo?.filas ?? 0) + 1,
      motivo: hallado.motivo ?? "no existe",
    });
    return null;
  }

  const hoy = utcDateOnlyFrom(new Date()).toISOString().slice(0, 10);

  const errores: string[] = [];
  let creados = 0;
  let actualizados = 0;

  for (let idx = 0; idx < hoja.rows.length; idx++) {
    const row = hoja.rows[idx];
    const legajo = String(row[mapping.legajo] ?? "").trim();
    if (!legajo) continue;

    const nombre = String(row[mapping.nombre] ?? "").trim();
    const apellido = String(row[mapping.apellido] ?? "").trim();
    if (!nombre || !apellido) {
      errores.push(`Fila ${idx + 2}: falta nombre o apellido`);
      continue;
    }
    const valorHoraNormal = parseNumeroAR(row[mapping.valorHoraNormal]);
    if (valorHoraNormal === null || valorHoraNormal <= 0) {
      errores.push(`Fila ${idx + 2}: valor hora normal inválido`);
      continue;
    }

    const fechaIngreso = mapping.fechaIngreso ? toDateOnlyFromCell(row[mapping.fechaIngreso]) : null;
    let fechaIngresoStr = fechaIngreso ? fechaIngreso.toISOString().slice(0, 10) : null;
    if (!fechaIngresoStr) {
      fechaIngresoStr = hoy;
      errores.push(`Fila ${idx + 2}: sin fecha de ingreso, se usó la fecha de hoy como provisoria (corregila en la ficha del empleado)`);
    }

    const sindicato = mapping.sindicato ? String(row[mapping.sindicato] ?? "").trim() || null : null;

    let sectorId: string | null = null;
    const empresaNombre = mapping.empresa ? String(row[mapping.empresa] ?? "").trim() : "";
    const sectorNombre = mapping.sector ? String(row[mapping.sector] ?? "").trim() : "";
    const empresaId = empresaNombre ? await resolverEmpresaId(empresaNombre) : null;
    if (sectorNombre) sectorId = resolverSectorId(sectorNombre);

    let horasTeoricasDiarias: number | undefined;
    if (mapping.horasTeoricasDiarias) {
      const parsedHoras = parseNumeroAR(row[mapping.horasTeoricasDiarias]);
      if (parsedHoras !== null && parsedHoras > 0) horasTeoricasDiarias = parsedHoras;
    }

    const fechaNacimientoDate = mapping.fechaNacimiento ? toDateOnlyFromCell(row[mapping.fechaNacimiento]) : null;
    const fechaNacimiento = fechaNacimientoDate ? fechaNacimientoDate.toISOString().slice(0, 10) : null;
    const genero = mapping.genero ? String(row[mapping.genero] ?? "").trim() || null : null;

    const data: Record<string, unknown> = {
      nombre,
      apellido,
      valor_hora_normal: valorHoraNormal,
      fecha_ingreso: fechaIngresoStr,
      ...(empresaId ? { empresa_id: empresaId } : {}),
      ...(sectorId ? { sector_id: sectorId } : {}),
      ...(horasTeoricasDiarias !== undefined ? { horas_teoricas_diarias: horasTeoricasDiarias } : {}),
    };

    const { data: existente } = await admin.from("empleados").select("id").eq("legajo", legajo).maybeSingle();

    let empleadoId: string;
    if (existente) {
      const { error } = await admin.from("empleados").update(data).eq("id", existente.id);
      if (error) { errores.push(`Fila ${idx + 2} (${legajo}): ${error.message}`); continue; }
      empleadoId = existente.id;
      actualizados += 1;
    } else {
      if (!empresaId) {
        errores.push(`Fila ${idx + 2}: falta la empresa, es obligatoria para crear un empleado nuevo. Fila no importada.`);
        continue;
      }
      const { data: creado, error } = await admin.from("empleados").insert({ ...data, legajo, empresa_id: empresaId }).select("id").single();
      if (error) { errores.push(`Fila ${idx + 2} (${legajo}): ${error.message}`); continue; }
      empleadoId = creado.id;
      creados += 1;
    }

    if (sindicato || fechaNacimiento || genero) {
      await admin.from("rrhh_empleados_datos").upsert(
        { empleado_id: empleadoId, ...(sindicato ? { sindicato } : {}), ...(fechaNacimiento ? { fecha_nacimiento: fechaNacimiento } : {}), ...(genero ? { genero } : {}) },
        { onConflict: "empleado_id" }
      );
    }
  }

  // Los sectores que la planilla nombra y el sistema no reconoce no son un
  // error de la fila: el empleado se importa igual, sólo que sin sector. Van
  // aparte para que se lean como lo que son, una lista corta de nombres para
  // decidir, y no mezclados con las filas que sí fallaron.
  //
  // A un empleado que ya existía no se le borra el sector que tenía: `data`
  // omite `sector_id` cuando es null en vez de escribirlo vacío.
  const sectoresSinReconocer = [...sinReconocer.entries()]
    .map(([nombre, d]) => ({ nombre, filas: d.filas, motivo: d.motivo }))
    .sort((a, b) => b.filas - a.filas);

  await borrarStaging(supabase, token);
  return NextResponse.json({ creados, actualizados, errores, sectoresSinReconocer });
}
