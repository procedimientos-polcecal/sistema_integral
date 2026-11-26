import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { es_admin_check } from "@/lib/core/route-utils";
import { traerTodo } from "@/lib/core/paginado";
import { leerVariosRangos, listarPestanas, letraDeColumna } from "@/lib/core/sheets";
import { esPestanaDeArea, indexarColumnas } from "@/lib/compras/sheets";
import { fichasCompuestas, gruposDeDuplicados } from "@/lib/core/duplicadosDeProveedor";
import { TABLAS_QUE_APUNTAN } from "@/lib/core/fusionDeProveedores";
import {
  contarNombresDeLaPlanilla,
  loQueDiceLaPlanilla,
  type NombreDeLaPlanilla,
} from "@/lib/compras/proveedoresDeLaPlanilla";

/**
 * Los proveedores cargados dos veces, con todo lo que hace falta para decidir
 * cuál queda. `GET /api/compras/proveedores/duplicados` — sólo admin.
 *
 * Es de sólo lectura: la fusión la hace `/api/compras/proveedores/fusionar`.
 * Van separadas por lo mismo que el cruce con Odoo tiene `preview` y
 * `enlazar`: lo que no se deshace se mira antes.
 *
 * ## Las tres cosas que trae, y por qué las tres
 *
 * 1. **Cuántas filas cuelgan de cada una**, por tabla. Es lo que se va a mover
 *    y lo que la pantalla usa para preguntar «esto mueve 258 filas, ¿seguro?».
 * 2. **Si está enlazada a Odoo.** Una fila enlazada es la que hoy puede
 *    generar una orden de compra.
 * 3. **Si la planilla de Compras la nombra.** Es *la* pregunta: la
 *    sincronización crea la fila que no encuentra por nombre, así que borrar
 *    una que la planilla nombra sólo consigue que vuelva vacía y sin CUIT.
 *
 * ## Por qué la planilla se lee «si se puede»
 *
 * Porque es un dato de otro sistema y la pantalla tiene que servir igual sin
 * él. Sin credenciales de Google —que es lo normal en local— devuelve
 * `planilla: null` con el motivo, y la pantalla lo dice en vez de mentir: sin
 * esa columna las dos primeras siguen alcanzando para los casos obvios.
 *
 * ## Por qué se leen las 19 tablas enteras
 *
 * Porque la pregunta es «cuántas filas por proveedor» para ~250 ids, y un
 * `.in()` con esa cantidad arma una URL que PostgREST rechaza con un 400 sin
 * decir por qué (CLAUDE.md). Son 19 lecturas de una columna, paginadas; la
 * más grande trae 2.138 filas.
 */

export const maxDuration = 60;

interface FilaDelGrupo {
  id: string;
  nombre: string;
  cuit: string | null;
  razon_social: string | null;
  activo: boolean;
  /** Filas que le cuelgan, por tabla. Sólo las que no son cero. */
  cuelgan: Record<string, number>;
  total: number;
  enlazadoAOdoo: boolean;
  /** `null` cuando no se pudo leer la planilla. */
  planilla: { laNombra: boolean; veces: number; ultimoRi: number } | null;
}

/**
 * Los nombres que escribe hoy la columna PROVEEDOR de las pestañas por área.
 *
 * Dos viajes a propósito: primero los encabezados, para preguntar **por el
 * nombre de la columna y no por la letra** —el mismo contenido ya se mudó de
 * lugar en este repo—, y después sólo esa columna de cada pestaña. Leer las
 * pestañas enteras serían 16 columnas por 10.000 filas para usar una.
 */
async function nombresDeLaPlanilla(): Promise<Map<string, NombreDeLaPlanilla>> {
  const id = process.env.GOOGLE_SHEETS_COMPRAS_ID ?? "";
  if (!id) throw new Error("GOOGLE_SHEETS_COMPRAS_ID no está configurado.");

  const pestanas = (await listarPestanas(id)).filter(esPestanaDeArea);
  if (!pestanas.length) throw new Error("La planilla no tiene ninguna pestaña por área.");

  const encabezados = await leerVariosRangos(
    id,
    pestanas.map((p) => `${p}!A1:Z1`)
  );

  const rangos: string[] = [];
  const dePestana: string[] = [];
  encabezados.forEach((filas, i) => {
    const columnas = indexarColumnas(filas[0] ?? []);
    const proveedor = columnas.proveedor;
    if (proveedor < 0) return;
    // `letraDeColumna` es 0-based: su primer renglón es `indice + 1`.
    const letra = letraDeColumna(proveedor);
    // La A va junto con la del proveedor para saber hasta qué RI se usó ese
    // nombre: un nombre que no aparece desde el RI 300 no es el que se escribe
    // hoy, y eso cambia cuál fila conviene dejar viva.
    rangos.push(`${pestanas[i]}!A2:A`, `${pestanas[i]}!${letra}2:${letra}`);
    dePestana.push(pestanas[i]);
  });

  const columnas = await leerVariosRangos(id, rangos);
  const celdas: { nombre: string; nroRi: string }[] = [];
  for (let i = 0; i < dePestana.length; i++) {
    const ris = columnas[i * 2] ?? [];
    const nombres = columnas[i * 2 + 1] ?? [];
    for (let f = 0; f < nombres.length; f++) {
      celdas.push({ nombre: nombres[f]?.[0] ?? "", nroRi: ris[f]?.[0] ?? "" });
    }
  }

  return contarNombresDeLaPlanilla(celdas);
}

