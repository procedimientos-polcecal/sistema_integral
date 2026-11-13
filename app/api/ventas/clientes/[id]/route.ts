import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  esAdminVentas,
  noSePudoAveriguar,
  puedeEditarVentas,
  tieneAccesoVentas,
} from "@/lib/ventas/auth";
import { cuitParaGuardar, esquemaDeClienteParcial } from "@/lib/ventas/crm/cuerpos";
import { auditar, nombreParaAuditoria } from "@/lib/core/auditoria";
import { validar, errorDeValidacion } from "@/lib/core/validar";

/**
 * Un cliente: su ficha entera (GET), corregirlo (PATCH) y borrarlo (DELETE).
 *
 * ── EL BORRADO SE AUDITA, Y EL REGISTRO VA ANTES ────────────
 *
 * Borrar un cliente se lleva **en cascada** sus contactos, sus oportunidades y
 * todo su registro de actividades: es decir, todo lo que se habló con esa
 * empresa desde que existe la ficha. Eso no se deshace, y la regla del repo es
 * que lo que no se deshace se audita (CLAUDE.md; la tabla y `auditar()` salen
 * del spec `2026-09-22-auditoria-de-lo-irreversible`).
 *
 * Es el segundo `borrar` que escribe una persona y no un proceso —el primero
 * fue sacar un renglón del cuaderno de un contratista, el 03/11/2026—. Y acá
 * hay una diferencia que importa: **allá el archivo de origen seguía en el
 * bucket**, así que «qué decía» se contestaba sin la tabla. Acá no hay archivo
 * de origen ninguno. El registro de auditoría es lo único que va a quedar, así
 * que lleva en el contexto la razón social, el CUIT y cuántas filas colgaban:
 * sin eso diría que alguien borró un uuid.
 *
 * El registro se escribe **antes** del delete, como el borrado de espejo: si no
 * entra, no se borra. Auditar después deja el caso en que la fila ya no está y
 * el rastro tampoco.
 *
 * ── POR QUÉ SE CUENTA LO QUE CUELGA ANTES DE BORRAR ─────────
 *
 * No es decoración del registro: es lo que la pantalla usa para preguntar
 * «esto se lleva 3 contactos, 2 oportunidades y 41 actividades, ¿seguro?». Un
 * borrado en cascada que no dice qué se lleva es cómo se pierde un año de
 * trabajo con un clic.
 */

