import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { permisosComprasDe } from "@/lib/compras/auth";
import { PRIORIDADES } from "@/lib/compras/constants";
import { exportarRequerimiento } from "@/lib/compras/sheets";

/**
 * Modificación de un requerimiento.
 *
 * Los campos se agrupan según quién puede tocarlos y cada grupo se valida por
 * separado: así quien aprueba no cambia el proveedor, y quien compra no aprueba
 * su propio pedido.
 */

const CAMPOS_ALTA = [
  "descripcion", "area_id", "codigo", "cantidad", "ubicacion_id",
  "fecha_necesidad", "detalle_extra", "imagen_url", "prioridad", "empresa_id",
] as const;

const CAMPOS_APROBACION = ["estado_aprobacion", "motivo_rechazo"] as const;

/**
 * Los define quien aprueba, no quien pide.
 *
 * Es la regla real del circuito: el área dice qué necesita, y gerencia decide
 * qué tan urgente es y quién lo paga. Dejárselo al solicitante es lo que llevó
 * a que el 68% del histórico esté marcado URGENTE.
 */
const CAMPOS_DEL_APROBADOR = ["prioridad", "empresa_id", "paga_ambas"] as const;

const CAMPOS_COMPRA = [
  "estado_compra", "comparativa_url", "proveedor_id", "costo_iva",
  "costo_envio", "oc_numero", "fecha_pedido", "fecha_recepcion",
  "compra_asignada_a",
] as const;