export async function GET() {
  const supabase = await createClient();
  const noAutorizado = await es_admin_check(supabase);
  if (noAutorizado) return noAutorizado;

  const admin = createAdminClient();

  const proveedores = await traerTodo<{
    id: string;
    nombre: string;
    cuit: string | null;
    razon_social: string | null;
    activo: boolean;
  }>((desde, hasta) =>
    admin.from("proveedores").select("id, nombre, cuit, razon_social, activo").range(desde, hasta)
  );

  const grupos = gruposDeDuplicados(proveedores);
  /*
   * Las celdas con varios proveedores adentro van aparte y no como un grupo:
   * no son duplicados de nadie y fusionarlas no las saca, porque la planilla
   * las vuelve a crear mientras la celda diga lo mismo. Se muestran igual
   * porque son 19 fichas del padrón que no son proveedores.
   */
  const compuestas = fichasCompuestas(proveedores);
  const enGrupos = new Set([...grupos.flatMap((g) => g.ids), ...compuestas.map((f) => f.id)]);

  // Las 19 en paralelo: no dependen entre sí y la pantalla las necesita todas
  // para dibujarse una vez.
  const conteos = await Promise.all(
    TABLAS_QUE_APUNTAN.map(async ({ tabla }) => {
      const filas = await traerTodo<{ proveedor_id: string | null }>((desde, hasta) =>
        admin.from(tabla).select("proveedor_id").not("proveedor_id", "is", null).range(desde, hasta)
      );
      const porProveedor = new Map<string, number>();
      for (const f of filas) {
        if (!f.proveedor_id || !enGrupos.has(f.proveedor_id)) continue;
        porProveedor.set(f.proveedor_id, (porProveedor.get(f.proveedor_id) ?? 0) + 1);
      }
      return { tabla, porProveedor };
    })
  );

  let planilla: Map<string, NombreDeLaPlanilla> | null = null;
  let porQueNoSeLeyo: string | null = null;
  try {
    planilla = await nombresDeLaPlanilla();
  } catch (e) {
    // El motivo se dice tal cual lo dio Google: un diagnóstico que no se
    // distingue de otro no es un diagnóstico.
    porQueNoSeLeyo = e instanceof Error ? e.message : String(e);
  }

  const porId = new Map(proveedores.map((p) => [p.id, p]));

  const salida = grupos.map((grupo) => {
    const filas = grupo.ids.map((id) => porId.get(id)!).filter(Boolean);
    const dice = planilla ? loQueDiceLaPlanilla(filas, planilla) : null;

    const conSusDatos: FilaDelGrupo[] = filas.map((p) => {
      const cuelgan: Record<string, number> = {};
      let total = 0;
      for (const { tabla, porProveedor } of conteos) {
        const n = porProveedor.get(p.id) ?? 0;
        if (n > 0) { cuelgan[tabla] = n; total += n; }
      }
      return {
        id: p.id,
        nombre: p.nombre,
        cuit: p.cuit,
        razon_social: p.razon_social,
        activo: p.activo,
        cuelgan,
        total,
        enlazadoAOdoo: (cuelgan["proveedores_odoo"] ?? 0) > 0,
        planilla: dice ? dice.porFila[p.id] : null,
      };
    });

    return {
      motivo: grupo.motivo,
      clave: grupo.clave,
      /**
       * Cuántos nombres **distintos** del grupo escribe la planilla. Dos o más
       * quiere decir que la fila que se borre vuelve: hay que unificar la celda
       * de allá primero. `null` si no se pudo leer la planilla.
       */
      nombresEnLaPlanilla: dice ? dice.nombresDistintos : null,
      filas: conSusDatos,
    };
  });

  const celdasConVarios = compuestas.map((f) => {
    const cuelgan: Record<string, number> = {};
    let total = 0;
    for (const { tabla, porProveedor } of conteos) {
      const n = porProveedor.get(f.id) ?? 0;
      if (n > 0) { cuelgan[tabla] = n; total += n; }
    }
    return { ...f, cuelgan, total };
  });

  return NextResponse.json({
    grupos: salida,
    celdasConVarios,
    padron: proveedores.length,
    planillaLeida: planilla !== null,
    porQueNoSeLeyoLaPlanilla: porQueNoSeLeyo,
  });
}
