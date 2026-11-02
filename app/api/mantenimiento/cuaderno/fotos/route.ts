import { NextResponse } from "next/server";
import { generateObject, NoObjectGeneratedError } from "ai";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { traerTodo } from "@/lib/core/paginado";
import { normalizarLugar } from "@/lib/mantenimiento/partesDeContratista";
import {
  esquemaDeLaLectura, normalizarRenglones, PROMPT_DEL_CUADERNO, rescatarDelTexto,
} from "@/lib/mantenimiento/cuadernoLectura";
import {
  engancharRenglonLeido,
  type EquipoDelCatalogo, type LugarAprendido, type SectorDelCatalogo,
} from "@/lib/mantenimiento/cuadernoEnganche";

/**
 * Una foto del cuaderno entra, el modelo la lee y vuelve con sus renglones.
 *
 * **Una llamada por foto, y de a una.** Diez fotos en una sola llamada es una
 * respuesta larguísima que se corta a la mitad sin que nadie sepa por dónde
 * iba; así, si la cuarta falla, las otras nueve ya están y se reintenta sólo
 * ésa. Por eso una foto que falla **no devuelve un error**: devuelve 200 con
 * `problemas` y deja `fallo` anotado en su fila, y quien llama sigue con la
 * siguiente.
 *
 * Reintentar es volver a mandar la misma `orden` (con o sin `archivo`: sin él
 * se relee el que ya está en el bucket). Una foto ya leída con renglones no se
 * relee: eso pisaría lo que una persona haya corregido en pantalla.
 */

// Una foto de página completa con un modelo de visión tarda decenas de
// segundos; el default de la plataforma no alcanza.
export const maxDuration = 300;

const BUCKET = "cuaderno-contratista";

/**
 * Tiene que coincidir con `allowed_mime_types` del bucket (migración
 * `20261101224005`): `image/jpg` no es estándar pero algunos clientes lo
 * mandan, y `image/heif` NO está. Un tipo que esta ruta acepta y el bucket no
 * se ve como un 502 de Storage que no explica nada. Si se suma uno, va en los
 * dos lados.
 */
const TIPOS = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic"];

/** Diez megas, el mismo límite del bucket. */
const MAXIMO = 10 * 1024 * 1024;

/** Tope de espera a un modelo que se cuelga, para que la foto falle y se reintente. */
const ESPERA_MAXIMA_MS = 240_000;

/**
 * El modelo sale de una variable para poder cambiarlo sin tocar código, igual
 * que `ASISTENTE_MODELO`.
 *
 * El default es el modelo bueno a propósito: leer letra manuscrita con
 * comillas, llaves y números sin unidad es justo donde más se nota la
 * diferencia de modelo, y un entorno sin configurar tiene que quedar en el que
 * corresponde y no en uno de prueba. El tier gratuito del AI Gateway no incluye
 * a Sonnet 5 (devuelve un 403 antes de llegar al modelo); para probar la
 * cañería sin créditos se pasa a uno que sí entre, y **la calidad de la lectura
 * no se juzga ahí**. Volver al bueno es borrar la variable.
 */
const modeloDelCuaderno = () => process.env.CUADERNO_MODELO ?? "anthropic/claude-sonnet-5";

/** `image/jpg` no existe como tipo de medio: los modelos esperan `image/jpeg`. */
const tipoParaElModelo = (tipo: string) => (tipo === "image/jpg" ? "image/jpeg" : tipo);

function extensionDe(nombre: string, tipo: string): string {
  const cruda = nombre.includes(".") ? (nombre.split(".").pop()?.toLowerCase() ?? "") : "";
  if (/^[a-z0-9]{1,5}$/.test(cruda)) return cruda;
  return { "image/png": "png", "image/webp": "webp", "image/heic": "heic" }[tipo] ?? "jpg";
}

/**
 * Lo que dijo el fallo, sin traducir: el mensaje y, si lo hay, el de la causa
 * (en un `NoObjectGeneratedError` la causa es lo que dijo zod). Un diagnóstico
 * que no se distingue de otro no es un diagnóstico.
 */
