import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { permisosComprasDe } from "@/lib/compras/auth";
import { exportarRequerimiento, nuevoCacheSheets } from "@/lib/compras/sheets";
import { exportarSeguimiento } from "@/lib/compras/seguimientoSheets";
import { repartirSegunPuedenPasar, type RiParaMover } from "@/lib/compras/pasarAComparativa";

/**
 * Poner varios pedidos aprobados a juntar presupuestos, de una sola vez.
 *
 * El porqué —y lo que esta acción le hace a la planilla— está en
 * [lib/compras/pasarAComparativa.ts](../../../../../lib/compras/pasarAComparativa.ts).
 * Acá está lo que no se puede testear sin la base: el permiso, el guardado, el
 * historial y las dos exportaciones.
 *
 * ── POR QUÉ LA PLANILLA NO SE ESCRIBE ENTERA EN ESTA LLAMADA ────────────────
 *
 * Porque no entra, y eso está medido del lado del reintento que ya existe:
 * `reintentarPendientes` hace **cinco** requerimientos por corrida y espera un
 * segundo entre cada uno, porque «la cuota es por minuto y ocho escrituras
 * seguidas por cada uno la agotan en ráfaga». Un pedido que pasa a comparativa
 * se lleva la aprobación y las dos columnas a mano del master más las de
 * compra en la hoja de su área: del orden de media docena de escrituras. Por
 * sesenta pedidos son cientos, y la tanda moriría a mitad de camino dejando la
 * planilla contando una historia distinta de la de la base.
 *
 * Así que el orden es **cola primero, escritura después**:
 *
 * 1. se guarda el estado nuevo de todos, en un solo `update`;
 * 2. se les deja `sheets_pendiente` puesto a todos, antes de tocar Google;
 * 3. se exportan de a uno hasta donde alcance el presupuesto de tiempo, y cada
 *    exportación que sale bien **borra su propio pendiente** —eso ya lo hace
 *    `exportarRequerimiento` al final—.
 *
 * El paso 2 es lo que hace que esto sea seguro si la función muere: lo que no
 * se llegó a escribir queda en la cola que el cron de `compras-sync` drena
 * cada diez minutos. Al revés —exportar y encolar después— un corte dejaría
 * pedidos cambiados en la base, sin escribir en la planilla y sin nadie
 * anotado para reintentarlo, que es la divergencia que no avisa.
 */

export const maxDuration = 300;

/** Cuántos se exportan en la llamada antes de dejarle el resto a la cola. */
const EXPORTAR_AHORA = 10;

/**
 * Cuánto tiempo se le da a la exportación, en milisegundos.
 *
 * Deja un margen sobre `maxDuration` para que la respuesta salga igual: si el
 * tiempo se acaba, lo que falta ya está encolado y el cron lo levanta. Es la
 * misma idea que `esperasQueEntran` del cuaderno de contratistas — recortar lo
 * que queda en vez de que la ruta se corte sin contestar.
 */
const PRESUPUESTO_MS = 200_000;

/** Entre un pedido y el siguiente, por la cuota por minuto de Sheets. */
const RESPIRO_MS = 1000;

/** Tope de la tanda. Sesenta y dos esperan hoy; cien da aire sin ser infinito. */
const MAXIMO = 100;

