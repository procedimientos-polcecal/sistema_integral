import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { noSePudoAveriguar, puedeEditarVentas, tieneAccesoVentas } from "@/lib/ventas/auth";
import { cuitParaGuardar, esquemaDeCliente } from "@/lib/ventas/crm/cuerpos";
import { validar, errorDeValidacion } from "@/lib/core/validar";
import { traerTodo } from "@/lib/core/paginado";

/**
 * Los clientes del CRM: listarlos (GET) y cargar uno (POST).
 *
 * Las dos van con el cliente del usuario y **no** con el admin, a propósito:
 * así corren las policies de `ventas_clientes`. No hace falta repetir acá el
 * permiso de fila — pero sí el de acción, porque un 403 con texto es mucho
 * mejor que una lista vacía o un error de Postgres.
 *
 * ── EL LISTADO TRAE TAMBIÉN LAS FECHAS DE ACTIVIDAD, Y NO UN CONTEO ─────────
 *
 * El semáforo de seguimiento («hace cuánto que no se toca a este cliente») sale
 * de `ventas_actividades`, y se arma en memoria con `ultimaActividadPorCliente`.
 * Se traen **sólo dos columnas** de todas las actividades y no un join por
 * cliente: PostgREST no sabe hacer un `max(fecha) group by cliente_id` sin una
 * vista, y una vista más sería una cosa más que mantener para una tabla que
 * hoy tiene decenas de filas. Cuando crezca, acá va la vista — y el cálculo no
 * se mueve, porque ya vive en una función pura con test.
 *
 * `traerTodo()` en las dos lecturas y no `.limit()`: PostgREST corta en 1000
 * filas y no avisa. Las actividades son justamente la tabla que va a pasar ese
 * número primero.
 */

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const permiso = await tieneAccesoVentas(supabase, user.id);
  if (!permiso.ok) return noSePudoAveriguar(permiso);
  if (!permiso.si) {
    return NextResponse.json({ error: "No tenés acceso a Ventas" }, { status: 403 });
  }

  try {
    // El `select` va literal y no armado en una variable: en una variable
    // Supabase pierde la inferencia de tipos.
    const clientes = await traerTodo((desde, hasta) =>
      supabase
        .from("ventas_clientes")
        .select(
          "id, numero, razon_social, nombre_fantasia, cuit, estado, vendedor_id, localidad, provincia, rubro, telefono, email, sitio_web, origen, notas, creado_en"
        )
        .order("razon_social")
        .range(desde, hasta)
    );

    const actividades = await traerTodo((desde, hasta) =>
      supabase.from("ventas_actividades").select("cliente_id, fecha").range(desde, hasta)
    );

    return NextResponse.json({ clientes, actividades });
  } catch (e) {
    return NextResponse.json(
      { error: `No se pudieron leer los clientes: ${(e as Error).message}` },
      { status: 503 }
    );
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const permiso = await puedeEditarVentas(supabase, user.id);
  if (!permiso.ok) return noSePudoAveriguar(permiso);
  if (!permiso.si) {
    return NextResponse.json({ error: "No tenés permiso para cargar clientes" }, { status: 403 });
  }

  const r = validar(esquemaDeCliente, await request.json().catch(() => null));
  if (!r.ok) return errorDeValidacion(r.problemas);
  const c = r.datos;

  // El CUIT se normaliza y **nunca se rechaza**: lo que no cierra se guarda
  // como vino y se devuelve un aviso para mostrar. Ver `cuitParaGuardar`.
  const { cuit, aviso } = cuitParaGuardar(c.cuit);

  const { data, error } = await supabase
    .from("ventas_clientes")
    .insert({
      razon_social: c.razon_social,
      nombre_fantasia: c.nombre_fantasia ?? null,
      cuit,
      estado: c.estado ?? "prospecto",
      vendedor_id: c.vendedor_id ?? null,
      localidad: c.localidad ?? null,
      provincia: c.provincia ?? null,
      rubro: c.rubro ?? null,
      telefono: c.telefono ?? null,
      email: c.email || null,
      sitio_web: c.sitio_web ?? null,
      origen: c.origen ?? null,
      notas: c.notas ?? null,
      creado_por: user.id,
    })
    .select("id, numero, razon_social")
    .single();

  if (error) {
    // El único choque esperable es el `unique` del CUIT, y decir «ya hay un
    // cliente con ese CUIT» es mucho más útil que el 23505 pelado: quien carga
    // probablemente esté dando de alta a alguien que ya está.
    if (error.code === "23505") {
      return NextResponse.json(
        { error: `Ya hay un cliente cargado con el CUIT ${cuit}.` },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: `No se pudo guardar el cliente: ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ cliente: data, aviso }, { status: 201 });
}
