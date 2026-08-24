import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarCompras } from "@/lib/compras/auth";
import { traerTodo } from "@/lib/core/paginado";
import { leerLinksDeComparativa, claveProveedor } from "@/lib/compras/sheets";
import { idDePlanilla } from "@/lib/compras/vincular";
import { leerComparativa } from "@/lib/compras/drive";
import { mapearEncabezados, filasParaEsteRi, parsearFila } from "@/lib/compras/comparativa";

export const maxDuration = 300;

/**
 * Vincula cada requerimiento con la planilla de comparativa que la planilla de
 * PEDIDOS DE COMPRA ya tenía anotada, y trae sus presupuestos.
 *
 * El link vivía escondido detrás del texto "LINK" de la celda, así que nunca
 * había llegado al sistema. Esto lo rescata en tanda en vez de obligar a
 * pegarlo de nuevo uno por uno.
 *
 * Se agrupa por ARCHIVO y no por requerimiento: muchos pedidos apuntan a la
 * misma planilla —son por artículo—, y leerla una vez por pedido serían cientos
 * de lecturas a Google que no entran en el tiempo de una request.
 *
 * NO se toca `comparativa_url`: esa columna dispara el trigger que marca el RI
 * como editado en la app, y escribirla en tanda sacaría a todos de la
 * sincronización. El vínculo bueno es el id; la URL se deriva de él.
 */

/** Cuántos archivos distintos se procesan por llamada, para no pasarse del tiempo. */
const ARCHIVOS_POR_TANDA = 20;

interface Resultado {
  dry_run: boolean;
  requerimientos_con_link: number;
  archivos_distintos: number;
  archivos_procesados: number;
  archivos_restantes: number;
  vinculados: number;
  presupuestos: number;
  sin_link: number;
  link_no_es_planilla: number;
  problemas: string[];
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarCompras(supabase, user.id))) {
    return NextResponse.json({ error: "No tenés permiso para gestionar la compra" }, { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const dryRun = params.get("aplicar") !== "1";
  const traerFilas = params.get("filas") === "1";

  const admin = createAdminClient();

  // El padrón de proveedores, una vez: adentro del bucle serían cientos de
  // consultas para resolver los mismos nombres.
  const { data: proveedores } = await admin.from("proveedores").select("id, nombre");
  const porNombre = new Map(
    (proveedores ?? []).map((p) => [claveProveedor(p.nombre), p.id as string])
  );

  // Los requerimientos que todavía tiene sentido enlazar: los aprobados que no
  // se cerraron. Un denegado o un recibido no se va a volver a mirar.
  const requerimientos = await traerTodo<{
    id: string;
    nro_ri: number;
    comparativa_drive_id: string | null;
  }>((desde, hasta) =>
    admin
      .from("compras_requerimientos")
      .select("id, nro_ri, comparativa_drive_id")
      .eq("estado_aprobacion", "APROBADA")
      .in("estado_compra", ["SIN_INICIAR", "EN_COMPARATIVA", "PARA_COMPRAR", "APROBADO", "PEDIDO"])
      .range(desde, hasta)
  );

  let links: Map<number, string>;
  try {
    links = await leerLinksDeComparativa();
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }

  const res: Resultado = {
    dry_run: dryRun,
    requerimientos_con_link: 0,
    archivos_distintos: 0,
    archivos_procesados: 0,
    archivos_restantes: 0,
    vinculados: 0,
    presupuestos: 0,
    sin_link: 0,
    link_no_es_planilla: 0,
    problemas: [],
  };

  // Qué requerimientos reclama cada archivo.
  const porArchivo = new Map<string, { id: string; nro_ri: number; yaVinculado: boolean }[]>();

  for (const r of requerimientos) {
    const link = links.get(r.nro_ri);
    if (!link) { res.sin_link += 1; continue; }

    res.requerimientos_con_link += 1;
    const driveId = idDePlanilla(link);
    if (!driveId) { res.link_no_es_planilla += 1; continue; }

    const lista = porArchivo.get(driveId) ?? [];
    lista.push({ id: r.id, nro_ri: r.nro_ri, yaVinculado: r.comparativa_drive_id === driveId });
    porArchivo.set(driveId, lista);
  }

  res.archivos_distintos = porArchivo.size;

  // Los que ya están vinculados y sin filas que traer no dan trabajo: se saltean
  // para que cada tanda avance sobre lo que falta.
  const pendientes = [...porArchivo.entries()].filter(
    ([, ris]) => traerFilas || ris.some((r) => !r.yaVinculado)
  );
  const tanda = pendientes.slice(0, ARCHIVOS_POR_TANDA);
  res.archivos_restantes = Math.max(pendientes.length - tanda.length, 0);

  for (const [driveId, ris] of tanda) {
    res.archivos_procesados += 1;

    let planilla;
    try {
      planilla = await leerComparativa(driveId);
    } catch (e) {
      res.problemas.push(
        `RI ${ris.map((r) => r.nro_ri).join(", ")}: no se pudo leer la planilla — ` +
        (e instanceof Error ? e.message : String(e))
      );
      continue;
    }

    const mapeo = mapearEncabezados(planilla.encabezado);

    for (const ri of ris) {
      if (!dryRun) {
        // Sólo el id y el nombre: `comparativa_url` dispara el trigger de
        // editado_en_app y los sacaría a todos de la sincronización.
        await admin
          .from("compras_requerimientos")
          .update({ comparativa_drive_id: driveId, comparativa_nombre: planilla.nombre })
          .eq("id", ri.id);
      }
      res.vinculados += 1;

      if (!traerFilas || !mapeo.ok) continue;

      const { propias } = filasParaEsteRi(planilla.filas, mapeo.idx.nro_ri, ri.nro_ri);
      if (propias.length === 0) continue;

      const nuevas: Record<string, unknown>[] = [];
      for (const { fila, numeroFila } of propias) {
        const leida = parsearFila(fila, mapeo.idx);
        if (!leida) continue;

        const proveedorId = porNombre.get(claveProveedor(leida.proveedor_nombre));
        if (!proveedorId) continue;

        const { proveedor_nombre: _n, ...campos } = leida;
        nuevas.push({
          ...campos,
          requerimiento_id: ri.id,
          proveedor_id: proveedorId,
          origen: "drive",
          drive_fila: numeroFila,
          created_by: user.id,
        });
      }

      if (nuevas.length === 0) continue;
      res.presupuestos += nuevas.length;

      if (!dryRun) {
        await admin
          .from("compras_cotizaciones")
          .delete()
          .eq("requerimiento_id", ri.id)
          .eq("origen", "drive");

        const { error } = await admin.from("compras_cotizaciones").insert(nuevas);
        if (error) res.problemas.push(`RI ${ri.nro_ri}: ${error.message}`);
      }
    }
  }

  return NextResponse.json(res);
}
