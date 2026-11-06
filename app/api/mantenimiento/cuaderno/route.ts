import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { traerTodo } from "@/lib/core/paginado";

/**
 * Las cargas del cuaderno de un contratista que lleva cuaderno (hoy PIPARO).
 *
 * Una carga es el lote de fotos de un mes; las fotos y su lectura entran por
 * `./fotos/route.ts`. Esta ruta **no lee ninguna foto ni crea ninguna OT**:
 * sólo abre, lista y borra el contenedor.
 */

const BUCKET = "cuaderno-contratista";

/**
 * Sin `?id`: las cargas, con sus fotos pero **sin renglones**. Un año de
 * cuaderno son ~1.400 renglones y embebidos en la lista toparían con las 1000
 * filas de PostgREST sin avisar.
 *
 * Con `?id`: esa carga y todos sus renglones, paginados con `traerTodo()`.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const id = new URL(request.url).searchParams.get("id");

  try {
    // Con el cliente de sesión: RLS ya filtra por `mant_puede_ver()`.
    if (!id) {
      const cargas = await traerTodo((d, h) =>
        supabase
          .from("mant_cuadernos")
          .select("id, proveedor_id, estado, created_at, proveedores(nombre), mant_cuadernos_fotos(id, orden, ruta, fallo)")
          .order("created_at", { ascending: false })
          .range(d, h)
      );
      return NextResponse.json({ data: cargas });
    }

    const { data: carga, error } = await supabase
      .from("mant_cuadernos")
      .select("id, proveedor_id, estado, created_at, proveedores(nombre), mant_cuadernos_fotos(id, orden, ruta, fallo)")
      .eq("id", id)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!carga) return NextResponse.json({ error: "No existe esa carga" }, { status: 404 });

    // `cuaderno_id` viaja a propósito: `propuestaDeGrupos` agrupa por él para no
    // cruzar cargas, y sin él todas las claves quedarían `undefined|tarea` y el
    // corte entre cargas dejaría de existir sin que nadie lo notara.
    const renglones = await traerTodo((d, h) =>
      supabase
        .from("mant_cuadernos_renglones")
        .select(
          "id, cuaderno_id, foto_id, linea, fecha, fecha_hasta, tarea, lugar_raw, sector_id, sector_propuesto, equipo_id, " +
          "horas, costo, dudoso, motivo_dudoso, heredado, grupo_id, orden_trabajo_id"
        )
        .eq("cuaderno_id", id)
        .order("fecha", { ascending: true, nullsFirst: false })
        .order("linea", { ascending: true })
        .range(d, h)
    );
    return NextResponse.json({ data: { ...carga, renglones } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { proveedor_id } = await cuerpoJson<{ proveedor_id?: string }>(request);
  if (!proveedor_id) return NextResponse.json({ error: "Falta el contratista" }, { status: 400 });

  const admin = createAdminClient();

  // Un contratista que carga partes diarios no tiene cuaderno: abrirle una
  // carga dejaría fotos que ninguna pantalla sabe mostrar.
  const { data: proveedor } = await admin
    .from("proveedores")
    .select("id, nombre, modo_de_carga")
    .eq("id", proveedor_id)
    .maybeSingle();
  if (!proveedor) return NextResponse.json({ error: "No existe ese contratista" }, { status: 404 });
  if (proveedor.modo_de_carga !== "cuaderno") {
    return NextResponse.json(
      { error: `${proveedor.nombre} no lleva cuaderno: sus partes se cargan hoja por hoja.` },
      { status: 400 }
    );
  }

  const { data, error } = await admin
    .from("mant_cuadernos")
    .insert({ proveedor_id, cargado_por: user.id })
    .select("id")
    .single();
  if (error) {
    return NextResponse.json({ error: `No se pudo abrir la carga: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ id: data.id });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Falta el id de la carga" }, { status: 400 });

  const admin = createAdminClient();

  // Una carga que ya generó OT no se borra: borrarla dejaría órdenes contando
  // horas que ya no tienen de dónde salir, y la OT no se deshace desde acá.
  const { data: generados, error: errorGenerados } = await admin
    .from("mant_cuadernos_renglones")
    .select("id")
    .eq("cuaderno_id", id)
    .not("orden_trabajo_id", "is", null)
    .limit(1);

  // Si la lectura falla, «ninguno generó OT» sería una conclusión falsa y el
  // borrado seguiría: se corta acá.
  if (errorGenerados) {
    return NextResponse.json(
      { error: `No se pudo comprobar si la carga ya generó órdenes de trabajo: ${errorGenerados.message}` },
      { status: 500 }
    );
  }

  if (generados && generados.length > 0) {
    return NextResponse.json(
      {
        error:
          "Esa carga ya generó órdenes de trabajo, así que no se puede borrar. " +
          "Si está mal cargada, hay que corregir las OT una por una.",
      },
      { status: 409 }
    );
  }

  // Las rutas se leen antes: al borrar la carga las filas de fotos se van en
  // cascada y con ellas el único registro de qué archivos había en el bucket.
  const fotos = await traerTodo((d, h) =>
    admin.from("mant_cuadernos_fotos").select("ruta").eq("cuaderno_id", id).range(d, h)
  );

  const { error } = await admin.from("mant_cuadernos").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Los archivos son lo último y no tumban el borrado: la carga ya no existe
  // y un archivo huérfano en un bucket privado no le hace daño a nadie, pero
  // se dice para que alguien lo pueda limpiar.
  let aviso: string | null = null;
  const rutas = fotos.map((f) => f.ruta).filter(Boolean);
  if (rutas.length > 0) {
    const { error: errorArchivos } = await admin.storage.from(BUCKET).remove(rutas);
    if (errorArchivos) {
      aviso = `La carga se borró, pero ${rutas.length} foto(s) quedaron en el bucket "${BUCKET}": ${errorArchivos.message}`;
    }
  }

  return NextResponse.json({ ok: true, aviso });
}