export async function POST(request: Request) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("nombre, apellido, activo")
    .eq("id", user.id)
    .single();
  if (!usuario?.activo) return NextResponse.json({ error: "Usuario desactivado" }, { status: 403 });

  // El mismo permiso que gestionar la compra de un pedido suelto: mover a
  // comparativa es gestionar la compra, nada más que de varios a la vez.
  const permisos = await permisosComprasDe(supabase, user.id);
  if (!permisos.puedeEditar) {
    return NextResponse.json({ error: "No tenés permiso para gestionar la compra" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const ids = Array.isArray(body?.ids) ? body.ids.filter((x: unknown) => typeof x === "string") : [];

  if (ids.length === 0) {
    return NextResponse.json({ error: "No se eligió ningún pedido" }, { status: 400 });
  }
  if (ids.length > MAXIMO) {
    return NextResponse.json(
      { error: `De a ${MAXIMO} como mucho: la planilla no aguanta más en una tanda.` },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // Un solo `in()` con hasta 100 ids: muy por debajo del largo de URL que
  // PostgREST rechaza con un 400 mudo, que empieza a morder en los centenares.
  const { data: candidatos, error: errorLectura } = await admin
    .from("compras_requerimientos")
    .select("id, nro_ri, estado_compra, estado_aprobacion")
    .in("id", ids);

  if (errorLectura) {
    return NextResponse.json({ error: errorLectura.message }, { status: 400 });
  }

  const { pasan, noPasan } = repartirSegunPuedenPasar((candidatos ?? []) as RiParaMover[]);

  // Un id que no existe no es lo mismo que uno que no puede pasar, y callarlo
  // haría que las cuentas no cierren contra lo que la persona seleccionó.
  const encontrados = new Set((candidatos ?? []).map((r) => r.id as string));
  const inexistentes = ids.filter((id: string) => !encontrados.has(id)).length;

  if (pasan.length === 0) {
    return NextResponse.json(
      { movidos: 0, noPasan, inexistentes, error: "Ninguno de los elegidos puede pasar a comparativa" },
      { status: 409 }
    );
  }

  const idsQuePasan = pasan.map((r) => r.id);

  // El sello se toma **antes** del update: es lo que después distingue la fila
  // que el trigger va a crear de toda la historia anterior del pedido.
  const antesDeMover = new Date().toISOString();

  // ── 1. El estado, de una ───────────────────────────────────
  //
  // El `eq("estado_compra", "SIN_INICIAR")` repite lo que ya decidió
  // `repartirSegunPuedenPasar`, y no sobra: entre la lectura de arriba y este
  // update puede haber pasado otra sesión moviendo el mismo pedido. Así el
  // perdedor de esa carrera no escribe nada en vez de pisar.
  const { data: movidos, error } = await admin
    .from("compras_requerimientos")
    .update({ estado_compra: "EN_COMPARATIVA" })
    .in("id", idsQuePasan)
    .eq("estado_compra", "SIN_INICIAR")
    .select("id, nro_ri");

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const idsMovidos = (movidos ?? []).map((r) => r.id as string);
  if (idsMovidos.length === 0) {
    return NextResponse.json(
      { movidos: 0, noPasan, inexistentes, error: "Otra sesión los movió primero" },
      { status: 409 }
    );
  }

  const nombreUsuario = `${usuario.nombre} ${usuario.apellido}`.trim();

  // ── 2. El historial, con autor ─────────────────────────────
  //
  // El trigger ya dejó la fila del cambio de estado; acá se le pone quién fue.
  // La nota dice que vino de una tanda porque desde la fila sola no se puede
  // saber, y es lo que explica que sesenta pedidos se muevan en el mismo
  // segundo.
  //
  // ── POR QUÉ NO ALCANZA CON `.is("usuario_id", null)` ──
  //
  // El PATCH de un pedido suelto filtra por eso y por el RI, y acá parecía
  // natural cambiar el `eq` por un `in`. No lo es: **4.032 de las 4.180 filas
  // del historial no tienen autor** —las escribe la sincronización de la
  // planilla—, así que un `in` sobre sesenta y dos pedidos no toca la fila que
  // el trigger acaba de crear sino toda su historia anterior. Medido el
  // 27/11/2026: serían **57 filas viejas** firmadas con este nombre y con la
  // nota de la tanda, y 56 de ellas son cambios de `estado_aprobacion`, o sea
  // justo el registro de quién aprobó cada pedido.
  //
  // Por eso las tres condiciones: el campo que cambió, el valor al que fue, y
  // haber nacido después de que esta tanda empezara.
  const { error: errorHistorial } = await admin
    .from("compras_historial")
    .update({
      usuario_id: user.id,
      usuario_nombre: nombreUsuario,
      nota: "Pasado a comparativa en tanda",
    })
    .in("requerimiento_id", idsMovidos)
    .eq("campo", "estado_compra")
    .eq("valor_nuevo", "EN_COMPARATIVA")
    .gte("created_at", antesDeMover)
    .is("usuario_id", null);

  // No rompe: el cambio ya está guardado y el historial tiene la fila, sin
  // autor. Es la misma regla que la planilla y la auditoría en el PATCH.
  if (errorHistorial) {
    console.error("No se pudo ponerle autor al historial de la tanda:", errorHistorial.message);
  }

  // ── 3. La cola, antes de tocar Google ──────────────────────
  const PENDIENTE = "Pasado a comparativa en tanda: falta escribirlo en la planilla";
  await admin
    .from("compras_requerimientos")
    .update({ sheets_pendiente: PENDIENTE, sheets_intentado_en: null })
    .in("id", idsMovidos);

  // ── 4. Lo que entre, a la planilla ─────────────────────────
  const cache = nuevoCacheSheets();
  const arranque = Date.now();
  const bloqueadas: string[] = [];
  let escritos = 0;

  for (const [i, id] of idsMovidos.slice(0, EXPORTAR_AHORA).entries()) {
    if (Date.now() - arranque > PRESUPUESTO_MS) break;
    if (i > 0) await new Promise((r) => setTimeout(r, RESPIRO_MS));

    try {
      // El cache se comparte entre los dos: buscar la fila de un pedido lee la
      // columna de N° del master —1.885 filas— y **ninguno de los 62 tiene el
      // master como hoja de origen**, así que todos la necesitan. Con el cache
      // esa lectura se hace una vez para la tanda entera.
      const { bloqueadas: suyas } = await exportarRequerimiento(id, cache);
      if (suyas.length > 0) {
        const nro = (movidos ?? []).find((r) => r.id === id)?.nro_ri;
        bloqueadas.push(`RI ${nro ?? id}: ${suyas.join(", ")}`);
      } else {
        escritos++;
      }
    } catch (e) {
      console.error(`No se pudo escribir el RI ${id} en la planilla:`, e);
    }

    // El libro de seguimiento es otro y tiene su propia cola, así que un fallo
    // acá no ensucia el pendiente del master ni al revés. Mismo criterio que
    // el PATCH de un pedido.
    try {
      await exportarSeguimiento(id);
    } catch (e) {
      console.error(`No se pudo escribir el seguimiento del RI ${id}:`, e);
    }
  }

  const enCola = idsMovidos.length - escritos;

  return NextResponse.json({
    movidos: idsMovidos.length,
    escritosEnLaPlanilla: escritos,
    enCola,
    bloqueadas,
    noPasan,
    inexistentes,
  });
}
