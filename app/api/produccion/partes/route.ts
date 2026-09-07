import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { indiceDeCatalogo, elQueNombra } from "@/lib/core/catalogo";
import { puedeEditarProduccion } from "@/lib/produccion/auth";
import { esTurno } from "@/lib/produccion/turnos";
import { armarElDia } from "@/lib/produccion/consultas";
import { espejarDia } from "@/lib/produccion/espejo";

/**
 * Guardar el parte de un turno, y exportar el día a la planilla.
 *
 * El espejo **no corre en segundo plano**. La regla del repo es que toda ruta
 * que toque un campo que se exporta tiene que exportar, y si no puede, dejar el
 * pendiente anotado: cambiar un número sin escribirlo en la planilla es una
 * divergencia que no avisa. Mandarlo a `after()` haría que su fallo terminara en
 * un log que nadie mira.
 *
 * Se exporta **el día entero**, no el turno: los resúmenes son diarios, y el
 * turno recién cargado cambia el total del día.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarProduccion(supabase, user.id))) {
    return NextResponse.json(
      { error: "Tu usuario no tiene nivel de edición en Producción" },
      { status: 403 }
    );
  }

  const b = await cuerpoJson(request);
  const fecha = String(b?.fecha ?? "").trim();
  const turno = b?.turno;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return NextResponse.json({ error: "La fecha tiene que ser YYYY-MM-DD" }, { status: 400 });
  }
  if (!esTurno(turno)) {
    return NextResponse.json({ error: "El turno tiene que ser 4_12 o 12_20" }, { status: 400 });
  }

  const admin = createAdminClient();
  const texto = (v: unknown) => String(v ?? "").trim() || null;
  const numero = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

  const deposito = Array.isArray(b?.deposito) ? b.deposito : [];
  const renglones = Array.isArray(b?.despachos) ? b.despachos : [];

  // ── 0. Validar los producto_id antes de escribir nada ──────
  // Un id que no existe en `produccion_productos` lo rechaza la FK con un error
  // de Postgres crudo, y sólo se entera después de haber borrado el depósito o
  // los despachos del parte (ver el punto 2 más abajo). Comprobar acá, contra
  // la lista real y no contra el catálogo activo —un parte viejo puede citar un
  // producto que después se dio de baja—, corta el pedido antes de tocar la
  // base y devuelve un mensaje que se entiende. Mismo patrón que
  // `solicitante_id` en `app/api/inventario/movimientos/route.ts`.
  const idsDeDeposito: (string | null)[] = deposito.map((d: { producto_id?: unknown }) => texto(d?.producto_id));
  const idsDeDespacho: (string | null)[] = renglones.map((d: Record<string, unknown>) => texto(d?.producto_id));
  const idsATestear = [...new Set([...idsDeDeposito, ...idsDeDespacho].filter((id): id is string => id !== null))];

  if (idsDeDeposito.some((id: string | null) => id === null)) {
    return NextResponse.json(
      { error: "Cada renglón del depósito necesita un producto" },
      { status: 400 }
    );
  }

  if (idsATestear.length > 0) {
    const { data: productosExistentes, error: errProductos } = await admin
      .from("produccion_productos")
      .select("id")
      .in("id", idsATestear);
    if (errProductos) {
      return NextResponse.json({ error: errProductos.message }, { status: 500 });
    }
    const existentes = new Set((productosExistentes ?? []).map((p) => p.id));
    const faltantes = idsATestear.filter((id) => !existentes.has(id));
    if (faltantes.length > 0) {
      return NextResponse.json(
        { error: `Estos productos no existen en el catálogo: ${faltantes.join(", ")}` },
        { status: 400 }
      );
    }
  }

  // ── 1. El capataz ──────────────────────────────────────────
  // Lo que dice el papel se guarda siempre. El enlace al empleado se resuelve
  // sólo si el nombre lo identifica **con certeza**: `elQueNombra` devuelve null
  // cuando no existe y también cuando dos empleados comparten nombre, y un
  // empate no resuelve a ninguno. Enlazar al que se le parece deja el dato en el
  // lugar que no es y no se nota nunca.
  const capatazRaw = texto(b?.capataz_raw);
  let capatazId = texto(b?.capataz_id);
  if (!capatazId && capatazRaw) {
    const { data: empleados } = await admin.from("empleados").select("id, nombre");
    capatazId = elQueNombra(indiceDeCatalogo(empleados ?? []), capatazRaw).id;
  }

  // ── 2. El parte ────────────────────────────────────────────
  // No es un upsert único a propósito. El esquema separa `cargado_por/en` de
  // `actualizado_por/en` justamente para poder corregir un parte sin perder
  // quién lo cargó la primera vez: un capataz transcribe otro papel para el
  // mismo turno, o alguien corrige un número mal tipeado. Un `upsert` que
  // manda `cargado_por: user.id` siempre pisa esas dos columnas en cada
  // corrección, y las cuatro terminan diciendo lo mismo — el rastro de quién
  // corrigió se pierde. Por eso se busca primero y se elige la rama.
  const { data: existente, error: errExistente } = await admin
    .from("produccion_partes")
    .select("id")
    .eq("fecha", fecha)
    .eq("turno", turno)
    .maybeSingle();
  if (errExistente) {
    return NextResponse.json({ error: errExistente.message }, { status: 500 });
  }

  const camposComunes = {
    capataz_raw: capatazRaw,
    capataz_id: capatazId,
    observaciones: texto(b?.observaciones),
    tareas_limpieza: texto(b?.tareas_limpieza),
    recuento_bolsones: texto(b?.recuento_bolsones),
  };

  const { data: parte, error: errParte } = existente
    ? await admin
        .from("produccion_partes")
        .update({
          ...camposComunes,
          actualizado_por: user.id,
          actualizado_en: new Date().toISOString(),
        })
        .eq("id", existente.id)
        .select("id")
        .single()
    : await admin
        .from("produccion_partes")
        .insert({
          fecha,
          turno,
          ...camposComunes,
          cargado_por: user.id,
        })
        .select("id")
        .single();

  if (errParte || !parte) {
    return NextResponse.json(
      { error: errParte?.message ?? "No se pudo guardar el parte" },
      { status: 500 }
    );
  }

  // ── 3. El depósito ─────────────────────────────────────────
  // Se reemplaza entero: el parte es la foto del papel, no un incremental.
  //
  // Se espera **una fila por producto activo**, aunque valga 0. El despeje lee
  // un producto ausente como cero, así que un producto que está en el depósito
  // del turno anterior y falta en éste da una producción negativa sin motivo
  // aparente. Quien garantiza eso es el formulario (tarea 14); acá no se
  // completa lo que falte, porque inventar filas sería inventar mediciones.
  //
  // El `delete` y el `insert` que siguen no van en una transacción — PostgREST
  // no da transacciones multi-sentencia. Si el `insert` fallara después del
  // `delete` (una violación de constraint que la comprobación de arriba no
  // haya cubierto, un corte de red), el parte quedaría sin depósito. Se acepta
  // sin implementar nada más: la respuesta 500 abajo incluye el `id` del parte
  // para que quien cargó sepa que hay que reintentar, y reintentar es
  // **idempotente** — el mismo payload vuelve a borrar (ya vacío) e insertar
  // entero, así que no hay estado intermedio que se acumule. La validación del
  // paso 0 ya descarta la causa de fallo más probable (un producto_id que no
  // existe) antes de llegar acá.
  const { error: errBorrarDeposito } = await admin
    .from("produccion_deposito")
    .delete()
    .eq("parte_id", parte.id);
  if (errBorrarDeposito) {
    return NextResponse.json({ id: parte.id, error: errBorrarDeposito.message }, { status: 500 });
  }

  if (deposito.length > 0) {
    const { error } = await admin.from("produccion_deposito").insert(
      deposito.map((d: { producto_id: string; cantidad: unknown }) => ({
        parte_id: parte.id,
        producto_id: d.producto_id,
        cantidad: Number(d.cantidad) || 0,
      }))
    );
    if (error) return NextResponse.json({ id: parte.id, error: error.message }, { status: 400 });
  }

  // ── 4. Los renglones de despacho ───────────────────────────
  // El orden se guarda tal como llega el arreglo: no hay otro dato de orden en
  // el papel más que la posición del renglón, y es el formulario (tarea 14)
  // quien garantiza que viaja en el orden en que está escrito. Si algún día un
  // cliente puede reordenar antes de guardar, el orden que mande es el que
  // corresponde grabar — no hay un "orden correcto" independiente que este
  // archivo pueda reconstruir.
  const { error: errBorrarDespachos } = await admin
    .from("produccion_despachos")
    .delete()
    .eq("parte_id", parte.id);
  if (errBorrarDespachos) {
    return NextResponse.json({ id: parte.id, error: errBorrarDespachos.message }, { status: 500 });
  }

  if (renglones.length > 0) {
    const { error } = await admin.from("produccion_despachos").insert(
      renglones.map((d: Record<string, unknown>, i: number) => ({
        parte_id: parte.id,
        orden: i + 1,
        equipo_raw: texto(d.equipo_raw),
        cliente_raw: texto(d.cliente_raw),
        // Puede venir en null a propósito: el renglón "Otros" del papel, o un
        // nombre que no se reconoció. El texto crudo se guarda igual.
        producto_id: texto(d.producto_id),
        producto_raw: texto(d.producto_raw),
        kilos: numero(d.kilos),
        bultos: numero(d.bultos),
        envase_raw: texto(d.envase_raw),
        pallets_cantidad: numero(d.pallets_cantidad),
        pallets_tipo: texto(d.pallets_tipo),
        rotura_bolsa: Number(d.rotura_bolsa) || 0,
        rotura_bolson: Number(d.rotura_bolson) || 0,
      }))
    );
    if (error) return NextResponse.json({ id: parte.id, error: error.message }, { status: 400 });
  }

  // ── 5. Exportar el día ─────────────────────────────────────
  // El día entero y no el turno: los resúmenes son diarios, y el turno recién
  // cargado cambia el total del día.
  const { productos, produccion, despacho, rotura } = await armarElDia(admin, fecha);
  const resultado = await espejarDia({ fecha, productos, produccion, despacho, rotura });

  await admin
    .from("produccion_partes")
    .update({
      sheets_pendiente: resultado.ok ? null : resultado.error,
      sheets_pendiente_en: resultado.ok ? null : new Date().toISOString(),
    })
    .eq("id", parte.id);

  return NextResponse.json({
    id: parte.id,
    // Los tres casos que le importan a quien consume esto: "escrita" (guardó y
    // exportó), "pendiente" (guardó, no exportó — ver `error_planilla`) y el
    // que no tiene `planilla` porque la respuesta nunca llegó acá: un `error`
    // sin `id` (no se guardó nada) o un `error` con `id` (se guardó el parte
    // pero el depósito o los despachos quedaron a medio escribir, casos 3 y 4).
    planilla: resultado.ok ? "escrita" : "pendiente",
    // Sin traducir y a la vista: quien cargó tiene que poder distinguir este
    // fallo de cualquier otro.
    error_planilla: resultado.ok ? null : resultado.error,
  });
}
