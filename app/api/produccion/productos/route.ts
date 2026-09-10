import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { esAdminProduccion, tieneAccesoProduccion } from "@/lib/produccion/auth";
import { traerRenglonesDePapel } from "@/lib/produccion/consultas";

/**
 * Los renglones del parte en papel: ~15 filas, una por renglón, que son también
 * las columnas del Excel.
 *
 * **No es un catálogo de productos.** Eso es `productos`, en el núcleo, y desde
 * el catálogo único lo comparte con Despacho
 * (docs/superpowers/specs/2026-09-10-productos-catalogo-unico-design.md). Acá
 * se define cómo se ve el parte, y con `PUT` **qué productos cuenta cada
 * renglón** — que es la correspondencia que sólo calidad puede decidir.
 *
 * `GET` lo ve cualquiera con acceso a Producción — lo necesita el formulario de
 * carga, no sólo la pantalla de administración. `POST`, `PATCH` y `PUT` los
 * reserva `esAdminProduccion`.
 *
 * Un renglón **no se borra**: los partes viejos lo referencian por FK
 * (`produccion_deposito.renglon_papel_id`,
 * `produccion_despachos.renglon_papel_id`) y una baja física los rompería o,
 * con `on delete set null`, borraría en silencio qué se contó. `activo: false`
 * alcanza: sale de la carga y de las pantallas activas, y sigue respondiendo
 * por su historia.
 */

const FAMILIAS = ["filler", "0_2", "cal", "otros"];

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await tieneAccesoProduccion(supabase, user.id))) {
    return NextResponse.json({ error: "Sin acceso a Producción" }, { status: 403 });
  }
  return NextResponse.json({ renglonesDePapel: await traerRenglonesDePapel(supabase, { soloActivos: false }) });
}

export async function POST(request: Request) {
  return guardar(request, "alta");
}

export async function PATCH(request: Request) {
  return guardar(request, "edicion");
}

async function guardar(request: Request, modo: "alta" | "edicion") {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await esAdminProduccion(supabase, user.id))) {
    return NextResponse.json(
      { error: "Sólo un admin de Producción edita los renglones del parte" },
      { status: 403 }
    );
  }

  const b = await cuerpoJson(request);
  const nombre = String(b?.nombre ?? "").trim();
  if (modo === "alta" && !nombre) {
    return NextResponse.json({ error: "El renglón necesita un nombre" }, { status: 400 });
  }
  if (b?.familia !== undefined && !FAMILIAS.includes(String(b.familia))) {
    return NextResponse.json({ error: `Familia inválida. Son: ${FAMILIAS.join(", ")}` }, { status: 400 });
  }

  const admin = createAdminClient();
  const campos = {
    ...(b?.nombre !== undefined && { nombre }),
    ...(b?.familia !== undefined && { familia: b.familia }),
    // Null acá significa "no se exporta a la planilla", que es una decisión.
    ...(b?.nombre_planilla !== undefined && {
      nombre_planilla: String(b.nombre_planilla ?? "").trim() || null,
    }),
    ...(b?.orden !== undefined && { orden: Number(b.orden) }),
    ...(b?.activo !== undefined && { activo: Boolean(b.activo) }),
  };

  if (modo === "alta") {
    // `orden` es `not null` y no tiene default en la base. Si cada alta lo
    // dejara en 0, la pantalla de carga —que tiene que salir en el orden del
    // papel, agrupada en Filler / 0-2 / Cal— quedaría a merced de en qué orden
    // devuelve Postgres las filas empatadas, que no promete ninguno.
    //
    // Se calcula acá y no se le pide a la pantalla: es la misma cuenta
    // ("el siguiente lugar") sin importar desde dónde se dé de alta —hoy sólo
    // hay una pantalla de administración, pero repetir la cuenta en cada
    // cliente es repetir la regla—, y evita la carrera de que dos altas
    // simultáneas calculen "el mismo siguiente" del lado del cliente. No hace
    // falta por familia: alcanza con que el nuevo quede después de *todos* los
    // renglonesDePapel existentes, porque la pantalla agrupa por familia y dentro de
    // cada grupo ordena por `orden` — un valor mayor que cualquier `orden` ya
    // usado queda al final de su propio grupo sin importar los de los demás.
    // Sigue pudiéndose pisar pasando `orden` explícito, para cuando alguien
    // quiera reacomodar el catálogo a mano.
    let ordenPorDefecto = 0;
    if (b?.orden === undefined) {
      const { data: maximo, error: errMaximo } = await admin
        .from("produccion_renglones_papel")
        .select("orden")
        .order("orden", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (errMaximo) return NextResponse.json({ error: errMaximo.message }, { status: 500 });
      ordenPorDefecto = (maximo?.orden ?? -1) + 1;
    }

    const { data, error } = await admin
      .from("produccion_renglones_papel")
      .insert({ orden: ordenPorDefecto, familia: "otros", ...campos })
      .select("id")
      .single();
    if (error) {
      // El nombre es único (`produccion_renglones_papel_nombre_idx`, sobre
      // `lower(nombre)`): repetirlo no es un error del sistema, es que ya
      // está. Devolver el 23505 crudo de Postgres —"duplicate key value
      // violates unique constraint..."— no se lo dice a quien carga el alta,
      // que no sabe qué es un índice. Mismo criterio que
      // `app/api/inventario/lista/route.ts` con el catálogo de solicitantes.
      const yaExiste = error.code === "23505";
      return NextResponse.json(
        { error: yaExiste ? `Ya existe un renglón llamado "${nombre}"` : error.message },
        { status: yaExiste ? 409 : 400 }
      );
    }
    return NextResponse.json({ id: data.id });
  }

  const id = String(b?.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "Falta el id del producto" }, { status: 400 });

  // Sin esto, un id inventado (o de un producto ya borrado — no pasa hoy,
  // pero nada lo impide en la base) hacía que `update().eq("id", id)` tocara
  // cero filas y devolviera éxito igual: un 200 con el mismo `id` de vuelta,
  // como si se hubiera editado algo. Mismo patrón que
  // `app/api/mantenimiento/tipos/route.ts`: pedir la fila de vuelta con
  // `.select().single()` para que un id que no matchea ninguna fila salga
  // como el error que es.
  if (Object.keys(campos).length === 0) {
    return NextResponse.json({ error: "No hay nada para cambiar" }, { status: 400 });
  }

  const { error } = await admin
    .from("produccion_renglones_papel")
    .update(campos)
    .eq("id", id)
    .select("id")
    .single();
  if (error) {
    const yaExiste = error.code === "23505";
    // PGRST116: la fila que pedía `.single()` no está — el id no existe.
    const noExiste = error.code === "PGRST116";
    return NextResponse.json(
      {
        error: yaExiste
          ? `Ya existe un renglón llamado "${nombre}"`
          : noExiste
            ? "Ese producto no existe"
            : error.message,
      },
      { status: yaExiste ? 409 : noExiste ? 404 : 400 }
    );
  }
  return NextResponse.json({ id });
}

