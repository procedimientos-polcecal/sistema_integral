import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { permisosComprasDe, aprobadoresDeCompras } from "@/lib/compras/auth";
import { resumenDelHistorico } from "@/lib/compras/historicoDelArticulo";
import { permisosComprasActuales } from "@/lib/compras/sesion";
import { cotizacionDeHoy } from "@/lib/compras/dolar";
import { volverAlListado } from "@/lib/compras/filtrosUrl";
import { umbralDeMontoAlto } from "@/lib/compras/ajustes";
import { createAdminClient } from "@/lib/supabase/admin";
import type { OrigenEnLaOT } from "@/lib/compras/origenEnLaOT";
import { traerTodo } from "@/lib/core/paginado";
import {
  salidasCandidatas, lecturaDeLaSalida,
  type SalidaDelPanol, type SalidasDeLaFicha,
} from "@/lib/inventario/salidasDelRepuesto";
import RequerimientoDetalle from "./RequerimientoDetalle";
import { dondeApuntaOdoo, enlaceAOdoo } from "@/lib/odoo/client";
import type { RequerimientoConRelaciones, HistorialItem, Cotizacion } from "@/lib/compras/types";


/** El embed de proveedor llega como objeto o como arreglo según la relación. */
function nombreDelProveedor(v: unknown): string | null {
  const uno = Array.isArray(v) ? v[0] : v;
  const nombre = (uno as { nombre?: unknown } | null)?.nombre;
  return typeof nombre === "string" ? nombre : null;
}

