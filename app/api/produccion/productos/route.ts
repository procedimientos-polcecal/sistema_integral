import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { esAdminProduccion, tieneAccesoProduccion } from "@/lib/produccion/auth";
import { traerProductos } from "@/lib/produccion/consultas";

/**
 * El catálogo de productos: 17 filas hoy, una por cada renglón del papel.
 *
 * `GET` lo ve cualquiera con acceso a Producción — lo necesita el formulario de
 * carga, no sólo la pantalla de administración. `POST` y `PATCH` los reserva
 * `esAdminProduccion`.
 *
 * Un producto **no se borra**: los partes viejos lo referencian por FK
 * (`produccion_deposito.producto_id`, `produccion_despachos.producto_id`) y una
 * baja física los rompería o, con `on delete set null`, borraría en silencio
 * qué se contó. `activo: false` alcanza: sale de la carga y de las pantallas
 * activas, y sigue respondiendo por su historia.
 */

const FAMILIAS = ["filler", "0_2", "cal", "otros"];
const ENVASES = ["bolsa", "bolson"];

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await tieneAccesoProduccion(supabase, user.id))) {
    return NextResponse.json({ error: "Sin acceso a Producción" }, { status: 403 });
  }
  return NextResponse.json({ productos: await traerProductos(supabase, { soloActivos: false }) });
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
      { error: "Sólo un admin de Producción edita el catálogo" },
      { status: 403 }
    );
  }

  const b = await cuerpoJson(request);
  const nombre = String(b?.nombre ?? "").trim();
  if (modo === "alta" && !nombre) {
    return NextResponse.json({ error: "El producto necesita un nombre" }, { status: 400 });
  }
  if (b?.familia !== undefined && !FAMILIAS.includes(String(b.familia))) {
    return NextResponse.json({ error: `Familia inválida. Son: ${FAMILIAS.join(", ")}` }, { status: 400 });
  }
  if (b?.envase !== undefined && !ENVASES.includes(String(b.envase))) {
    return NextResponse.json({ error: `Envase inválido. Son: ${ENVASES.join(", ")}` }, { status: 400 });
  }

  const admin = createAdminClient();
  const campos = {
    ...(b?.nombre !== undefined && { nombre }),
    ...(b?.familia !== undefined && { familia: b.familia }),
    ...(b?.envase !== undefined && { envase: b.envase }),
    // Null es válido y significa "sin confirmar": el bolsón no tiene kilos
    // acordados todavía, y un número inventado apagaría la comprobación.
    ...(b?.kg_por_unidad !== undefined && {
      kg_por_unidad: b.kg_por_unidad === null || b.kg_por_unidad === "" ? null : Number(b.kg_por_unidad),
    }),
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
    // productos existentes, porque la pantalla agrupa por familia y dentro de
    // cada grupo ordena por `orden` — un valor mayor que cualquier `orden` ya
    // usado queda al final de su propio grupo sin importar los de los demás.
    // Sigue pudiéndose pisar pasando `orden` explícito, para cuando alguien
    // quiera reacomodar el catálogo a mano.
    let ordenPorDefecto = 0;
    if (b?.orden === undefined) {
      const { data: maximo, error: errMaximo } = await admin
        .from("produccion_productos")
        .select("orden")
        .order("orden", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (errMaximo) return NextResponse.json({ error: errMaximo.message }, { status: 500 });
      ordenPorDefecto = (maximo?.orden ?? -1) + 1;
    }

    const { data, error } = await admin
      .from("produccion_productos")
      .insert({ orden: ordenPorDefecto, familia: "otros", envase: "bolsa", ...campos })
      .select("id")
      .single();
    if (error) {
      // El nombre es único (`produccion_productos_nombre_idx`, sobre
      // `lower(nombre)`): repetirlo no es un error del sistema, es que ya
      // está. Devolver el 23505 crudo de Postgres —"duplicate key value
      // violates unique constraint..."— no se lo dice a quien carga el alta,
      // que no sabe qué es un índice. Mismo criterio que
      // `app/api/inventario/lista/route.ts` con el catálogo de solicitantes.
      const yaExiste = error.code === "23505";
      return NextResponse.json(
        { error: yaExiste ? `Ya existe un producto llamado "${nombre}"` : error.message },
        { status: yaExiste ? 409 : 400 }
      );
    }
    return NextResponse.json({ id: data.id });
  }

  const id = String(b?.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "Falta el id del producto" }, { status: 400 });

  const { error } = await admin.from("produccion_productos").update(campos).eq("id", id);
  if (error) {
    const yaExiste = error.code === "23505";
    return NextResponse.json(
      { error: yaExiste ? `Ya existe un producto llamado "${nombre}"` : error.message },
      { status: yaExiste ? 409 : 400 }
    );
  }
  return NextResponse.json({ id });
}