/**
 * Qué productos cuenta un renglón del papel: reemplaza el conjunto entero.
 *
 * Reemplazar y no ir de a uno porque es lo que la pantalla sabe: el conjunto
 * completo de checkboxes. Ir de a uno obligaría a que el cliente calcule el
 * diff, y un diff mal calculado deja enlaces viejos que suman producción en el
 * renglón equivocado — el error que no se nota.
 *
 * Un renglón puede quedar **sin ningún producto** y es un estado válido, no un
 * error: hasta que calidad defina la correspondencia, ninguno tiene enlaces, y
 * el parte se carga igual. Lo único que no corre sin enlaces es la comprobación
 * kilos↔bultos, porque el kg por unidad sale del producto.
 */
export async function PUT(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await esAdminProduccion(supabase, user.id))) {
    return NextResponse.json(
      { error: "Sólo un admin de Producción enlaza los productos de un renglón" },
      { status: 403 }
    );
  }

  const b = await cuerpoJson(request);
  const renglon = String(b?.renglon_papel_id ?? "").trim();
  if (renglon === "") {
    return NextResponse.json({ error: "Falta el renglón" }, { status: 400 });
  }
  if (!Array.isArray(b?.producto_ids)) {
    return NextResponse.json({ error: "Faltan los productos" }, { status: 400 });
  }
  const ids = [...new Set(b.producto_ids.map((x: unknown) => String(x)).filter((x: string) => x !== ""))];

  const admin = createAdminClient();
  const { error: errorBorrado } = await admin
    .from("produccion_renglon_productos")
    .delete()
    .eq("renglon_papel_id", renglon);
  if (errorBorrado) {
    return NextResponse.json({ error: errorBorrado.message }, { status: 400 });
  }

  if (ids.length > 0) {
    const { error } = await admin
      .from("produccion_renglon_productos")
      .insert(ids.map((producto_id) => ({ renglon_papel_id: renglon, producto_id })));
    if (error) {
      // Se borró y no se pudo insertar: hay que decirlo, porque el renglón
      // quedó sin enlaces y en la pantalla se vería como "todavía sin definir".
      return NextResponse.json(
        { error: `Los enlaces viejos se borraron y los nuevos no entraron: ${error.message}` },
        { status: 400 }
      );
    }
  }

  return NextResponse.json({ ok: true, enlazados: ids.length });
}
