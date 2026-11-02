import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { traerTodo } from "@/lib/core/paginado";
import { normalizarLugar } from "@/lib/mantenimiento/partesDeContratista";
import { interpretarArchivo } from "@/lib/mantenimiento/cuadernoExcelArchivo";
import { gruposAJuntar } from "@/lib/mantenimiento/cuadernoExcel";
import { esRutaDeExcel, TIPO_DE_EXCEL } from "@/lib/mantenimiento/cuadernoOrigen";
import {
  engancharRenglonLeido,
  type EquipoDelCatalogo, type LugarAprendido, type SectorDelCatalogo,
} from "@/lib/mantenimiento/cuadernoEnganche";

/**
 * El mes del cuaderno, cargado como Excel en vez de como fotos.
 *
 * Es **una alternativa a las fotos, no un camino aparte**: el archivo se guarda
 * en el mismo bucket y en la misma tabla (`mant_cuadernos_fotos`, con
 * `orden: 1`), los renglones salen con el mismo enganche a sector y equipo, y
 * todo lo que viene después —juntar, separar, confirmar el sector, el freno de
 * duplicados, generar— no se entera de por dónde entraron.
 *
 * LAS DOS DIFERENCIAS CON LAS FOTOS, Y LAS DOS SON PORQUE LO ESCRIBIÓ UNA
 * PERSONA:
 *
 * - **No hay modelo.** Leer el archivo es `interpretarArchivo`, que es
 *   aritmética: la misma planilla da siempre lo mismo, no tarda, y no puede
 *   inventar. Por eso acá un archivo que no se entiende **devuelve 400 y no
 *   guarda nada**, al revés que una foto, que devuelve 200 con su `fallo`
 *   anotado para poder reintentarla: no hay nada que reintentar.
 * - **El resumen ya dice qué va junto.** La fórmula de la columna N
 *   (`=C47+C50+C51`) es un grupo, o sea una OT, así que los grupos entran
 *   armados y no hay que proponerlos. Un grupo de un solo renglón **no** se
 *   escribe (`gruposAJuntar`): es la orden de ese renglón.
 *
 * EL CONTROL ES EL DE QUIEN CARGA, Y NO SE NEGOCIA: las horas del resumen
 * tienen que dar las del detalle. Si no cierran, **los renglones entran igual**
 * —no se pierde el trabajo de tipear el mes— pero **no se arma ningún grupo**, y
 * la respuesta dice con número de fila qué no cerró. Armar grupos sobre una
 * cuenta que no da manda horas a la OT equivocada sin que nadie lo note.
 */

// Leer un .xlsx y escribir ~100 renglones es rápido, pero el default de la
// plataforma es para una pantalla y acá hay tres viajes a la base.
export const maxDuration = 60;

const BUCKET = "cuaderno-contratista";

/** Diez megas, el mismo límite del bucket. */
const MAXIMO = 10 * 1024 * 1024;

/**
 * El tipo que manda el navegador para un `.xlsx`. Algunos mandan
 * `application/octet-stream` (y Windows, a veces, nada), así que la extensión
 * decide igual que el tipo: lo que no se pueda abrir va a fallar al abrirlo, que
 * es un error que sí explica algo.
 */
