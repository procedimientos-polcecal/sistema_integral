import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { leerComparativa, escribirCelda } from "@/lib/compras/drive";
import { mapearEncabezados } from "@/lib/compras/comparativa";
import { exportarRequerimiento } from "@/lib/compras/sheets";
import { puedeAprobarCompras } from "@/lib/compras/auth";
import { puedeAprobarLaCompra } from "@/lib/compras/aprobarCompra";
import { cotizacionDeHoy } from "@/lib/compras/dolar";

/**
 * Elegir un presupuesto ES aprobar la compra.
 *
 * No son dos actos: quien elige es la persona a la que Compras le asignó el
 * pedido —NICO o MAXI—, y su elección es lo que hace avanzar el circuito. Por
 * eso esto no es un PATCH de `elegida`: es una acción, con su propio permiso.
 *
 * Ser admin del sistema no alcanza, igual que para aprobar el RI: tiene que ser
 * la persona asignada. En la planilla el estado dice a quién le toca, y que
 * apruebe otro dejaría los dos lados diciendo cosas distintas.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { data: usuario } = await supabase
    .from("usuarios").select("nombre, apellido, activo").eq("id", user.id).single();
  if (!usuario?.activo) return NextResponse.json({ error: "Usuario desactivado" }, { status: 403 });

  const admin = createAdminClient();
  const { data: cotizacion } = await admin
    .from("compras_cotizaciones")
    .select("id, requerimiento_id, proveedor_id, drive_fila, moneda, cotizacion")
    .eq("id", id)
    .single();
  if (!cotizacion) return NextResponse.json({ error: "El presupuesto no existe" }, { status: 404 });

  const { data: ri } = await admin
    .from("compras_requerimientos")
    .select("id, estado_compra, compra_asignada_a, comparativa_drive_id")
    .eq("id", cotizacion.requerimiento_id)
    .single();
  if (!ri) return NextResponse.json({ error: "El requerimiento no existe" }, { status: 404 });

  const veredicto = puedeAprobarLaCompra({
    asignadaA: ri.compra_asignada_a as string | null,
    usuarioId: user.id,
    estaEnLaLista: await puedeAprobarCompras(supabase, user.id),
    estadoCompra: ri.estado_compra as string,
  });
  if (!veredicto.ok) {
    return NextResponse.json({ error: veredicto.error }, { status: veredicto.estado });
  }

  // Una sola elegida por requerimiento.
  await admin
    .from("compras_cotizaciones")
    .update({ elegida: false })
    .eq("requerimiento_id", ri.id);

  // Elegir un presupuesto en dólares congela la cotización de este momento.
  //
  // Mientras se comparaba se mostraba al dólar del día, que es lo que permite
  // mirar dos presupuestos cargados con semanas de diferencia con la misma
  // vara. A partir de acá el número no se mueve más: lo que se pagó no cambia
  // porque mañana el dólar esté más caro.
  const congelar: Record<string, unknown> = { elegida: true };
  if (cotizacion.moneda === "USD" && !cotizacion.cotizacion) {
    const dolar = await cotizacionDeHoy();
    if (!dolar) {
      return NextResponse.json(
        {
          error:
            "Este presupuesto está en dólares y no se pudo obtener la cotización. " +
            "Sin eso no se puede dejar registrado a cuánto se aprobó.",
        },
        { status: 503 }
      );
    }
    congelar.cotizacion = dolar.venta;
  }

  const { error: errorElegir } = await admin
    .from("compras_cotizaciones")
    .update(congelar)
    .eq("id", id);
  if (errorElegir) return NextResponse.json({ error: errorElegir.message }, { status: 400 });

  const nombreUsuario = `${usuario.nombre} ${usuario.apellido}`.trim();
  const { error: errorRi } = await admin
    .from("compras_requerimientos")
    .update({
      estado_compra: "APROBADO",
      compra_aprobada_por: user.id,
      compra_aprobada_en: new Date().toISOString(),
    })
    .eq("id", ri.id);
  if (errorRi) return NextResponse.json({ error: errorRi.message }, { status: 400 });

  // El trigger deja asentado el cambio de estado; acá se le pone autor.
  await admin
    .from("compras_historial")
    .update({ usuario_id: user.id, usuario_nombre: nombreUsuario })
    .eq("requerimiento_id", ri.id)
    .is("usuario_id", null);

  const avisos: string[] = [];

  // La casilla ELECCIÓN de la planilla es la que dispara el formato condicional
  // que pinta la fila elegida.
  if (ri.comparativa_drive_id && cotizacion.drive_fila) {
    try {
      const planilla = await leerComparativa(ri.comparativa_drive_id);
      const mapeo = mapearEncabezados(planilla.encabezado);
      if (mapeo.ok && mapeo.idx.eleccion >= 0) {
        await escribirCelda(
          ri.comparativa_drive_id, planilla.pestana,
          mapeo.idx.eleccion, cotizacion.drive_fila, "TRUE"
        );
      }
    } catch (e) {
      avisos.push(
        "La compra quedó aprobada, pero no se pudo marcar la elección en la planilla: " +
        (e instanceof Error ? e.message : String(e))
      );
    }
  }

  // El estado de compra va al master, como cualquier otro cambio.
  try {
    const { bloqueadas } = await exportarRequerimiento(ri.id);
    if (bloqueadas.length > 0) {
      avisos.push(
        "La planilla no dejó actualizar: " + bloqueadas.join(", ") +
        ". Hay que corregirlo a mano ahí."
      );
    }
  } catch (e) {
    avisos.push(e instanceof Error ? e.message : String(e));
  }

  return NextResponse.json({
    ok: true,
    aviso_drive: avisos.length > 0 ? avisos.join(" ") : null,
  });
}