export default async function RequerimientoPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  /** Sólo `volver`: el query string con el que quedó el listado del que se salió. */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const volverA = volverAlListado((await searchParams).volver);
  const supabase = await createClient();

  const user = await usuarioActual();
  if (!user) redirect("/login");

  const { data: requerimiento } = await supabase
    .from("compras_requerimientos")
    // `!empresa_id`: `compras_odoo_ordenes` abre un segundo camino hasta `empresas` (PGRST201).
    .select("*, compras_areas(nombre), empresas!empresa_id(nombre), proveedores!proveedor_id(nombre), compras_ubicaciones(nombre)")
    .eq("id", id)
    .single();

  if (!requerimiento) notFound();

  const [{ data: historial }, { data: cotizaciones }, { data: proveedores }] = await Promise.all([
    supabase
      .from("compras_historial")
      .select("*")
      .eq("requerimiento_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("compras_cotizaciones")
      .select("*, proveedores(nombre, cuit)")
      .eq("requerimiento_id", id)
      .order("precio_total", { ascending: true }),
    // Con los datos de pago: el formulario de presupuesto los completa solo
    // al elegir el proveedor.
    supabase
      .from("proveedores")
      // El `cuit` no completa ningún campo: es para avisar que falta al elegir
      // al proveedor, en vez de que lo diga recién la generación de la orden.
      .select("id, nombre, cuit, plazo_pago_dias, forma_pago, condicion_pago")
      .eq("activo", true)
      .order("nombre"),
  ]);

  const { data: empresas } = await supabase.from("empresas").select("id, nombre").order("nombre");

  // Quiénes pueden aprobar una compra: es a uno de ellos a quien Compras se
  // la asigna.
  const aprobadores = await aprobadoresDeCompras();

  const permisos = await permisosComprasActuales();

  // La cotización del día, para convertir los presupuestos que vinieron en
  // dólares. Puede ser null: la pantalla lo dice en vez de inventar un número.
  const dolar = await cotizacionDeHoy();

  // Con qué número se decide si es de monto alto: el mismo que usa el listado.
  const umbralMontoAlto = await umbralDeMontoAlto(supabase);

  // Aprobar la compra es de quien la tiene asignada: la comparativa le
  // ofrece elegir solo a esa persona.
  const esAsignado = requerimiento.compra_asignada_a === user.id;

  // Lo que el pañol registró contra este RI. Se consulta siempre: si Inventario
  // todavía no está en marcha la lista viene vacía y la sección no se muestra,
  // que es lo mismo que no haber preguntado.
  const { data: entradasAlPanol } = await supabase
    .from("inventario_movimientos")
    // `articulo_id` es una columna vieja de la tabla (no la que crea la migración
    // de la trazabilidad): sólo hace falta para buscar qué salió de ese artículo.
    .select("id, codigo, cantidad, fecha, articulo_id, inventario_articulos(descripcion)")
    .eq("requerimiento_id", id)
    .eq("tipo", "entrada")
    .order("fecha", { ascending: false });

  /*
   * Qué salió del pañol después de esas entradas y a qué orden se declaró.
   * PERMISO: sólo quien puede editar Compras (los mismos cinco que editan
   * Inventario). Se lee con el cliente admin porque cruza tres cosas cerradas
   * por módulo —`inventario_movimientos`, `ordenes_trabajo_repuestos` y
   * `ordenes_trabajo`— y con la sesión cada una devolvería vacío sin error; como
   * RLS no corre, el permiso es este `if` y no se puede sacar. Para quien no lo
   * tiene la sección no se dibuja: no es lo mismo que «no hay salidas».
   *
   * La ficha es de sólo lectura sobre el vínculo: el vínculo lo declara
   * Mantenimiento en el renglón de repuesto de la OT.
   */
  const salidasDelPanol = permisos.puedeEditar && (entradasAlPanol ?? []).length > 0
    ? await leerLasSalidas(
        (entradasAlPanol ?? []).map((e) => ({
          articulo_id: (e.articulo_id ?? null) as string | null,
          fecha: (e.fecha ?? null) as string | null,
        })),
      )
    : null;

  /*
   * Para qué OT se pidió. PERMISO: lo ve cualquiera que pueda abrir la ficha,
   * porque es la procedencia de su propio pedido. Por eso se lee con el
   * cliente admin: `ordenes_trabajo` está cerrada con `mant_puede_ver()` y con
   * la sesión la línea desaparecería para casi todos los de Compras.
   *
   * `ot_id` es undefined mientras la migración no esté aplicada (el `select("*")`
   * no la trae): la ficha sigue andando y simplemente no muestra la línea.
   */
  // La aserción: los tipos generados todavía no conocen la columna nueva.
  const otId = (requerimiento as { ot_id?: string | null }).ot_id ?? null;
  const otRepuestoId = (requerimiento as { ot_repuesto_id?: string | null }).ot_repuesto_id ?? null;
  let origenEnLaOT: OrigenEnLaOT | null = null;
  if (otId) {
    const admin = createAdminClient();
    const [{ data: orden }, { data: renglon }] = await Promise.all([
      admin.from("ordenes_trabajo").select("ot_number, descripcion, equipo_raw").eq("id", otId).maybeSingle(),
      otRepuestoId
        ? admin.from("ordenes_trabajo_repuestos").select("nombre").eq("id", otRepuestoId).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    if (orden) {
      origenEnLaOT = {
        ot_number: (orden.ot_number ?? null) as number | null,
        descripcion: (orden.descripcion ?? null) as string | null,
        equipo_raw: (orden.equipo_raw ?? null) as string | null,
        repuesto_nombre: (renglon?.nombre ?? null) as string | null,
      };
    }
  }

  // Las órdenes de compra que este RI ya tiene en Odoo. Son una o dos: un
  // requerimiento que pagan las dos empresas son dos órdenes, porque el
  // proveedor factura a cada CUIT por separado.
  const { data: ordenesOdoo } = await supabase
    .from("compras_odoo_ordenes")
    .select("odoo_order_id, odoo_nombre, porcentaje, empresas(nombre)")
    .eq("requerimiento_id", id)
    .order("porcentaje", { ascending: false });

  /*
   * Qué costó antes lo mismo que se está pidiendo.
   *
   * Se busca por `clave_articulo`, que es una columna generada: la descripción
   * normalizada, que mantiene Postgres sola. Acá no se vuelve a normalizar
   * nada — se compara la clave del RI contra la de los demás — y por eso la
   * regla no existe dos veces.
   *
   * Sólo los que YA tienen monto, y nunca este mismo RI. Es un hecho sobre
   * requerimientos pasados: la pantalla lo muestra y decide la persona. El
   * porqué de no marcar con esto está en `lib/compras/historicoDelArticulo.ts`.
   */
  const clave = (requerimiento as { clave_articulo?: string | null }).clave_articulo ?? null;
  const { data: pasados } = clave
    ? await supabase
        .from("compras_requerimientos")
        .select("nro_ri, fecha, monto_conocido, proveedores!proveedor_id(nombre)")
        .eq("clave_articulo", clave)
        .not("monto_conocido", "is", null)
        .neq("id", id)
        .order("nro_ri", { ascending: false })
        // Veinte alcanza para el resumen —cuántas veces, el último, el rango— y
        // pone un techo: el artículo más repetido del histórico tiene 6.
        .limit(20)
    : { data: null };

  const historicoDelArticulo = resumenDelHistorico(
    (pasados ?? []).map((p) => ({
      nro_ri: p.nro_ri as number,
      fecha: (p.fecha ?? null) as string | null,
      monto_conocido: Number(p.monto_conocido),
      // El embed llega como objeto o como arreglo según la relación, igual que
      // en `descripcionDelArticulo` unas líneas más arriba.
      proveedor: nombreDelProveedor(p.proveedores),
    }))
  );

  return (
    <RequerimientoDetalle
      dolar={dolar}
      volverA={volverA}
      requerimiento={requerimiento as RequerimientoConRelaciones}
      historial={(historial ?? []) as HistorialItem[]}
      cotizaciones={(cotizaciones ?? []) as Cotizacion[]}
      proveedores={proveedores ?? []}
      empresas={empresas ?? []}
      puedeEditar={permisos.puedeEditar}
      puedeAprobar={permisos.puedeAprobar}
      esAsignado={esAsignado}
      umbralMontoAlto={umbralMontoAlto}
      historicoDelArticulo={historicoDelArticulo}
      // Se mapea, como en el listado, y no es prolijidad: pasar el objeto entero
      // mandaba el **correo** de cada aprobador al navegador. TypeScript no lo
      // ve —un objeto con campos de más es asignable— y el tipo del cliente, que
      // declara sólo los tres, tampoco los borra del payload.
      aprobadores={aprobadores.map((a) => ({
        id: a.id, nombre: a.nombre, apellido: a.apellido,
      }))}
      odoo={dondeApuntaOdoo()}
      ordenesOdoo={(ordenesOdoo ?? []).map((o) => ({
        odooOrderId: o.odoo_order_id as number,
        odooNombre: (o.odoo_nombre ?? null) as string | null,
        porcentaje: o.porcentaje as number,
        // El embed llega como objeto o como arreglo según la relación, igual
        // que en `descripcionDelArticulo`.
        empresa: nombreDeEmpresa(o.empresas) ?? "—",
        // El número solo no alcanza: se repite entre instancias.
        enlace: enlaceAOdoo("purchase.order", o.odoo_order_id as number),
      }))}
      origenEnLaOT={origenEnLaOT}
      salidasDelPanol={salidasDelPanol}
      entradasAlPanol={(entradasAlPanol ?? []).map((e) => ({
        id: e.id as string,
        codigo: e.codigo as string | null,
        // El embed llega como objeto o como arreglo según cómo esté declarada
        // la relación, igual que en `empresaDelSector`. Se aceptan las dos.
        descripcion: descripcionDelArticulo(e.inventario_articulos),
        cantidad: Number(e.cantidad),
        fecha: e.fecha as string | null,
      }))}
    />
  );
}

const COLUMNAS_DE_SALIDA = "id, articulo_id, fecha, cantidad, solicitante, sector_raw, equipo_raw, tipo";

/** Un `.in()` con muchos ids arma una URL que PostgREST rechaza sin decir por qué. */
function enLotes<T>(lista: T[], tamano = 200): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < lista.length; i += tamano) lotes.push(lista.slice(i, i + tamano));
  return lotes;
}

