import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarFacturacion, tieneAccesoFacturacion } from "@/lib/facturacion/auth";
import { prepararAlta, type PedidoDeAlta } from "@/lib/facturacion/altaDeFactura";
import {
  facturaConLaMismaClave,
  traerCatalogos,
  traerElBuzon,
} from "@/lib/facturacion/consultas";
import { nombreDelComprobante } from "@/lib/facturacion/comprobante";

/**
 * Cargar una factura al buzón.
 *
 * Recibe **el archivo y lo que el navegador ya leyó de él**: la cabecera sale
 * del QR del lado del cliente, así que quien carga vio los datos en pantalla y
 * los pudo corregir antes de que esta ruta exista. El servidor no vuelve a
 * leer el QR —no tendría con qué: rasterizar necesita un canvas— pero tampoco
 * confía a ciegas: `prepararAlta` resuelve la empresa y el proveedor **por
 * CUIT contra la base**, así que los enlaces no los elige el cliente.
 *
 * Dos cosas que la ruta hace en este orden y no en otro:
 *
 * 1. **Primero busca el duplicado, después sube el archivo.** Al revés dejaría
 *    un archivo huérfano en el bucket cada vez que alguien carga por segunda vez
 *    la misma factura, que es un caso esperado y no un error.
 * 2. **Nunca rechaza por datos faltantes.** Una factura sin QR entra igual, con
 *    avisos. El módulo existe para que cargar una factura cueste menos; hacerla
 *    rebotar sería empeorar exactamente lo que vino a arreglar.
 */

export const maxDuration = 120;

const BUCKET = "facturas-proveedor";

/** Lo que la migración deja entrar al bucket. */
const TIPOS = [
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
];

/** 20 MB, el mismo límite que tiene el bucket. */
const MAXIMO = 20 * 1024 * 1024;

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await tieneAccesoFacturacion(supabase, user.id))) {
    return NextResponse.json({ error: "Sin acceso a Facturación" }, { status: 403 });
  }

  const estado = new URL(request.url).searchParams.get("estado");

  try {
    return NextResponse.json({ facturas: await traerElBuzon(supabase, { estado }) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarFacturacion(supabase, user.id))) {
    return NextResponse.json(
      { error: "Cargar una factura requiere nivel de edición en Facturación" },
      { status: 403 }
    );
  }

  const formulario = await request.formData().catch(() => null);
  if (!formulario) {
    return NextResponse.json({ error: "El cuerpo no es un formulario" }, { status: 400 });
  }

  let pedido: PedidoDeAlta;
  try {
    pedido = JSON.parse(String(formulario.get("datos") ?? "{}")) as PedidoDeAlta;
  } catch {
    return NextResponse.json({ error: "Los datos de la factura no son un JSON" }, { status: 400 });
  }
  if (!pedido.origen) pedido.origen = "carga manual";

  const archivo = formulario.get("archivo") as File | null;
  if (archivo) {
    if (!TIPOS.includes(archivo.type)) {
      return NextResponse.json(
        { error: `"${archivo.type || "el archivo"}" no es un PDF ni una imagen.` },
        { status: 400 }
      );
    }
    if (archivo.size > MAXIMO) {
      return NextResponse.json(
        {
          error: `El archivo pesa ${Math.round(archivo.size / 1024 / 1024)} MB y el máximo son 20.`,
        },
        { status: 400 }
      );
    }
  }

  /*
   * El requerimiento se puede pedir por su **número**, que es lo que la gente
   * tiene a mano: nadie sabe el uuid de un RI. Si el número no existe no se
   * inventa el enlace —enlazar al que se le parece es peor que dejar en null—:
   * la factura entra sin vincular y el aviso lo dice.
   */
  const avisosDelRi: string[] = [];
  const nroRiPedido = formulario.get("nro_ri");
  if (!pedido.requerimientoId && nroRiPedido) {
    const nro = Number(nroRiPedido);
    if (Number.isFinite(nro)) {
      const { data: ri } = await supabase
        .from("compras_requerimientos")
        .select("id")
        .eq("nro_ri", nro)
        .maybeSingle();
      if (ri) pedido.requerimientoId = ri.id as string;
      else avisosDelRi.push(`No existe el requerimiento ${nro}, así que la factura entró sin vincular.`);
    }
  }

  const catalogos = await traerCatalogos(supabase);
  const alta = prepararAlta(pedido, catalogos);

  // ── 1. ¿Ya está? ──
  if (alta.clave) {
    const ya = await facturaConLaMismaClave(supabase, alta.clave);
    if (ya) {
      return NextResponse.json(
        {
          duplicada: true,
          factura: ya,
          mensaje:
            `${nombreDelComprobante({
              tipoComprobante: ya.tipo_comprobante,
              puntoVenta: ya.punto_venta,
              numero: ya.numero,
            })} ya está en el buzón: entró el ` +
            `${new Date(ya.created_at).toLocaleDateString("es-AR")} por ${ya.origen}.`,
        },
        { status: 409 }
      );
    }
  }

  // ── 2. El respaldo ──
  //
  // Se guarda **la ruta**, no un link. El bucket es privado, así que los links
  // son firmados y vencen: guardar uno en la base sería guardar un dato que se
  // podre solo. La pantalla firma uno cuando hace falta abrirlo.
  let rutaDelArchivo: string | null = null;

  if (archivo) {
    const admin = createAdminClient();
    const extension = archivo.name.split(".").pop()?.toLowerCase() || "pdf";
    const carpeta = (alta.fila.fecha ?? new Date().toISOString().slice(0, 10)).slice(0, 7);
    const base = alta.clave
      ? `${alta.clave.cuit_emisor}-${alta.clave.tipo_comprobante}-${alta.clave.punto_venta}-${alta.clave.numero}`
      : `sin-clave-${Date.now()}`;

    const { error } = await admin.storage
      .from(BUCKET)
      .upload(`${carpeta}/${base}.${extension}`, new Uint8Array(await archivo.arrayBuffer()), {
        contentType: archivo.type,
        // `upsert` sí: si la carga anterior falló al insertar la fila, el archivo
        // quedó en el bucket y el reintento tiene que poder pisarlo. La fila es
        // la que no se duplica, y de eso se encarga el paso 1.
        upsert: true,
      });

    if (error) {
      return NextResponse.json(
        { error: `No se pudo guardar el archivo: ${error.message}` },
        { status: 502 }
      );
    }
    rutaDelArchivo = `${carpeta}/${base}.${extension}`;
  }

  // ── 3. La fila ──
  const { data: factura, error } = await supabase
    .from("facturas_proveedor")
    .insert({
      ...alta.fila,
      archivo_url: rutaDelArchivo,
      archivo_nombre: archivo?.name ?? null,
      cargado_por: user.id,
    })
    .select("*")
    .single();

  if (error) {
    /*
     * El único choque esperado es el índice único, y sólo si dos personas
     * cargaron la misma factura en el mismo instante —el paso 1 atrapa todo lo
     * demás—. Que lo diga como lo que es y no como un 500.
     */
    if (error.code === "23505") {
      return NextResponse.json(
        {
          duplicada: true,
          mensaje: `${alta.nombre} la acaba de cargar otra persona. Recargá el buzón para verla.`,
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    factura,
    avisos: [...avisosDelRi, ...alta.avisos],
    nombre: alta.nombre,
  });
}
