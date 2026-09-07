import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { traerTodo } from "@/lib/core/paginado";
import { indiceDeEmpleados, reconocer } from "@/lib/inventario/enlaces";
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

/**
 * Si la fecha (ya validada por el regex de abajo) es una fecha real.
 *
 * El regex sólo comprueba la forma: "2026-02-31" y "2026-13-01" lo pasan igual,
 * y quien los rechaza es Postgres, con un error crudo que no dice cuál de los
 * dos números está mal.
 */
function esFechaReal(fecha: string): boolean {
  const [anio, mes, dia] = fecha.split("-").map(Number);
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  return d.getUTCFullYear() === anio && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

// Topes al tamaño del cuerpo, no al catálogo: el paso 0 valida los
// `producto_id` con un `.in()` contra `produccion_productos`, y esa consulta
// es la que PostgREST rechaza con un 400 sin explicar por qué cuando la URL
// junta demasiados ids (ver la regla del repo sobre lotes de 200). El
// depósito tiene hoy 17 productos activos; 50 deja margen para que el
// catálogo crezca sin tocar este número. Los despachos son en la práctica
// entre 10 y 30 renglones por turno; 100 es una cota bien holgada. Entre los
// dos, el peor caso son 150 ids únicos en el paso 0 — lejos del límite.
const MAX_RENGLONES_DEPOSITO = 50;
const MAX_RENGLONES_DESPACHO = 100;

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
  if (!esFechaReal(fecha)) {
    return NextResponse.json({ error: "Esa fecha no existe" }, { status: 400 });
  }
  if (!esTurno(turno)) {
    return NextResponse.json({ error: "El turno tiene que ser 4_12 o 12_20" }, { status: 400 });
  }

  const admin = createAdminClient();
  const texto = (v: unknown) => String(v ?? "").trim() || null;
  const numero = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));

  const deposito = Array.isArray(b?.deposito) ? b.deposito : [];
  const renglones = Array.isArray(b?.despachos) ? b.despachos : [];

  if (deposito.length > MAX_RENGLONES_DEPOSITO) {
    return NextResponse.json(
      { error: `El depósito no puede tener más de ${MAX_RENGLONES_DEPOSITO} renglones` },
      { status: 400 }
    );
  }
  if (renglones.length > MAX_RENGLONES_DESPACHO) {
    return NextResponse.json(
      { error: `Los despachos no pueden tener más de ${MAX_RENGLONES_DESPACHO} renglones` },
      { status: 400 }
    );
  }

  // ── 0. Validar los producto_id antes de escribir nada ──────
  // Un id que no existe en `produccion_productos` lo rechaza la FK con un error
  // de Postgres crudo, y sólo se entera después de haber borrado el depósito o
  // los despachos del parte (ver el punto 3 más abajo). Comprobar acá, contra
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

  // Un producto repetido en el depósito no lo caza nada hasta el `insert` de
  // más abajo, con el depósito ya borrado: la primary key es
  // `(parte_id, producto_id)`, y ese es el peor momento para enterarse.
  if (new Set(idsDeDeposito).size !== idsDeDeposito.length) {
    return NextResponse.json(
      { error: "Hay un producto repetido en el depósito" },
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
  // sólo si el nombre lo identifica **con certeza**.
  //
  // `empleados` separa nombre y apellido en dos columnas, y el papel lo firma
  // con el nombre completo ("Fabricio Gallastegui"). Un índice por `nombre`
  // solo no reconoce a nadie: `indiceDeEmpleados` (lib/inventario/enlaces.ts)
  // arma las dos formas ("apellido nombre" y "nombre apellido") y está medido
  // contra 3.794 nombres reales de la planilla del pañol — es el mismo
  // problema que ya resolvió Inventario, y se reusa en vez de reescribirlo.
  //
  // `traerTodo`: sin paginar, esto se corta en 1000 filas sin avisar, y el
  // síntoma sería un `capataz_id` en null indistinguible de "no se lo
  // reconoció". Sólo los activos, mismo criterio que
  // `app/api/rrhh/empleados/import/confirm/route.ts`: un nombre repetido por
  // alguien dado de baja apagaría un enlace que en los hechos es único.
  const capatazRaw = texto(b?.capataz_raw);
  let capatazId = texto(b?.capataz_id);
  if (!capatazId && capatazRaw) {
    const empleados = await traerTodo<{ id: string; nombre: string; apellido: string | null }>(
      (desde, hasta) =>
        admin.from("empleados").select("id, nombre, apellido").eq("activo", true).range(desde, hasta)
    );
    capatazId = reconocer(indiceDeEmpleados(empleados), capatazRaw);
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

  // Si esta request fue la que dio de alta el parte, y no una que corrigió uno
  // que ya existía. Lo necesita el punto 3: un parte creado acá y que queda
  // con el depósito o los despachos a medio escribir es mejor borrarlo (el día
  // vuelve a tener un turno faltante, que se informa como tal) que dejarlo con
  // un depósito vacío que se lee como "se contó cero" y exporta una
  // producción inventada. Un parte que ya existía antes de esta request no se
  // borra nunca, tenga o no historia previa.
  let esNuevo = !existente;

  let parte: { id: string } | null = null;
  let errParte: { message: string; code?: string } | null = null;

  if (existente) {
    ({ data: parte, error: errParte } = await admin
      .from("produccion_partes")
      .update({
        ...camposComunes,
        actualizado_por: user.id,
        actualizado_en: new Date().toISOString(),
      })
      .eq("id", existente.id)
      .select("id")
      .single());
  } else {
    const ins = await admin
      .from("produccion_partes")
      .insert({
        fecha,
        turno,
        ...camposComunes,
        cargado_por: user.id,
      })
      .select("id")
      .single();

    if (ins.error?.code === "23505") {
      // Dos altas simultáneas del mismo turno: entre el `select` de arriba y
      // este `insert` no hay nada que lo impida, así que las dos requests ven
      // "no existe" y las dos toman esta rama. La constraint
      // `unique (fecha, turno)` rechaza a la segunda con el 23505 de
      // Postgres — pero el parte sí se creó, lo creó la otra request. Tratar
      // esto como la corrección que en los hechos es, en vez de devolver el
      // 500 crudo de una fila que en realidad está ahí.
      esNuevo = false;
      const { data: creadoPorOtro, error: errBuscar } = await admin
        .from("produccion_partes")
        .select("id")
        .eq("fecha", fecha)
        .eq("turno", turno)
        .maybeSingle();
      if (errBuscar || !creadoPorOtro) {
        return NextResponse.json({ error: ins.error.message }, { status: 500 });
      }
      ({ data: parte, error: errParte } = await admin
        .from("produccion_partes")
        .update({
          ...camposComunes,
          actualizado_por: user.id,
          actualizado_en: new Date().toISOString(),
        })
        .eq("id", creadoPorOtro.id)
        .select("id")
        .single());
    } else {
      parte = ins.data;
      errParte = ins.error;
    }
  }

  if (errParte || !parte) {
    return NextResponse.json(
      { error: errParte?.message ?? "No se pudo guardar el parte" },
      { status: 500 }
    );
  }

  // Capturados en variables aparte (y no leídos de `parte`/`esNuevo` más
  // abajo) para que `fallaConParteYaEscrito` los use sin que TypeScript los
  // trate como potencialmente nulos dentro de una función anidada.
  const parteId = parte.id;
  const parteEsNuevo = esNuevo;

  /**
   * Un fallo que llega después de haber escrito el parte no puede volver un
   * 500/400 a secas: eso corta antes de exportar, pero la fila del parte
   * sobrevive. Si además el depósito quedó vacío, la próxima vez que ese día
   * se exporte (al guardar el otro turno, o desde el botón de reintentar)
   * `produccionDelTurno` lee el depósito vacío como "se contó cero", saca una
   * producción igual al negativo del stock anterior, `soloLoCalculado` la deja
   * pasar porque su estado es "calculada", y se escribe en la planilla con
   * `sheets_pendiente` en null diciendo que todo salió bien.
   *
   * Por eso, acá:
   *  - si el parte se creó en esta misma request, se borra (el
   *    `on delete cascade` limpia lo que haya llegado a insertarse de
   *    depósito o despachos): el día vuelve a tener un turno faltante, que
   *    `produccionDelDia` sabe informar como `dia_incompleto` en vez de
   *    inventar un número.
   *  - si ya existía (se estaba corrigiendo un parte con historia), no se
   *    borra: queda anotado `sheets_pendiente` con el motivo y
   *    `sheets_pendiente_en` con la hora, para que el tablero lo cuente y el
   *    panel de "no llegó a la planilla" lo ofrezca para reintentar.
   */
  async function fallaConParteYaEscrito(status: number, motivo: string) {
    if (parteEsNuevo) {
      await admin.from("produccion_partes").delete().eq("id", parteId);
      return NextResponse.json({ error: motivo }, { status });
    }
    await admin
      .from("produccion_partes")
      .update({ sheets_pendiente: motivo, sheets_pendiente_en: new Date().toISOString() })
      .eq("id", parteId);
    return NextResponse.json({ id: parteId, error: motivo }, { status });
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
  // haya cubierto, un corte de red), `fallaConParteYaEscrito` decide qué hacer
  // con el parte: reintentar sigue siendo **idempotente** en el caso que
  // queda con historia — el mismo payload vuelve a borrar (ya vacío) e
  // insertar entero, así que no hay estado intermedio que se acumule.
  const { error: errBorrarDeposito } = await admin
    .from("produccion_deposito")
    .delete()
    .eq("parte_id", parteId);
  if (errBorrarDeposito) return await fallaConParteYaEscrito(500, errBorrarDeposito.message);

  if (deposito.length > 0) {
    const { error } = await admin.from("produccion_deposito").insert(
      deposito.map((d: { cantidad: unknown }, i: number) => ({
        parte_id: parteId,
        // El id ya validado y normalizado del paso 0, no el crudo del cuerpo:
        // son el mismo valor salvo espacios, pero mantener dos copias del
        // mismo dato es la clase de cosa que un día deja de serlo.
        producto_id: idsDeDeposito[i] as string,
        cantidad: Number(d.cantidad) || 0,
      }))
    );
    if (error) return await fallaConParteYaEscrito(400, error.message);
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
    .eq("parte_id", parteId);
  if (errBorrarDespachos) return await fallaConParteYaEscrito(500, errBorrarDespachos.message);

  if (renglones.length > 0) {
    const { error } = await admin.from("produccion_despachos").insert(
      renglones.map((d: Record<string, unknown>, i: number) => ({
        parte_id: parteId,
        orden: i + 1,
        equipo_raw: texto(d.equipo_raw),
        cliente_raw: texto(d.cliente_raw),
        // Puede venir en null a propósito: el renglón "Otros" del papel, o un
        // nombre que no se reconoció. El texto crudo se guarda igual. Es el
        // mismo id ya validado y normalizado del paso 0, no un segundo
        // `texto(d.producto_id)` recalculado acá.
        producto_id: idsDeDespacho[i],
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
    if (error) return await fallaConParteYaEscrito(400, error.message);
  }

  // ── 5. Exportar el día ─────────────────────────────────────
  // El día entero y no el turno: los resúmenes son diarios, y el turno recién
  // cargado cambia el total del día.
  const { ids, productos, produccion, despacho, rotura } = await armarElDia(admin, fecha);
  const resultado = await espejarDia({ fecha, productos, produccion, despacho, rotura });

  // El pendiente se anota (o se limpia) en **todos** los partes del día, no
  // sólo en el que se acaba de guardar: si el turno de la mañana había
  // quedado pendiente por un fallo anterior y ahora, al guardar el de la
  // tarde, la exportación sale bien, el de la mañana tiene que dejar de
  // aparecer en el tablero y en el panel de reintentos. `armarElDia` devuelve
  // `ids` justamente para esto. Si viniera vacío —no debería, porque este
  // mismo parte ya está guardado— se usa el propio id para no dejar de anotar
  // nada.
  const idsDelDia = ids.length > 0 ? ids : [parteId];
  await admin
    .from("produccion_partes")
    .update({
      sheets_pendiente: resultado.ok ? null : resultado.error,
      sheets_pendiente_en: resultado.ok ? null : new Date().toISOString(),
    })
    .in("id", idsDelDia);

  return NextResponse.json({
    id: parteId,
    // Los tres casos que le importan a quien consume esto: "escrita" (guardó y
    // exportó), "pendiente" (guardó, no exportó — ver `error_planilla`) y el
    // que no tiene `planilla` porque la respuesta nunca llegó acá: un `error`
    // sin `id` (no se guardó nada, o el parte se creó en esta request y quedó
    // a medio escribir, y por eso se borró) o un `error` con `id` (el parte
    // ya existía antes de esta request y quedó con `sheets_pendiente`
    // anotado, casos 3 y 4).
    planilla: resultado.ok ? "escrita" : "pendiente",
    // Sin traducir y a la vista: quien cargó tiene que poder distinguir este
    // fallo de cualquier otro.
    error_planilla: resultado.ok ? null : resultado.error,
  });
}