/**
 * Las salidas candidatas de cada entrada y qué órdenes las declararon.
 *
 * **La lectura de los renglones es una consulta aparte, y degrada sola.** Nombra
 * `ordenes_trabajo_repuestos.movimiento_id`, que crea una migración que corre una
 * persona a mano: mientras no esté aplicada la consulta falla, y si esa columna
 * viajara dentro de las dos lecturas que hacen andar la ficha, **la ficha de
 * todos los RI dejaría de cargar**. Acá el fallo cuesta sólo esta parte, y se
 * dice en vez de afirmar «sin justificar»: sin poder leer qué se declaró, todas
 * las salidas parecerían no declaradas, que es una afirmación falsa.
 *
 * El `console.error` no es ruido: es la única parte de la ficha que puede fallar
 * por algo que alguien tiene que ver y resolver (correr la migración).
 */
async function leerLasSalidas(
  entradas: { articulo_id: string | null; fecha: string | null }[],
): Promise<SalidasDeLaFicha> {
  const admin = createAdminClient();

  // Una consulta por entrada: se filtra por artículo y fecha en la base porque
  // PostgREST corta en 1.000 filas sin avisar, igual que la ruta que ofrece las
  // candidatas en la OT. El orden (fecha desc, id) decide cuáles sobreviven al tope.
  const salidasPorId = new Map<string, SalidaDelPanol>();
  try {
    for (const entrada of entradas) {
      if (!entrada.articulo_id || !entrada.fecha) continue;
      const salidas = await traerTodo<SalidaDelPanol>((d, h) =>
        admin
          .from("inventario_movimientos")
          .select(COLUMNAS_DE_SALIDA)
          .eq("articulo_id", entrada.articulo_id!)
          .eq("tipo", "salida")
          .gte("fecha", entrada.fecha!)
          .order("fecha", { ascending: false })
          .order("id", { ascending: true })
          .range(d, h)
      );
      for (const s of salidasCandidatas(entrada, salidas)) salidasPorId.set(s.id, s);
    }
  } catch (e) {
    console.error("[ficha del RI] no se pudieron leer las salidas del pañol:", e);
    return { lectura: "fallida", salidas: [] };
  }
  // Mismo día no tiene orden (la fecha es un `date`); el sort es estable.
  const candidatas = [...salidasPorId.values()].sort((a, b) => (b.fecha ?? "").localeCompare(a.fecha ?? ""));
  if (candidatas.length === 0) return { lectura: "completa", salidas: [] };

  const sinDeclaraciones = (): SalidasDeLaFicha => ({
    lectura: "sin-las-declaraciones",
    salidas: candidatas.map((s) => ({
      id: s.id, fecha: s.fecha, cantidad: Number(s.cantidad), solicitante: s.solicitante,
      sector_raw: s.sector_raw, equipo_raw: s.equipo_raw, aplicadoA: [], otraPieza: [],
    })),
  });

  // La columna que apunta a la OT se llama `work_order_id` y no `ot_id`: la tabla
  // tiene siete columnas —`articulo_id, cantidad, codigo, created_at, id, nombre,
  // work_order_id`— y pedirle `ot_id` contesta 42703 por el camino del `error`,
  // sin excepción, así que el nombre equivocado no se nota más que por la
  // ausencia de la línea «aplicado a la OT #…».
  type Renglon = { work_order_id: string | null; articulo_id: string | null; movimiento_id: string | null };
  const renglones: Renglon[] = [];
  for (const lote of enLotes(candidatas.map((s) => s.id))) {
    const { data, error } = await admin
      .from("ordenes_trabajo_repuestos")
      .select("work_order_id, articulo_id, movimiento_id")
      .in("movimiento_id", lote);
    if (error || !data) {
      // Lo que dijo Postgres va primero: la hipótesis de la migración es sólo la
      // causa más probable (un 42703 por `movimiento_id`), y ponerla delante
      // mandaba a mirar una migración sana cuando el error era cualquier otro.
      console.error(
        "[ficha del RI] no se pudo leer qué renglones de repuesto declararon esas salidas:",
        error?.message,
        "— si dice que la columna `movimiento_id` no existe, falta aplicar su migración.",
      );
      return sinDeclaraciones();
    }
    renglones.push(...(data as Renglon[]));
  }

  const ordenes = new Map<string, { ot_number: number | null; descripcion: string | null }>();
  const otIds = [...new Set(renglones.map((r) => r.work_order_id).filter((x): x is string => !!x))];
  for (const lote of enLotes(otIds)) {
    const { data, error } = await admin.from("ordenes_trabajo").select("id, ot_number, descripcion").in("id", lote);
    if (error || !data) {
      console.error("[ficha del RI] no se pudieron leer las órdenes que declararon esas salidas:", error?.message);
      return sinDeclaraciones();
    }
    for (const o of data) {
      ordenes.set(o.id as string, {
        ot_number: (o.ot_number ?? null) as number | null,
        descripcion: (o.descripcion ?? null) as string | null,
      });
    }
  }

  const conNumero = renglones.map((r) => ({
    articulo_id: r.articulo_id,
    movimiento_id: r.movimiento_id,
    ot_number: (r.work_order_id ? ordenes.get(r.work_order_id)?.ot_number : null) ?? null,
  }));
  const descripcionDe = new Map<number, string | null>();
  for (const o of ordenes.values()) if (o.ot_number != null) descripcionDe.set(o.ot_number, o.descripcion);

  return {
    lectura: "completa",
    salidas: candidatas.map((s) => {
      const lectura = lecturaDeLaSalida(s, conNumero);
      return {
        id: s.id, fecha: s.fecha, cantidad: Number(s.cantidad), solicitante: s.solicitante,
        sector_raw: s.sector_raw, equipo_raw: s.equipo_raw,
        aplicadoA: lectura.aplicadoA.map((n) => ({ ot_number: n, descripcion: descripcionDe.get(n) ?? null })),
        otraPieza: lectura.otraPieza,
      };
    }),
  };
}

/** La descripción del artículo, venga el embed como objeto o como arreglo. */
function descripcionDelArticulo(embed: unknown): string | null {
  const uno = Array.isArray(embed) ? embed[0] : embed;
  return (uno as { descripcion?: string } | null)?.descripcion ?? null;
}

/** El nombre de la empresa, venga el embed como objeto o como arreglo. */
function nombreDeEmpresa(embed: unknown): string | null {
  const uno = Array.isArray(embed) ? embed[0] : embed;
  return (uno as { nombre?: string } | null)?.nombre ?? null;
}
