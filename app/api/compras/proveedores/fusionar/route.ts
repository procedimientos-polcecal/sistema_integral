import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { es_admin_check } from "@/lib/core/route-utils";
import { auditar, nombreParaAuditoria } from "@/lib/core/auditoria";
import {
  TABLAS_QUE_APUNTAN,
  camposQueSeMudan,
  problemaParaFusionar,
  type FilaDelPadron,
} from "@/lib/core/fusionDeProveedores";

/**
 * Fusionar filas duplicadas del padrón de proveedores.
 * `POST /api/compras/proveedores/fusionar` — sólo admin.
 *
 * Body: `{ "queda": "<uuid>", "seVan": ["<uuid>", …] }`.
 *
 * ── POR QUÉ SÓLO ADMIN ──────────────────────────────────────
 *
 * Porque `proveedores` es catálogo del **núcleo** y le apuntan 19 tablas de
 * seis módulos. Una fusión mal hecha no rompe Compras: re-apunta los
 * requerimientos, las facturas, los partes de contratista y el kardex de
 * Inventario de una empresa a otra. Es el mismo criterio que el cruce masivo
 * con Odoo, que también es del núcleo y también es admin.
 *
 * ── EL ORDEN DE LAS ESCRITURAS, QUE NO ES CASUAL ────────────
 *
 * No hay transacción: PostgREST no tiene una, así que lo que se elige es **en
 * qué estado queda si falla a la mitad**. El orden es:
 *
 *   1. el registro de auditoría —antes de tocar nada; si no entra, no se
 *      fusiona, igual que el borrado de espejo—;
 *   2. mover las 19 tablas;
 *   3. borrar la fila que se va;
 *   4. **recién ahí** escribirle a la que queda el CUIT y lo demás.
 *
 * El 4 va último a propósito. Al revés —escribir el CUIT y después borrar— un
 * fallo en el borrado deja **dos filas con el mismo CUIT**, y eso es peor que
 * no haber hecho nada: `cruzarProveedores()` no enlaza ningún CUIT repetido,
 * así que se habrían desconectado las dos. Con este orden, un fallo a mitad de
 * camino deja a la que se va vacía y viva, que es exactamente el estado de
 * antes, y la operación se puede repetir.
 *
 * Si falla el paso 4 el CUIT no se pierde: está en el `contexto` de la fila de
 * auditoría, que ya se escribió. La respuesta lo dice con todas las letras.
 *
 * ── LOS CHOQUES ─────────────────────────────────────────────
 *
 * Dos tablas tienen una clave única donde `proveedor_id` es sólo la mitad, así
 * que la fila de la que se va puede no entrar: el mismo requerimiento con los
 * dos proveedores invitados (3 casos medidos el 26/11/2026) y el mismo enlace
 * a Odoo en la misma empresa (5 casos). En las dos, la fila duplicada no dice
 * nada que la otra no diga, así que se borra.
 *
 * Y dos donde `proveedor_id` **es** la clave primaria entera —`cantera_contratistas`
 * y `despacho_recepcion_proveedores`—, o sea que la fila lleva datos propios y
 * borrarla los pierde. Ahí se frena antes de escribir nada y lo decide una
 * persona. Hoy esas tablas tienen 2 y 10 filas, así que el caso es casi
 * imposible; cuando pase, va a pasar con datos adentro.
 */

export const maxDuration = 120;