/** Qué hace falta tener cargado antes de pasar a cada estado. */
const FALTA: Record<string, { campo: string; queda: string }[]> = {
  PARA_COMPRAR: [
    { campo: "comparativa_url", queda: "la comparativa" },
    { campo: "compra_asignada_a", queda: "a quién le toca aprobarla" },
  ],
  PEDIDO: [
    { campo: "proveedor_id", queda: "el proveedor elegido" },
    { campo: "costo_iva", queda: "el costo + IVA" },
  ],
};

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("nombre, apellido, activo")
    .eq("id", user.id)
    .single();
  if (!usuario?.activo) return NextResponse.json({ error: "Usuario desactivado" }, { status: 403 });

  const permisos = await permisosComprasDe(supabase, user.id);
  const nombreUsuario = `${usuario.nombre} ${usuario.apellido}`.trim();

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });

  const admin = createAdminClient();
  const { data: actual } = await admin
    .from("compras_requerimientos")
    .select("*")
    .eq("id", id)
    .single();

  if (!actual) return NextResponse.json({ error: "El requerimiento no existe" }, { status: 404 });

  const cambios: Record<string, unknown> = {};

  // ── Campos del alta ────────────────────────────────────────
  // Prioridad y empresa van aparte: quien aprueba puede fijarlas aunque no
  // tenga permiso para editar el resto del pedido.
  const camposAlta = CAMPOS_ALTA.filter(
    (c) => c in body && !CAMPOS_DEL_APROBADOR.includes(c as never)
  );

  if (camposAlta.length > 0) {
    const esPropioEditable =
      actual.solicitante_id === user.id &&
      ["PENDIENTE", "EN_REVISION"].includes(actual.estado_aprobacion);

    if (!permisos.puedeEditar && !esPropioEditable) {
      return NextResponse.json(
        { error: "Solo podés editar tu propio pedido mientras esté pendiente de aprobación" },
        { status: 403 }
      );
    }
    for (const campo of camposAlta) cambios[campo] = body[campo];
  }

  // ── Prioridad y quién paga ─────────────────────────────────
  if (CAMPOS_DEL_APROBADOR.some((c) => c in body)) {
    const esPropioPendiente =
      actual.solicitante_id === user.id &&
      ["PENDIENTE", "EN_REVISION"].includes(actual.estado_aprobacion);

    // El solicitante las sugiere mientras el pedido esté pendiente; la palabra
    // final es de quien aprueba.
    if (!permisos.puedeAprobar && !permisos.puedeEditar && !esPropioPendiente) {
      return NextResponse.json(
        { error: "La prioridad y quién paga las define quien aprueba" },
        { status: 403 }
      );
    }
    for (const campo of CAMPOS_DEL_APROBADOR) if (campo in body) cambios[campo] = body[campo];

    if ("prioridad" in cambios && !PRIORIDADES.includes(cambios.prioridad as never)) {
      return NextResponse.json({ error: "Prioridad inválida" }, { status: 400 });
    }
  }

  // ── Aprobación ─────────────────────────────────────────────
  if (CAMPOS_APROBACION.some((c) => c in body)) {
    if (!permisos.puedeAprobar) {
      return NextResponse.json(
        { error: "Aprobar requiere nivel de administrador del módulo Compras" },
        { status: 403 }
      );
    }
    for (const campo of CAMPOS_APROBACION) if (campo in body) cambios[campo] = body[campo];

    if (cambios.estado_aprobacion === "APROBADA" || cambios.estado_aprobacion === "DENEGADA") {
      cambios.aprobador = nombreUsuario;
      // Referencia al usuario: es por donde se busca su alias en la planilla.
      cambios.aprobado_por = user.id;
      cambios.aprobado_en = new Date().toISOString();

      // Aprobar pone el pedido en la cola de Compras; denegar lo cierra.
      if (cambios.estado_aprobacion === "APROBADA" && actual.estado_compra === "SIN_INICIAR") {
        cambios.estado_compra = "PARA_COMPRAR";
      }
      if (cambios.estado_aprobacion === "DENEGADA") {
        cambios.estado_compra = "DENEGADO";
      }
    }
  }

  // ── Compra ─────────────────────────────────────────────────
  if (CAMPOS_COMPRA.some((c) => c in body)) {
    if (!permisos.puedeEditar) {
      return NextResponse.json({ error: "No tenés permiso para gestionar la compra" }, { status: 403 });
    }
    if (actual.estado_aprobacion !== "APROBADA") {
      return NextResponse.json(
        { error: "El requerimiento tiene que estar aprobado antes de gestionar la compra" },
        { status: 409 }
      );
    }
    for (const campo of CAMPOS_COMPRA) if (campo in body) cambios[campo] = body[campo];

    const nuevoEstado = cambios.estado_compra as string | undefined;

    // Aprobar la compra es de quien la tiene asignada, no de Compras. En la
    // planilla el estado dice a quién le toca; que apruebe otro dejaría los dos
    // lados diciendo cosas distintas.
    if (nuevoEstado === "APROBADO") {
      if (actual.compra_asignada_a !== user.id) {
        return NextResponse.json(
          { error: "Esta compra la tiene que aprobar la persona a la que se le asignó" },
          { status: 403 }
        );
      }
      cambios.compra_aprobada_por = user.id;
      cambios.compra_aprobada_en = new Date().toISOString();
    }

    // Cada paso deja cargado lo suyo. Sin esto se llega a PEDIDO sin proveedor
    // ni costo, y después no hay con qué seguir la compra.
    for (const { campo, queda } of FALTA[nuevoEstado ?? ""] ?? []) {
      const valor = campo in cambios ? cambios[campo] : actual[campo];
      if (valor === null || valor === undefined || valor === "") {
        return NextResponse.json(
          { error: `Antes de avanzar hay que cargar ${queda}.` },
          { status: 409 }
        );
      }
    }

    // Fechas automáticas al avanzar de etapa, si no vinieron explícitas.
    if (nuevoEstado === "PEDIDO" && !actual.fecha_pedido && !("fecha_pedido" in cambios)) {
      cambios.fecha_pedido = new Date().toISOString().slice(0, 10);
    }
    if (nuevoEstado === "RECIBIDO" && !actual.fecha_recepcion && !("fecha_recepcion" in cambios)) {
      cambios.fecha_recepcion = new Date().toISOString().slice(0, 10);
    }
  }

  if (Object.keys(cambios).length === 0) {
    return NextResponse.json({ error: "No se envió ningún cambio válido" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("compras_requerimientos")
    .update(cambios)
    .eq("id", id)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // El trigger deja asentado el cambio de estado; acá se le pone autor y nota.
  if (body.nota || "estado_aprobacion" in cambios || "estado_compra" in cambios) {
    await admin
      .from("compras_historial")
      .update({ usuario_id: user.id, usuario_nombre: nombreUsuario, nota: body.nota ?? null })
      .eq("requerimiento_id", id)
      .is("usuario_id", null);
  }

  // Reflejar el cambio en la planilla mientras dure la transición. Si Sheets
  // falla, el cambio ya está guardado: se avisa sin romper la operación.
  //
  // Se dispara también al aprobar, no sólo al tocar la compra: la aprobación va
  // en el master y antes no se escribía nunca.
  let avisoSheets: string | null = null;
  const tocaPlanilla =
    CAMPOS_COMPRA.some((c) => c in cambios) || "estado_aprobacion" in cambios;

  if (tocaPlanilla) {
    try {
      const { bloqueadas } = await exportarRequerimiento(id);
      if (bloqueadas.length > 0) {
        avisoSheets =
          "El cambio se guardó, pero la planilla no dejó actualizar: " +
          bloqueadas.join(", ") +
          ". Hay que corregirlo a mano ahí.";
      }
    } catch (e) {
      avisoSheets = e instanceof Error ? e.message : String(e);
      console.error(`No se pudo escribir el RI ${id} en la planilla:`, avisoSheets);
    }
  }

  return NextResponse.json(avisoSheets ? { ...data, aviso_sheets: avisoSheets } : data);
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { data: usuario } = await supabase.from("usuarios").select("rol").eq("id", user.id).single();
  if (usuario?.rol !== "admin_sistema" && usuario?.rol !== "admin") {
    return NextResponse.json({ error: "Solo un administrador puede eliminar requerimientos" }, { status: 403 });
  }

  const { error } = await createAdminClient().from("compras_requerimientos").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