const esUnXlsx = (archivo: File) =>
  archivo.type === TIPO_DE_EXCEL || /\.xlsx$/i.test(archivo.name);

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const formulario = await request.formData();
  const cuadernoId = String(formulario.get("cuaderno_id") ?? "").trim();
  const archivo = formulario.get("archivo");

  const falta: string[] = [];
  if (!cuadernoId) falta.push("la carga");
  if (!(archivo instanceof File)) falta.push("el archivo");
  if (falta.length > 0) {
    return NextResponse.json({ error: `Falta cargar ${falta.join(", ")}.` }, { status: 400 });
  }
  const planilla = archivo as File;
  if (!esUnXlsx(planilla)) {
    return NextResponse.json(
      { error: `"${planilla.name || "el archivo"}" no es una planilla .xlsx.` },
      { status: 400 }
    );
  }
  if (planilla.size > MAXIMO) {
    return NextResponse.json(
      { error: `La planilla pesa ${Math.round(planilla.size / 1024 / 1024)} MB y el máximo son 10.` },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  const { data: carga, error: errorCarga } = await supabase
    .from("mant_cuadernos")
    .select("id, proveedor_id")
    .eq("id", cuadernoId)
    .maybeSingle();
  if (errorCarga) {
    return NextResponse.json({ error: `No se pudo leer la carga: ${errorCarga.message}` }, { status: 500 });
  }
  if (!carga) return NextResponse.json({ error: "No existe esa carga" }, { status: 404 });

  // ── ¿Qué hay ya en esta carga? ──────────────────────────────
  //
  // Si esta lectura falla y se la descarta, la ruta tomaría la rama de «carga
  // vacía»: insertaría una segunda fila con el mismo `orden` y duplicaría los
  // renglones de todo el mes.
  const { data: previas, error: errorPrevias } = await admin
    .from("mant_cuadernos_fotos")
    .select("id, ruta")
    .eq("cuaderno_id", cuadernoId)
    .limit(1000);
  if (errorPrevias) {
    return NextResponse.json(
      { error: `No se pudo comprobar qué tiene la carga: ${errorPrevias.message}` },
      { status: 500 }
    );
  }

  const fotos = (previas ?? []).filter((f) => !esRutaDeExcel(f.ruta));
  if (fotos.length > 0) {
    return NextResponse.json(
      {
        error:
          `Esta carga ya tiene ${fotos.length} ${fotos.length === 1 ? "foto" : "fotos"} del cuaderno. ` +
          `El Excel es una alternativa a las fotos, no se mezclan: abrí una carga nueva para la planilla.`,
      },
      { status: 409 }
    );
  }

  // Más de un Excel no puede haber (el índice único de `(cuaderno_id, orden)`),
  // pero si lo hubiera, reemplazar «uno» dejaría los renglones del otro.
  if ((previas ?? []).length > 1) {
    return NextResponse.json(
      { error: "Esta carga tiene más de un archivo y no se sabe cuál reemplazar. Abrí una carga nueva." },
      { status: 409 }
    );
  }
  const anterior = (previas ?? [])[0] ?? null;

  if (anterior) {
    const { data: previos, error: errorPrevios } = await admin
      .from("mant_cuadernos_renglones")
      .select("id, orden_trabajo_id")
      .eq("foto_id", anterior.id)
      .limit(1000);
    // Es la guarda de un borrado que no se deshace: ante la duda no se sigue.
    if (errorPrevios) {
      return NextResponse.json(
        { error: `No se pudo comprobar si la planilla ya generó órdenes de trabajo: ${errorPrevios.message}` },
        { status: 500 }
      );
    }
    if ((previos ?? []).some((r) => r.orden_trabajo_id)) {
      return NextResponse.json(
        { error: "Esta planilla ya generó órdenes de trabajo, así que no se puede volver a cargar." },
        { status: 409 }
      );
    }
  }

  // ── Leer el archivo, antes de escribir nada ─────────────────
  //
  // Va primero justo al revés que en las fotos: acá leer es aritmética y no
  // cuesta nada, así que una planilla que no se reconoce no tiene por qué dejar
  // un archivo en el bucket ni una fila que alguien después tenga que limpiar.
  const bytes = new Uint8Array(await planilla.arrayBuffer());
  const lectura = await interpretarArchivo(bytes);
  if (!lectura.ok) {
    return NextResponse.json({ error: lectura.error }, { status: 400 });
  }
  if (lectura.renglones.length === 0) {
    return NextResponse.json(
      {
        error:
          "La planilla se reconoció pero no tiene ningún renglón con tarea." +
          (lectura.problemas.length > 0 ? ` ${lectura.problemas.join(" ")}` : ""),
      },
      { status: 400 }
    );
  }

  // ── El enganche ─────────────────────────────────────────────
  //
  // Los catálogos se leen una vez y no uno por renglón, y el aprendido se filtra
  // por contratista: lo que enseñó una quincena de Candia no vale para Piparo.
  // La planilla no tiene columna de lugar —el lugar viene dentro de la tarea,
  // «planta TRT Nº2»—, así que `lugar_raw` va vacío y el enganche lee la tarea
  // entera, que es lo que `engancharRenglonLeido` hace cuando no hay lugar.
  let enganches: Array<ReturnType<typeof engancharRenglonLeido>>;
  try {
    const [aprendidos, sectores, equipos] = await Promise.all([
      traerTodo((d, h) =>
        supabase
          .from("mant_contratista_lugares")
          .select("texto, sector_id, equipo_id")
          .eq("proveedor_id", carga.proveedor_id)
          .range(d, h)
      ),
      traerTodo((d, h) => supabase.from("sectores").select("id, codigo").range(d, h)),
      traerTodo((d, h) => supabase.from("equipos").select("id, code, name, sector_id").range(d, h)),
    ]);
    const catalogo = new Map<string, LugarAprendido>(
      aprendidos.map((l) => [normalizarLugar(l.texto), { sector_id: l.sector_id, equipo_id: l.equipo_id }])
    );
    enganches = lectura.renglones.map((r) =>
      engancharRenglonLeido(
        { tarea: r.tarea, lugar_raw: "" },
        catalogo,
        sectores as SectorDelCatalogo[],
        equipos as EquipoDelCatalogo[]
      )
    );
  } catch (e) {
    const porque = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: `No se pudo leer el catálogo para enganchar los renglones: ${porque}` },
      { status: 500 }
    );
  }

  // ── Reemplazar lo anterior ──────────────────────────────────
  //
  // Los renglones primero: si el borrado falla, la planilla vieja sigue entera y
  // se puede reintentar. Al revés quedarían los renglones viejos colgando de una
  // fila que ya apunta al archivo nuevo.
  if (anterior) {
    const { error } = await admin.from("mant_cuadernos_renglones").delete().eq("foto_id", anterior.id);
    if (error) {
      return NextResponse.json(
        { error: `No se pudieron reemplazar los renglones de la planilla anterior: ${error.message}` },
        { status: 500 }
      );
    }
  }

  // ── El archivo en el bucket ─────────────────────────────────
  //
  // La ruta es estable: volver a cargar reemplaza el archivo en vez de dejar uno
  // huérfano por intento.
  const ruta = `${cuadernoId}/planilla.xlsx`;
  const { error: errorSubida } = await admin.storage
    .from(BUCKET)
    .upload(ruta, bytes, { contentType: TIPO_DE_EXCEL, upsert: true });
  if (errorSubida) {
    return NextResponse.json(
      {
        error:
          `No se pudo guardar la planilla: ${errorSubida.message}. ` +
          `Si dice que el tipo no está permitido, falta correr la migración 20261102115445.`,
      },
      { status: 502 }
    );
  }

  // Lo que decía el resumen, cierre o no, es la evidencia de lo que había en el
  // archivo cuando se cargó: los renglones se corrigen en pantalla y esto no.
  const evidencia = {
    origen: "excel",
    archivo: planilla.name,
    control: lectura.control,
    grupos_leidos: lectura.grupos_leidos,
    problemas: lectura.problemas,
  };

  let fotoId: string;
  if (anterior) {
    fotoId = anterior.id;
    const { error } = await admin
      .from("mant_cuadernos_fotos")
      .update({ ruta, fallo: null, respuesta_cruda: evidencia })
      .eq("id", fotoId);
    if (error) {
      return NextResponse.json({ error: `No se pudo registrar la planilla: ${error.message}` }, { status: 500 });
    }
    if (anterior.ruta && anterior.ruta !== ruta) {
      await admin.storage.from(BUCKET).remove([anterior.ruta]);
    }
  } else {
    const { data, error } = await admin
      .from("mant_cuadernos_fotos")
      .insert({ cuaderno_id: cuadernoId, orden: 1, ruta, respuesta_cruda: evidencia })
      .select("id")
      .single();
    if (error) {
      await admin.storage.from(BUCKET).remove([ruta]);
      return NextResponse.json({ error: `No se pudo registrar la planilla: ${error.message}` }, { status: 500 });
    }
    fotoId = data.id;
  }

  // ── Los grupos que el resumen ya dice ───────────────────────
  const grupoDeLaFila = new Map<number, string>();
  for (const grupo of gruposAJuntar(lectura.grupos)) {
    const grupo_id = crypto.randomUUID();
    for (const fila of grupo.filas) grupoDeLaFila.set(fila, grupo_id);
  }

  const { data: guardados, error: errorGuardado } = await admin
    .from("mant_cuadernos_renglones")
    .insert(lectura.renglones.map((r, i) => ({
      cuaderno_id: cuadernoId,
      foto_id: fotoId,
      // La fila del Excel: es la única forma de volver del renglón a la planilla.
      linea: r.fila,
      fecha: r.fecha,
      tarea: r.tarea,
      lugar_raw: null,
      sector_id: enganches[i].sector_id,
      sector_propuesto: enganches[i].sector_propuesto,
      equipo_id: enganches[i].equipo_id,
      horas: r.horas,
      costo: r.costo,
      dudoso: r.dudoso,
      motivo_dudoso: r.motivo_dudoso,
      heredado: false,
      grupo_id: grupoDeLaFila.get(r.fila) ?? null,
    })))
    .select(
      "id, cuaderno_id, foto_id, linea, fecha, tarea, lugar_raw, sector_id, sector_propuesto, equipo_id, " +
      "horas, costo, dudoso, motivo_dudoso, heredado, grupo_id, orden_trabajo_id"
    );
  if (errorGuardado) {
    return NextResponse.json(
      { error: `La planilla se leyó pero no se pudieron guardar los renglones: ${errorGuardado.message}` },
      { status: 500 }
    );
  }

  const problemas = [...lectura.problemas];

  // Renglones nuevos en una carga que ya estaba generada: queda algo por
  // generar, así que vuelve a chequeo.
  const { error: errorDeEstado } = await admin
    .from("mant_cuadernos")
    .update({ estado: "EN_CHEQUEO" })
    .eq("id", cuadernoId)
    .eq("estado", "GENERADA");
  if (errorDeEstado) {
    problemas.push(`La carga estaba marcada como generada y no se pudo volver a chequeo: ${errorDeEstado.message}`);
  }

  return NextResponse.json({
    foto_id: fotoId,
    renglones: guardados ?? [],
    grupos: gruposAJuntar(lectura.grupos).length,
    control: lectura.control,
    problemas,
  });
}
