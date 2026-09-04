import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { permisosComprasDe } from "@/lib/compras/auth";
import { PRIORIDADES } from "@/lib/compras/constants";
import type { EstadoCompra } from "@/lib/compras/types";
import { exportarRequerimiento } from "@/lib/compras/sheets";
import { costosParaElPedido } from "@/lib/compras/comparativa";
import { puedeAprobarLaCompra } from "@/lib/compras/aprobarCompra";
import { faltaElMotivo } from "@/lib/compras/devolucion";
import { faltaLaJustificacion, POR_QUE_HACE_FALTA } from "@/lib/compras/denegacion";

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

/**
 * Qué hace falta tener cargado antes de pasar a cada estado.
 *
 * PARA_COMPRAR no está acá: lo que exige no es un campo del requerimiento sino
 * que haya presupuestos cargados, y eso hay que contarlo. Se valida más abajo.
 */
const FALTA: Record<string, { campo: string; queda: string }[]> = {
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

      // Aprobar pone el pedido a juntar presupuestos, que es el paso que sigue;
      // denegar lo cierra.
      //
      // Antes lo dejaba en PARA_COMPRAR, salteando la comparativa. Y como esta
      // asignación no pasa por la validación de requisitos —que vive en la rama
      // de compra— el RI quedaba "para comprar" sin comparativa ni asignado,
      // que es justo lo que esa validación existe para evitar.
      if (cambios.estado_aprobacion === "APROBADA" && actual.estado_compra === "SIN_INICIAR") {
        cambios.estado_compra = "EN_COMPARATIVA";
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

    // ── Poner en espera y sacar de la espera ───────────────
    //
    // La etapa de la que sale la guarda el servidor leyendo el estado actual,
    // no el cliente: es un dato que la base ya tiene, y confiar en que lo
    // manden bien no agrega nada.
    const veniaEnEspera = actual.estado_compra === "EN_ESPERA";

    if (nuevoEstado === "EN_ESPERA") {
      if (veniaEnEspera) {
        return NextResponse.json({ error: "Ya estaba en espera" }, { status: 409 });
      }
      cambios.etapa_previa = actual.estado_compra;
    }

    // Devolver un pedido a comparativa no puede ser mudo.
    //
    // Quien aprueba lo devuelve porque le falta algo —un presupuesto vencido,
    // uno solo cuando hacen falta tres, un flete sin cotizar—, y Compras lo
    // recibe de vuelta sin saber qué corregir si no se lo dice. Sin motivo, lo
    // más probable es que el pedido vuelva igual que como se fue.
    //
    // La regla vive acá y no sólo en el formulario: una validación que existe
    // en el botón deja de existir apenas alguien llame a la API de otra forma.
    //
    // Se exige sólo en la devolución —de PARA_COMPRAR a EN_COMPARATIVA—; llegar
    // a comparativa desde cualquier otro lado no es devolver nada.
    if (faltaElMotivo(actual.estado_compra, nuevoEstado as EstadoCompra, body.nota)) {
      return NextResponse.json(
        { error: "Para devolver el pedido a comparativa hay que decir qué falta." },
        { status: 400 }
      );
    }

    // Volver de la espera no es avanzar: es retomar donde estaba. Por eso más
    // abajo no corren las exigencias de etapa — un pedido frenado seis meses
    // que perdió su comparativa quedaría atrapado en la espera, que es
    // justamente lo que esto viene a evitar.
    const vuelveDeLaEspera = veniaEnEspera && !!nuevoEstado && nuevoEstado !== "EN_ESPERA";
    if (vuelveDeLaEspera) cambios.etapa_previa = null;

    // Aprobar la compra es de quien la tiene asignada, no de Compras. En la
    // planilla el estado dice a quién le toca; que apruebe otro dejaría los dos
    // lados diciendo cosas distintas.
    if (nuevoEstado === "APROBADO") {
      const veredicto = puedeAprobarLaCompra({
        asignadaA: actual.compra_asignada_a as string | null,
        usuarioId: user.id,
        estaEnLaLista: permisos.puedeAprobar,
      });
      if (!veredicto.ok) {
        return NextResponse.json({ error: veredicto.error }, { status: veredicto.estado });
      }
      cambios.compra_aprobada_por = user.id;
      cambios.compra_aprobada_en = new Date().toISOString();
    }

    // Cuántos presupuestos alcanza lo decide Compras. Lo que el sistema exige
    // es que haya algo que mirar: sin eso, la persona asignada no puede elegir.
    if (nuevoEstado === "PARA_COMPRAR" && !vuelveDeLaEspera) {
      const { count } = await admin
        .from("compras_cotizaciones")
        .select("id", { count: "exact", head: true })
        .eq("requerimiento_id", id);

      const link = "comparativa_url" in cambios ? cambios.comparativa_url : actual.comparativa_url;
      if ((count ?? 0) === 0 && !link) {
        return NextResponse.json(
          { error: "Antes de avanzar hay que cargar al menos un presupuesto o el link de la comparativa." },
          { status: 409 }
        );
      }

      const asignado =
        "compra_asignada_a" in cambios ? cambios.compra_asignada_a : actual.compra_asignada_a;
      if (!asignado) {
        return NextResponse.json(
          { error: "Antes de avanzar hay que cargar a quién le toca aprobarla." },
          { status: 409 }
        );
      }
    }

    // Aprobar sin elegir un presupuesto se permite, y es deliberado.
    //
    // Antes esto devolvía 409: aprobar la compra ERA elegir un presupuesto. Pero
    // hay compras que no se comparan —proveedor único, urgencia, monto menor— y
    // la regla dejaba trabados esos pedidos en la bandeja, que sin presupuestos
    // no ofrecía ninguna acción. La contrapartida hay que tenerla presente: el
    // sistema ya no garantiza que una compra con presupuestos se aprobó
    // mirándolos. Eso pasó a ser decisión de quien aprueba.
    //
    // Que no haya ninguna cotización elegida es lo que deja constancia de que
    // se aprobó sin comparar; por eso no hace falta un campo aparte.

    // Al registrar el pedido, el proveedor y los costos salen del presupuesto
    // elegido en vez de tipearse de nuevo. `costo_iva` es el total sin el
    // envío, porque en el RI el envío va en su propio campo y la ficha suma los
    // dos: así el total del RI coincide con el del presupuesto.
    if (nuevoEstado === "PEDIDO") {
      const { data: elegida } = await admin
        .from("compras_cotizaciones")
        .select("proveedor_id, precio_total, costo_envio, moneda, cotizacion")
        .eq("requerimiento_id", id)
        .eq("elegida", true)
        .maybeSingle();

      if (elegida) {
        const desdeElegida = costosParaElPedido(elegida);
        if (!("proveedor_id" in cambios) && !actual.proveedor_id) {
          cambios.proveedor_id = desdeElegida.proveedor_id;
        }
        if (!("costo_iva" in cambios) && actual.costo_iva === null) {
          cambios.costo_iva = desdeElegida.costo_iva;
        }
        if (!("costo_envio" in cambios) && actual.costo_envio === null) {
          cambios.costo_envio = desdeElegida.costo_envio;
        }
      }
    }

    // Cada paso deja cargado lo suyo. Sin esto se llega a PEDIDO sin proveedor
    // ni costo, y después no hay con qué seguir la compra.
    for (const { campo, queda } of (vuelveDeLaEspera ? [] : FALTA[nuevoEstado ?? ""] ?? [])) {
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

  // Denegar no puede ser mudo, y se revisa acá —después de las dos ramas—
  // porque el denegado puede llegar por cualquiera de las dos: la de aprobación
  // pone DENEGADA, y ésa a su vez pone la compra en DENEGADO. Una regla que se
  // esquiva cambiando de campo no es una regla.
  //
  // El motivo que cuenta es el que queda: si ya había uno cargado, volver a
  // denegar no exige repetirlo. Es el mismo criterio que usa la validación de
  // requisitos de más arriba.
  if (
    faltaLaJustificacion({
      ...cambios,
      motivo_rechazo: "motivo_rechazo" in cambios ? cambios.motivo_rechazo : actual.motivo_rechazo,
    })
  ) {
    return NextResponse.json({ error: POR_QUE_HACE_FALTA }, { status: 400 });
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
