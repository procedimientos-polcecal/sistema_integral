import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarCompras } from "@/lib/compras/auth";
import { traerTodo } from "@/lib/core/paginado";
import { leerLinksDeComparativa, claveProveedor } from "@/lib/compras/sheets";
import { archivosPorHacer, idDePlanilla } from "@/lib/compras/vincular";
import { leerComparativa } from "@/lib/compras/drive";
import { mapearEncabezados, filasParaEsteRi, parsearFila } from "@/lib/compras/comparativa";

export const maxDuration = 300;

/**
 * Trae los presupuestos de las planillas de comparativa que la planilla de
 * PEDIDOS DE COMPRA tenía anotadas.
 *
 * El vínculo en sí —qué archivo es la comparativa de cada RI— ya lo trae cada
 * sincronización, que lee el hipervínculo escondido detrás del texto "LINK".
 * Lo que queda para acá es lo que no entra en una sincronización: abrir cada
 * planilla y leer sus filas. Son 219 archivos, y leerlos es una llamada a
 * Google por archivo.
 *
 * Se agrupa por ARCHIVO y no por requerimiento: muchos pedidos apuntan a la
 * misma planilla —son por artículo—, y leerla una vez por pedido serían cientos
 * de lecturas a Google que no entran en el tiempo de una request.
 *
 * NO se toca `comparativa_url`: esa columna dispara el trigger que marca el RI
 * como editado en la app —esta ruta no actualiza `sheets_sincronizado_en`, que
 * es lo que exime a la sincronización—, y además se exporta a la celda de la
 * planilla. El vínculo bueno es el id; la URL se deriva de él.
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
  /**
   * Planillas que se abrieron y no se pudieron leer como comparativa.
   *
   * Va aparte del recuento de problemas porque no se arregla apretando de
   * nuevo: alguien tiene que ponerle la columna de N° de RI a esa planilla. Sin
   * un número visible quedaba escondido en una lista que la pantalla recorta.
   */
  sin_forma_de_comparativa: number;
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
    comparativa_nombre: string | null;
  }>((desde, hasta) =>
    admin
      .from("compras_requerimientos")
      // El nombre dice si la planilla ya se abrió: sale de adentro del archivo.
      .select("id, nro_ri, comparativa_drive_id, comparativa_nombre")
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
    sin_forma_de_comparativa: 0,
    problemas: [],
  };

  // Qué requerimientos reclama cada archivo.
  const porArchivo = new Map<
    string,
    { id: string; nro_ri: number; yaVinculado: boolean; yaLeido: boolean }[]
  >();

  for (const r of requerimientos) {
    const link = links.get(r.nro_ri);
    if (!link) { res.sin_link += 1; continue; }

    res.requerimientos_con_link += 1;
    const driveId = idDePlanilla(link);
    if (!driveId) { res.link_no_es_planilla += 1; continue; }

    const lista = porArchivo.get(driveId) ?? [];
    lista.push({
      id: r.id,
      nro_ri: r.nro_ri,
      yaVinculado: r.comparativa_drive_id === driveId,
      yaLeido: r.comparativa_drive_id === driveId && r.comparativa_nombre !== null,
    });
    porArchivo.set(driveId, lista);
  }

  res.archivos_distintos = porArchivo.size;

  // Los que ya están vinculados y ya se abrieron no dan trabajo: se saltean para
  // que cada tanda avance sobre lo que falta. La regla vive en
  // `archivosPorHacer`, que es donde se prueba.
  const pendientes = archivosPorHacer(porArchivo, traerFilas);
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

    if (!mapeo.ok) {
      res.problemas.push(
        `RI ${ris.map((r) => r.nro_ri).join(", ")}: "${planilla.nombre}" no tiene la forma ` +
        `de una comparativa. Falta: ${mapeo.faltan.join("; ")}`
      );
      res.sin_forma_de_comparativa += 1;
    }

    for (const ri of ris) {
      if (!dryRun) {
        // El nombre se guarda cuando la planilla se pudo LEER como comparativa,
        // no cuando se pudo abrir. Es lo que marca el archivo como hecho —así lo
        // lee `archivosPorHacer`—, y estamparlo antes de saberlo dejó 31
        // requerimientos "leídos" con cero presupuestos: sus planillas no tienen
        // columna de N° de RI, así que no se pudo traer una sola fila, y como ya
        // figuraban hechas no volvían a la cola. Nadie iba a enterarse nunca.
        //
        // El id sí va siempre: el vínculo con el archivo es correcto igual, y es
        // de donde sale el link que muestra la ficha. `comparativa_url` no, que
        // dispara el trigger de editado_en_app y se exporta a la celda.
        await admin
          .from("compras_requerimientos")
          .update({
            comparativa_drive_id: driveId,
            ...(mapeo.ok ? { comparativa_nombre: planilla.nombre } : {}),
          })
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
        // Qué presupuesto estaba elegido, para no perderlo al reemplazar.
        //
        // Elegir uno ES aprobar la compra, así que borrarlos y reinsertarlos sin
        // la marca deja la compra aprobada sin decir sobre qué. La fila de la
        // planilla es lo que identifica al presupuesto entre una lectura y la
        // siguiente. Esto ya se había aprendido en la ruta de un RI —está en
        // COMPRAS-ESTADO— y acá había quedado sin hacer.
        const { data: previas } = await admin
          .from("compras_cotizaciones")
          .select("drive_fila, elegida")
          .eq("requerimiento_id", ri.id)
          .eq("origen", "drive");

        const elegidas = new Set(
          (previas ?? []).filter((p) => p.elegida).map((p) => p.drive_fila as number)
        );

        await admin
          .from("compras_cotizaciones")
          .delete()
          .eq("requerimiento_id", ri.id)
          .eq("origen", "drive");

        const { error } = await admin.from("compras_cotizaciones").insert(
          nuevas.map((n) => ({ ...n, elegida: elegidas.has(n.drive_fila as number) }))
        );
        if (error) res.problemas.push(`RI ${ri.nro_ri}: ${error.message}`);
      }
    }
  }

  return NextResponse.json(res);
}