const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ES_UUID.test(id)) return NextResponse.json({ error: "Id inválido" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const permiso = await tieneAccesoVentas(supabase, user.id);
  if (!permiso.ok) return noSePudoAveriguar(permiso);
  if (!permiso.si) return NextResponse.json({ error: "No tenés acceso a Ventas" }, { status: 403 });

  // Las cuatro lecturas en paralelo: no dependen entre sí y la ficha las
  // necesita todas para dibujarse una sola vez.
  const [cliente, contactos, oportunidades, actividades] = await Promise.all([
    supabase
      .from("ventas_clientes")
      .select(
        "id, numero, razon_social, nombre_fantasia, cuit, estado, vendedor_id, localidad, provincia, rubro, telefono, email, sitio_web, origen, notas, creado_en, creado_por"
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("ventas_contactos")
      .select("id, nombre, cargo, telefono, email, es_principal, activo, notas")
      .eq("cliente_id", id)
      .order("es_principal", { ascending: false })
      .order("nombre"),
    supabase
      .from("ventas_oportunidades")
      .select(
        "id, numero, titulo, producto_id, toneladas_estimadas, monto_estimado, moneda, etapa, vendedor_id, fecha_estimada_cierre, cerrada_el, motivo_perdida, notas"
      )
      .eq("cliente_id", id)
      .order("numero", { ascending: false }),
    supabase
      .from("ventas_actividades")
      .select(
        "id, contacto_id, oportunidad_id, tipo, fecha, resumen, proximo_paso, proximo_paso_el, cumplido_el, hecha_por, creada_en"
      )
      .eq("cliente_id", id)
      .order("fecha", { ascending: false })
      .order("creada_en", { ascending: false }),
  ]);

  if (cliente.error) {
    return NextResponse.json(
      { error: `No se pudo leer el cliente: ${cliente.error.message}` },
      { status: 503 }
    );
  }
  if (!cliente.data) return NextResponse.json({ error: "No existe ese cliente" }, { status: 404 });

  return NextResponse.json({
    cliente: cliente.data,
    contactos: contactos.data ?? [],
    oportunidades: oportunidades.data ?? [],
    actividades: actividades.data ?? [],
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ES_UUID.test(id)) return NextResponse.json({ error: "Id inválido" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const permiso = await puedeEditarVentas(supabase, user.id);
  if (!permiso.ok) return noSePudoAveriguar(permiso);
  if (!permiso.si) {
    return NextResponse.json({ error: "No tenés permiso para corregir clientes" }, { status: 403 });
  }

  const r = validar(esquemaDeClienteParcial, await request.json().catch(() => null));
  if (!r.ok) return errorDeValidacion(r.problemas);
  const c = r.datos;

  /**
   * Reasignar el vendedor es de `admin`, y es la única columna con esa regla.
   * Vive en la ruta y no en un trigger: RLS no sabe de columnas, y un trigger
   * entero para un campo es una defensa más que hay que mantener. La migración
   * lo dice en su encabezado.
   */
  if ("vendedor_id" in c) {
    const esAdmin = await esAdminVentas(supabase, user.id);
    if (!esAdmin.ok) return noSePudoAveriguar(esAdmin);
    if (!esAdmin.si) {
      return NextResponse.json(
        { error: "Reasignar el vendedor de un cliente requiere nivel admin en Ventas" },
        { status: 403 }
      );
    }
  }

  // Sólo lo que vino: un PATCH que manda el teléfono no puede vaciar el resto.
  const cambios: Record<string, unknown> = {};
  let aviso: string | null = null;

  for (const campo of [
    "razon_social",
    "nombre_fantasia",
    "estado",
    "vendedor_id",
    "localidad",
    "provincia",
    "rubro",
    "telefono",
    "sitio_web",
    "origen",
    "notas",
  ] as const) {
    if (campo in c) cambios[campo] = c[campo] ?? null;
  }
  // El correo vacío entra como null y no como "": ver `textoOpcional`.
  if ("email" in c) cambios.email = c.email || null;
  if ("cuit" in c) {
    const normalizado = cuitParaGuardar(c.cuit);
    cambios.cuit = normalizado.cuit;
    aviso = normalizado.aviso;
  }

  if (Object.keys(cambios).length === 0) {
    return NextResponse.json({ error: "No mandaste ningún cambio" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("ventas_clientes")
    .update(cambios)
    .eq("id", id)
    .select("id, numero, razon_social")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: `Ya hay otro cliente cargado con el CUIT ${cambios.cuit}.` },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: `No se pudo guardar el cambio: ${error.message}` },
      { status: 500 }
    );
  }
  // Sin fila devuelta: o no existe, o RLS no dejó. Las dos se contestan igual a
  // propósito — decir cuál sería contar que existe algo que no se puede ver.
  if (!data) {
    return NextResponse.json({ error: "No existe ese cliente o no podés tocarlo" }, { status: 404 });
  }

  return NextResponse.json({ cliente: data, aviso });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ES_UUID.test(id)) return NextResponse.json({ error: "Id inválido" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const permiso = await esAdminVentas(supabase, user.id);
  if (!permiso.ok) return noSePudoAveriguar(permiso);
  if (!permiso.si) {
    return NextResponse.json(
      { error: "Borrar un cliente requiere nivel admin en Ventas" },
      { status: 403 }
    );
  }

  // Qué se va a perder. Se lee **antes** de borrar porque después no hay de
  // dónde sacarlo: es todo lo que va a quedar de este cliente.
  const { data: cliente, error: errorDeLectura } = await supabase
    .from("ventas_clientes")
    .select("id, numero, razon_social, cuit")
    .eq("id", id)
    .maybeSingle();
  if (errorDeLectura) {
    return NextResponse.json(
      { error: `No se pudo leer el cliente: ${errorDeLectura.message}` },
      { status: 503 }
    );
  }
  if (!cliente) return NextResponse.json({ error: "No existe ese cliente" }, { status: 404 });

  const [contactos, oportunidades, actividades] = await Promise.all([
    supabase.from("ventas_contactos").select("id", { count: "exact", head: true }).eq("cliente_id", id),
    supabase
      .from("ventas_oportunidades")
      .select("id", { count: "exact", head: true })
      .eq("cliente_id", id),
    supabase
      .from("ventas_actividades")
      .select("id", { count: "exact", head: true })
      .eq("cliente_id", id),
  ]);

  const { data: quien } = await supabase
    .from("usuarios")
    .select("nombre, apellido, email")
    .eq("id", user.id)
    .maybeSingle();

  const registro = await auditar(supabase, {
    modulo: "ventas",
    entidad: "ventas_clientes",
    entidadId: id,
    accion: "borrar",
    usuario: { id: user.id, nombre: nombreParaAuditoria(quien) },
    valorAnterior: `${cliente.razon_social}${cliente.cuit ? ` (${cliente.cuit})` : ""}`,
    valorNuevo: null,
    contexto: {
      numero: cliente.numero,
      razon_social: cliente.razon_social,
      cuit: cliente.cuit,
      // Lo que se lleva la cascada. `null` quiere decir que el conteo falló, y
      // no cero: un cero inventado haría creer que no se perdió nada.
      contactos: contactos.count ?? null,
      oportunidades: oportunidades.count ?? null,
      actividades: actividades.count ?? null,
    },
  });

  // Si el registro no entra, no se borra. Es la regla del borrado de espejo y
  // vale el doble acá, donde la fila es el único lugar donde existía el dato.
  if (!registro.ok) {
    return NextResponse.json(
      {
        error:
          `No se borró nada: no se pudo dejar registro de quién lo hizo (${registro.error}). ` +
          `Volvé a intentarlo.`,
      },
      { status: 503 }
    );
  }

  const { error } = await supabase.from("ventas_clientes").delete().eq("id", id);
  if (error) {
    return NextResponse.json(
      { error: `No se pudo borrar el cliente: ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({
    borrado: {
      razon_social: cliente.razon_social,
      contactos: contactos.count ?? null,
      oportunidades: oportunidades.count ?? null,
      actividades: actividades.count ?? null,
    },
  });
}