const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const supabase = await createClient();
  const noAutorizado = await es_admin_check(supabase);
  if (noAutorizado) return noAutorizado;

  const cuerpo = (await request.json().catch(() => null)) as
    | { queda?: unknown; seVan?: unknown }
    | null;

  const queda = typeof cuerpo?.queda === "string" ? cuerpo.queda : "";
  const seVan = Array.isArray(cuerpo?.seVan) ? cuerpo.seVan.filter((x) => typeof x === "string") : [];

  if (!ES_UUID.test(queda) || !seVan.length || !seVan.every((id) => ES_UUID.test(id as string))) {
    return NextResponse.json(
      { error: "Hace falta «queda» con un id y «seVan» con al menos uno." },
      { status: 400 }
    );
  }
  if (seVan.includes(queda)) {
    return NextResponse.json({ error: "La que queda no puede estar también entre las que se van." }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: filas, error: errorDeLectura } = await admin
    .from("proveedores")
    .select("*")
    .in("id", [queda, ...(seVan as string[])]);

  if (errorDeLectura) {
    return NextResponse.json({ error: `No se pudo leer el padrón: ${errorDeLectura.message}` }, { status: 503 });
  }

  const porId = new Map((filas ?? []).map((f) => [f.id as string, f as FilaDelPadron]));
  const laQueQueda = porId.get(queda);
  if (!laQueQueda) return NextResponse.json({ error: "No existe el proveedor que queda." }, { status: 404 });

  const lasQueSeVan: FilaDelPadron[] = [];
  for (const id of seVan as string[]) {
    const fila = porId.get(id);
    if (!fila) return NextResponse.json({ error: `No existe el proveedor ${id}.` }, { status: 404 });
    const problema = problemaParaFusionar(laQueQueda, fila);
    if (problema) return NextResponse.json({ error: problema }, { status: 409 });
    lasQueSeVan.push(fila);
  }

  /*
   * Primero se pregunta por los choques que frenan, sobre TODAS las filas, y
   * recién después se escribe. Frenar a mitad de una tanda dejaría la primera
   * fusionada y la segunda no, que es el peor de los estados: el que nadie
   * sabe en cuál quedó.
   */
  const frenan = TABLAS_QUE_APUNTAN.filter((t) => t.choque?.que === "frenar");
  for (const { tabla } of frenan) {
    const { data: delQueQueda } = await admin.from(tabla).select("proveedor_id").eq("proveedor_id", queda);
    if (!delQueQueda?.length) continue;
    for (const fila of lasQueSeVan) {
      const { data: suyas } = await admin.from(tabla).select("proveedor_id").eq("proveedor_id", fila.id);
      if (suyas?.length) {
        return NextResponse.json(
          {
            error:
              `Las dos filas tienen datos propios en «${tabla}», donde el proveedor es la clave: ` +
              `fusionarlas perdería los de «${fila.nombre}». Resolvelo ahí primero.`,
          },
          { status: 409 }
        );
      }
    }
  }

  const { data: { user } } = await supabase.auth.getUser();
  const { data: quien } = await supabase
    .from("usuarios")
    .select("nombre, apellido, email")
    .eq("id", user!.id)
    .maybeSingle();

  const hechas: { nombre: string; movidas: Record<string, number> }[] = [];
  const avisos: string[] = [];

  for (const fila of lasQueSeVan) {
    // Qué cuelga de ella, antes de moverlo: es lo que el registro de auditoría
    // tiene que decir, porque después la fila no existe.
    const cuelgan: Record<string, number> = {};
    for (const { tabla } of TABLAS_QUE_APUNTAN) {
      const { count } = await admin
        .from(tabla)
        .select("proveedor_id", { count: "exact", head: true })
        .eq("proveedor_id", fila.id);
      if (count) cuelgan[tabla] = count;
    }

    const registro = await auditar(supabase, {
      modulo: "compras",
      entidad: "proveedores",
      entidadId: fila.id,
      accion: "borrar",
      usuario: { id: user!.id, nombre: nombreParaAuditoria(quien) },
      valorAnterior: `${fila.nombre}${fila.cuit ? ` (${fila.cuit})` : ""}`,
      valorNuevo: `${laQueQueda.nombre}${laQueQueda.cuit ? ` (${laQueQueda.cuit})` : ""}`,
      motivo: "Fusión de duplicados del padrón",
      contexto: {
        // Todo lo que hace falta para rehacer la fila si la fusión estuvo mal:
        // es lo único que va a quedar de ella.
        fusionada_en: laQueQueda.id,
        nombre: fila.nombre,
        cuit: fila.cuit ?? null,
        razon_social: fila.razon_social ?? null,
        filas_movidas: cuelgan,
      },
    });
    if (!registro.ok) {
      return NextResponse.json(
        { error: `No se pudo registrar la fusión y por eso no se hizo: ${registro.error}`, hechas },
        { status: 503 }
      );
    }

    // 2. mover las 19 tablas, resolviendo antes los choques conocidos.
    const movidas: Record<string, number> = {};
    for (const { tabla, choque } of TABLAS_QUE_APUNTAN) {
      if (choque?.que === "borrar" && choque.columna) {
        const columna = choque.columna;
        const [{ data: suyas }, { data: delQueQueda }] = await Promise.all([
          admin.from(tabla).select(columna).eq("proveedor_id", fila.id),
          admin.from(tabla).select(columna).eq("proveedor_id", queda),
        ]);
        // La columna es dinámica —`requerimiento_id` o `empresa_id`—, así que
        // el tipado del `select` no la puede seguir. Las dos están en
        // `TABLAS_QUE_APUNTAN`, que es una constante de este repo y no entrada
        // de nadie: no hay un nombre de columna inventado que pueda llegar acá.
        const valorDe = (f: unknown) => (f as Record<string, unknown>)[columna];
        const ocupadas = new Set((delQueQueda ?? []).map(valorDe));
        const chocan = (suyas ?? []).map(valorDe).filter((v) => ocupadas.has(v));
        for (const valor of chocan) {
          const { error } = await admin
            .from(tabla)
            .delete()
            .eq("proveedor_id", fila.id)
            .eq(columna, valor as string);
          if (error) avisos.push(`${tabla}: no se pudo sacar la fila repetida (${error.message}).`);
        }
      }

      const { error, count } = await admin
        .from(tabla)
        .update({ proveedor_id: queda }, { count: "exact" })
        .eq("proveedor_id", fila.id);

      if (error) {
        return NextResponse.json(
          {
            error:
              `Se cortó moviendo «${tabla}»: ${error.message}. La fila «${fila.nombre}» NO se borró, ` +
              "así que el padrón quedó como antes y se puede volver a intentar.",
            hechas,
          },
          { status: 503 }
        );
      }
      if (count) movidas[tabla] = count;
    }

    // 3. recién con todo movido, borrar.
    const { error: errorDeBorrado } = await admin.from("proveedores").delete().eq("id", fila.id);
    if (errorDeBorrado) {
      return NextResponse.json(
        {
          error:
            `Se movieron las filas pero no se pudo borrar «${fila.nombre}»: ${errorDeBorrado.message}. ` +
            "Quedó vacía; volvé a intentar la fusión.",
          hechas,
        },
        { status: 503 }
      );
    }

    hechas.push({ nombre: fila.nombre, movidas });
  }

  /*
   * 4. Y al final, lo que la que queda no tenía. Va último porque escribir el
   * CUIT antes de borrar deja dos filas con el mismo, que es peor que no haber
   * empezado.
   */
  let camposMudados: string[] = [];
  const cambios: Record<string, unknown> = {};
  for (const fila of lasQueSeVan) Object.assign(cambios, camposQueSeMudan({ ...laQueQueda, ...cambios }, fila));

  if (Object.keys(cambios).length) {
    const { error } = await admin.from("proveedores").update(cambios).eq("id", queda);
    if (error) {
      return NextResponse.json(
        {
          error:
            `Las filas se movieron y los duplicados se borraron, pero no se pudo escribirle ` +
            `${Object.keys(cambios).join(", ")} a «${laQueQueda.nombre}»: ${error.message}. ` +
            "Los valores están en el registro de auditoría de esta fusión.",
          hechas,
        },
        { status: 503 }
      );
    }
    camposMudados = Object.keys(cambios);
  }

  return NextResponse.json({
    queda: { id: queda, nombre: laQueQueda.nombre },
    fusionadas: hechas,
    camposMudados,
    avisos,
  });
}
