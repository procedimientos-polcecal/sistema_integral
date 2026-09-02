import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarCompras } from "@/lib/compras/auth";
import { PRIORIDADES } from "@/lib/compras/constants";
import { paginaPedida } from "@/lib/core/paginado";

/**
 * Alta de un requerimiento interno.
 *
 * La puede hacer cualquier usuario activo del sistema, tenga o no el módulo
 * Compras: son nueve áreas las que piden materiales. Lo que sí queda acotado
 * es que nadie se autoasigne un estado ya aprobado.
 *
 * El N° de RI se asigna del lado del servidor para que continúe la serie de la
 * planilla sin huecos ni repetidos. Si dos personas cargan a la vez, el índice
 * único hace fallar a la segunda y se reintenta con el número siguiente.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("nombre, apellido, activo")
    .eq("id", user.id)
    .single();

  if (!usuario?.activo) {
    return NextResponse.json({ error: "Tu usuario está desactivado" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });

  const descripcion = String(body.descripcion ?? "").trim();
  if (!descripcion) {
    return NextResponse.json({ error: "Hay que describir qué se necesita" }, { status: 400 });
  }

  // Sin valor por defecto: si no la sugieren, queda sin definir hasta que
  // alguien apruebe. Poner "NORMAL" sería inventar una decisión.
  const prioridad = PRIORIDADES.includes(body.prioridad) ? body.prioridad : null;

  const registro = {
    descripcion,
    area_id: body.area_id ?? null,
    codigo: body.codigo ?? null,
    cantidad: body.cantidad ?? null,
    ubicacion_id: body.ubicacion_id ?? null,
    fecha_necesidad: body.fecha_necesidad ?? null,
    detalle_extra: body.detalle_extra ?? null,
    imagen_url: body.imagen_url ?? null,
    prioridad,
    empresa_id: body.empresa_id ?? null,
    paga_ambas: body.paga_ambas === true,
    solicitante_id: user.id,
    solicitante_nombre: `${usuario.nombre} ${usuario.apellido}`.trim(),
    // El mail de la sesión, guardado como texto. `solicitante_id` es
    // `on delete set null`: si mañana se da de baja a esta persona, el pedido
    // queda sin autor. Esta copia sobrevive a eso.
    solicitante_email: user.email ?? null,
    estado_aprobacion: "PENDIENTE" as const,
    estado_compra: "SIN_INICIAR" as const,
    origen: "app",
    created_by: user.id,
  };

  const admin = createAdminClient();

  for (let intento = 0; intento < 5; intento++) {
    const { data: ultimo } = await admin
      .from("compras_requerimientos")
      .select("nro_ri")
      .order("nro_ri", { ascending: false })
      .limit(1)
      .maybeSingle();

    const nro_ri = (ultimo?.nro_ri ?? 0) + 1 + intento;

    const { data, error } = await admin
      .from("compras_requerimientos")
      .insert({ ...registro, nro_ri })
      .select("id, nro_ri")
      .single();

    if (!error) {
      // La creación queda en el historial, que es donde se mira cuando hay que
      // reconstruir qué pasó con un pedido. Va con el cliente admin porque
      // insertar en `compras_historial` pide acceso al módulo, y cargar un
      // pedido no lo pide: son nueve áreas las que piden materiales.
      //
      // Si esto falla no se voltea el alta: el registro de quién pidió ya
      // quedó en el requerimiento, y perder el alta por no poder escribir el
      // renglón del historial sería peor que perder el renglón.
      const { error: errorHistorial } = await admin.from("compras_historial").insert({
        requerimiento_id: data.id,
        campo: "creacion",
        usuario_id: user.id,
        usuario_nombre: registro.solicitante_nombre || null,
        nota: registro.solicitante_email,
      });
      if (errorHistorial) {
        console.error(`RI ${data.nro_ri}: no se pudo asentar la creación en el historial`, errorHistorial);
      }
      return NextResponse.json(data, { status: 201 });
    }

    // 23505 = otro usuario tomó ese número justo antes; se reintenta.
    if (error.code !== "23505") {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
  }

  return NextResponse.json(
    { error: "No se pudo asignar un N° de RI. Probá de nuevo." },
    { status: 409 }
  );
}

/** Listado con filtros, para consumo externo o de otras pantallas. */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const page = paginaPedida(searchParams.get("page"));
  const limit = 50;

  let query = supabase
    .from("compras_requerimientos")
    .select("*, compras_areas(nombre), empresas(nombre), proveedores(nombre)", { count: "exact" })
    .order("nro_ri", { ascending: false })
    .range((page - 1) * limit, page * limit - 1);

  const aprobacion = searchParams.get("estado_aprobacion");
  const compra = searchParams.get("estado_compra");
  const mios = searchParams.get("mios");

  if (aprobacion) query = query.eq("estado_aprobacion", aprobacion);
  if (compra) query = query.eq("estado_compra", compra);
  if (mios === "1") query = query.eq("solicitante_id", user.id);

  const { data, count, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data, count, puedeEditar: await puedeEditarCompras(supabase, user.id) });
}