function loQueDijoElFallo(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const causa = e.cause instanceof Error ? e.cause.message : e.cause != null ? String(e.cause) : null;
  return causa && causa !== e.message ? `${e.name}: ${e.message} (${causa})` : `${e.name}: ${e.message}`;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const formulario = await request.formData();
  const cuadernoId = String(formulario.get("cuaderno_id") ?? "").trim();
  const orden = Number(formulario.get("orden"));
  const mes = String(formulario.get("mes") ?? "").trim();
  const archivo = formulario.get("archivo");

  // Lo que falta, todo junto, como en el resto del módulo.
  const falta: string[] = [];
  if (!cuadernoId) falta.push("la carga");
  if (!Number.isInteger(orden) || orden < 1) falta.push("el número de página");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) falta.push("el mes del cuaderno (AAAA-MM)");
  if (falta.length > 0) {
    return NextResponse.json({ error: `Falta cargar ${falta.join(", ")}.` }, { status: 400 });
  }
  if (archivo !== null && !(archivo instanceof File)) {
    return NextResponse.json({ error: "El archivo no llegó como una foto." }, { status: 400 });
  }
  if (archivo) {
    if (!TIPOS.includes(archivo.type)) {
      return NextResponse.json({ error: `"${archivo.type || "el archivo"}" no es una foto.` }, { status: 400 });
    }
    if (archivo.size > MAXIMO) {
      return NextResponse.json(
        { error: `La foto pesa ${Math.round(archivo.size / 1024 / 1024)} MB y el máximo son 10.` },
        { status: 400 }
      );
    }
  }

  const admin = createAdminClient();

  // La carga, para saber de qué contratista es el catálogo aprendido.
  const { data: carga } = await supabase
    .from("mant_cuadernos")
    .select("id, proveedor_id")
    .eq("id", cuadernoId)
    .maybeSingle();
  if (!carga) return NextResponse.json({ error: "No existe esa carga" }, { status: 404 });

  // ── ¿Es una página nueva o un reintento? ────────────────────
  const { data: existente } = await admin
    .from("mant_cuadernos_fotos")
    .select("id, ruta, fallo")
    .eq("cuaderno_id", cuadernoId)
    .eq("orden", orden)
    .maybeSingle();

  if (existente) {
    const { data: previos, error: errorPrevios } = await admin
      .from("mant_cuadernos_renglones")
      .select("id, orden_trabajo_id")
      .eq("foto_id", existente.id)
      .limit(1000);
    // Si esta lectura falla, `previos ?? []` parecería «ninguno tiene OT» y se
    // seguiría derecho al borrado de más abajo: es la guarda de una acción que
    // no se deshace, así que ante la duda no se sigue.
    if (errorPrevios) {
      return NextResponse.json(
        { error: `No se pudo comprobar si la página ya generó órdenes de trabajo: ${errorPrevios.message}` },
        { status: 500 }
      );
    }
    if ((previos ?? []).some((r) => r.orden_trabajo_id)) {
      return NextResponse.json(
        { error: `La página ${orden} ya generó órdenes de trabajo, así que no se puede volver a leer.` },
        { status: 409 }
      );
    }
    if ((previos ?? []).length > 0 && !existente.fallo) {
      return NextResponse.json(
        {
          error:
            `La página ${orden} ya está leída y tiene renglones. Releerla pisaría lo que se haya ` +
            `corregido en pantalla: si está mal, corregí los renglones.`,
        },
        { status: 409 }
      );
    }
  } else if (!archivo) {
    return NextResponse.json({ error: "Falta la foto" }, { status: 400 });
  }

  // ── Los bytes, y el archivo en el bucket ────────────────────
  let bytes: Uint8Array;
  let tipo: string;
  let ruta: string;

  if (archivo) {
    tipo = archivo.type;
    bytes = new Uint8Array(await archivo.arrayBuffer());
    // La ruta lleva el cuaderno y la página, y es estable: reintentar la misma
    // página reemplaza el archivo en vez de dejar uno huérfano por intento.
    ruta = `${cuadernoId}/${orden}.${extensionDe(archivo.name, tipo)}`;
    const { error } = await admin.storage
      .from(BUCKET)
      .upload(ruta, bytes, { contentType: tipo, upsert: true });
    if (error) {
      return NextResponse.json({ error: `No se pudo guardar la foto: ${error.message}` }, { status: 502 });
    }
    // Un reintento con otra extensión dejaría el archivo viejo sin dueño.
    if (existente?.ruta && existente.ruta !== ruta) {
      await admin.storage.from(BUCKET).remove([existente.ruta]);
    }
  } else {
    // Reintento sin volver a subir: se relee el archivo que ya está.
    ruta = existente!.ruta;
    const { data: blob, error } = await admin.storage.from(BUCKET).download(ruta);
    if (error || !blob) {
      return NextResponse.json(
        { error: `No se pudo leer la foto guardada: ${error?.message ?? "no está en el bucket"}` },
        { status: 502 }
      );
    }
    bytes = new Uint8Array(await blob.arrayBuffer());
    tipo = TIPOS.includes(blob.type) ? blob.type : "image/jpeg";
  }

  // ── La fila de la foto, antes de llamar al modelo ───────────
  //
  // Va primero a propósito: si el modelo se cuelga o la función se corta, la
  // foto existe, con su archivo, y se reintenta. Sin la fila habría un archivo
  // en el bucket que nadie sabe a qué carga pertenece.
  let fotoId: string;
  if (existente) {
    fotoId = existente.id;
    const { error } = await admin
      .from("mant_cuadernos_fotos")
      .update({ ruta, fallo: null, respuesta_cruda: null })
      .eq("id", fotoId);
    if (error) {
      return NextResponse.json({ error: `No se pudo registrar la foto: ${error.message}` }, { status: 500 });
    }
    // Una relectura de una foto que falló o salió vacía: lo que hubiera de ella
    // se reemplaza, nunca se duplica.
    const { error: errorBorrado } = await admin.from("mant_cuadernos_renglones").delete().eq("foto_id", fotoId);
    if (errorBorrado) {
      return NextResponse.json(
        { error: `No se pudieron reemplazar los renglones anteriores de la página: ${errorBorrado.message}` },
        { status: 500 }
      );
    }
  } else {
    const { data, error } = await admin
      .from("mant_cuadernos_fotos")
      .insert({ cuaderno_id: cuadernoId, orden, ruta })
      .select("id")
      .single();
    if (error) {
      await admin.storage.from(BUCKET).remove([ruta]);
      return NextResponse.json({ error: `No se pudo registrar la foto: ${error.message}` }, { status: 500 });
    }
    fotoId = data.id;
  }

  // ── La lectura ──────────────────────────────────────────────
  //
  // Todo lo que sigue puede fallar sin tirar la carga: se anota en la foto, se
  // devuelve 200 con `problemas` y quien llama sigue con la próxima página.
  const fallar = async (fallo: string, cruda: unknown) => {
    await admin
      .from("mant_cuadernos_fotos")
      .update({ fallo, respuesta_cruda: cruda ?? null })
      .eq("id", fotoId);
    return NextResponse.json({ foto_id: fotoId, renglones: [], problemas: [fallo] });
  };

  let leido: unknown;
  let leidos: ReturnType<typeof normalizarRenglones>["renglones"];
  let problemas: string[];
  try {
    const resultado = await generateObject({
      model: modeloDelCuaderno(),
      system: PROMPT_DEL_CUADERNO,
      schema: esquemaDeLaLectura,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "Esta es la foto de una hoja del cuaderno. Devolvé todos sus renglones." },
          { type: "file", data: bytes, mediaType: tipoParaElModelo(tipo) },
        ],
      }],
      // Es transcribir, no redactar: la misma foto tiene que dar lo mismo.
      temperature: 0,
      // Cada reintento automático son otros decenas de segundos dentro de los
      // 300 de la función; uno alcanza, y el reintento de verdad es el de la
      // foto.
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(ESPERA_MAXIMA_MS),
    });
    leido = resultado.object;
    ({ renglones: leidos, problemas } = normalizarRenglones(leido, mes));
  } catch (e) {
    // Un modelo que no contestó (red, gateway, 403 del tier gratuito) no deja
    // nada que guardar ni que rescatar: la foto falla y se reintenta.
    if (!NoObjectGeneratedError.isInstance(e) || typeof e.text !== "string" || !e.text.trim()) {
      return fallar(loQueDijoElFallo(e), null);
    }

    // El modelo contestó pero `generateObject` lo rechazó. Con **un solo**
    // renglón que no valida tira la lista entera, y eso anularía la tolerancia
    // de `normalizarRenglones`: el renglón que el modelo no entendió tiene que
    // entrar igual, dudoso y con lo que dijo, no descartarse. Se rescata del
    // texto que el error trae (`text`; `cause` dice si fue el JSON o el
    // esquema).
    const rescate = rescatarDelTexto(e.text, mes);
    if (!rescate.esJson) {
      // Prosa, un rechazo o una respuesta cortada: no hay nada que rescatar.
      // Se guarda tal cual lo dijo el modelo, y `finishReason` dice si se cortó
      // por largo.
      return fallar(`${rescate.problemas[0]} (terminó por: ${e.finishReason})`, rescate.crudo);
    }
    leido = rescate.crudo;
    leidos = rescate.renglones;
    problemas = [
      `El modelo contestó una lista que no valida contra el esquema; se rescató lo que se pudo y los renglones dudosos llevan lo que dijo (${loQueDijoElFallo(e)})`,
      ...rescate.problemas,
    ];
  }

  if (leidos.length === 0 && problemas.length > 0) {
    // La respuesta no era la lista esperada: la foto queda en «falló».
    return fallar(problemas.join(" "), leido);
  }

  // ── El enganche ─────────────────────────────────────────────
  //
  // El catálogo, los sectores y los equipos se leen una vez por foto y no uno
  // por renglón. El catálogo se filtra por contratista: lo que enseñó una
  // quincena de Candia no vale para Piparo. Con el cliente de sesión: RLS ya
  // filtra por `mant_puede_ver()`.
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

    // La misma normalización que corre al guardar: con otra, lo aprendido no
    // se encontraría nunca.
    const catalogo = new Map<string, LugarAprendido>(
      aprendidos.map((l) => [normalizarLugar(l.texto), { sector_id: l.sector_id, equipo_id: l.equipo_id }])
    );
    enganches = leidos.map((r) =>
      engancharRenglonLeido(r, catalogo, sectores as SectorDelCatalogo[], equipos as EquipoDelCatalogo[])
    );
  } catch (e) {
    return fallar(`No se pudo leer el catálogo para enganchar los renglones: ${loQueDijoElFallo(e)}`, leido);
  }

  // ── Guardar ─────────────────────────────────────────────────
  let guardados: Array<Record<string, unknown>> = [];
  if (leidos.length > 0) {
    const { data, error } = await admin
      .from("mant_cuadernos_renglones")
      .insert(leidos.map((r, i) => ({
        cuaderno_id: cuadernoId,
        foto_id: fotoId,
        linea: r.linea,
        fecha: r.fecha,
        tarea: r.tarea,
        lugar_raw: r.lugar_raw || null,
        sector_id: enganches[i].sector_id,
        sector_propuesto: enganches[i].sector_propuesto,
        equipo_id: enganches[i].equipo_id,
        horas: r.horas,
        costo: r.costo,
        dudoso: r.dudoso,
        motivo_dudoso: r.motivo_dudoso,
        heredado: r.heredado,
      })))
      .select(
        "id, foto_id, linea, fecha, tarea, lugar_raw, sector_id, sector_propuesto, equipo_id, " +
        "horas, costo, dudoso, motivo_dudoso, heredado, grupo_id, orden_trabajo_id"
      );
    if (error) {
      return fallar(`La foto se leyó pero no se pudieron guardar los renglones: ${error.message}`, leido);
    }
    guardados = (data ?? []) as unknown as Array<Record<string, unknown>>;
  }

  // La respuesta cruda se guarda siempre, y con éxito también: es lo que
  // después distingue «lo leyó mal el modelo» de «lo editó una persona».
  await admin
    .from("mant_cuadernos_fotos")
    .update({ respuesta_cruda: leido, fallo: null })
    .eq("id", fotoId);

  if (leidos.length === 0) {
    problemas.push("El modelo no encontró ningún renglón en esta foto. Si es una hoja con tareas, reintentá.");
  }

  return NextResponse.json({ foto_id: fotoId, renglones: guardados, problemas });
}
