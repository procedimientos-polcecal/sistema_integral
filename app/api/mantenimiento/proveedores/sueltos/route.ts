import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { traerTodo } from "@/lib/core/paginado";
import {
  claveDeProveedor, indiceDeProveedores, buscarProveedor, nombresParecidos,
} from "@/lib/core/proveedores";

/**
 * Los proveedores que las órdenes nombran y la lista todavía no tiene.
 *
 * Las planillas escriben el nombre a mano cada vez, así que hay trabajo hecho
 * por gente que el sistema no reconoce. Mientras no se los sume, ese trabajo no
 * se puede cruzar entre Compras y Mantenimiento.
 *
 * Está en su propia ruta y no sólo en el aviso de la sincronización porque el
 * aviso se cierra y no vuelve: esto hay que poder mirarlo cuando uno quiera.
 */

/** De dónde sale el nombre de un proveedor en cada tabla. */
const DONDE = [
  { tabla: "os_comparativas", columna: "proveedor" },
  { tabla: "ordenes_servicio", columna: "proveedor_elegido" },
  { tabla: "ordenes_trabajo", columna: "contratista" },
] as const;

/** GET — qué falta sumar y qué conviene unificar antes. */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const admin = createAdminClient();
  const { indice, sueltos } = await juntarSueltos(admin);

  const nombres = [...sueltos.values()];
  return NextResponse.json({
    nombres,
    // Los que parecen el mismo escrito de dos formas: conviene resolverlos
    // antes de sumarlos, porque después hay que fusionar dos fichas.
    parecidos: nombresParecidos(nombres),
    proveedores: indice.size,
  });
}

/**
 * POST — suma los que falten y enlaza lo que ya se pueda.
 *
 * Enlazar va aparte de sincronizar a propósito: la sincronización de
 * comparativas borra y vuelve a insertar, y no hay razón para pasar por eso
 * sólo para completar una columna.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json(
      { error: "Sumar proveedores requiere nivel de edición en Mantenimiento" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const admin = createAdminClient();

  let creados = 0;

  // Sumar es opcional: se puede pedir sólo enlazar lo que ya está en la lista.
  if (body?.sumar !== false) {
    const { sueltos } = await juntarSueltos(admin);

    if (sueltos.size > 0) {
      const { data, error } = await admin
        .from("proveedores")
        .insert([...sueltos.values()].map((nombre) => ({ nombre, es_contratista: true })))
        .select("id");
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      creados = data?.length ?? 0;
    }
  }

  // Con la lista ya completa, se recorre lo que quedó sin enlazar.
  const proveedores = await traerTodo<{ id: string; nombre: string }>((desde, hasta) =>
    admin.from("proveedores").select("id, nombre").range(desde, hasta)
  );
  const indice = indiceDeProveedores(proveedores);

  const enlazados: Record<string, number> = {};

  for (const { tabla, columna } of DONDE) {
    const filas = await traerTodo<Record<string, unknown>>((desde, hasta) =>
      admin.from(tabla).select(`id, ${columna}`).is("proveedor_id", null).range(desde, hasta)
    );

    // Se agrupan por proveedor para hacer un update por proveedor y no uno por
    // fila: son cientos de filas y un puñado de proveedores.
    const porProveedor = new Map<string, string[]>();
    for (const fila of filas) {
      const id = buscarProveedor(indice, fila[columna] as string | null);
      if (!id) continue;
      porProveedor.set(id, [...(porProveedor.get(id) ?? []), fila.id as string]);
    }

    let cuantos = 0;
    for (const [proveedor_id, ids] of porProveedor) {
      for (let i = 0; i < ids.length; i += 300) {
        const lote = ids.slice(i, i + 300);
        const { error } = await admin
          .from(tabla)
          .update({ proveedor_id })
          .in("id", lote);
        if (error) return NextResponse.json({ error: `${tabla}: ${error.message}` }, { status: 400 });
        cuantos += lote.length;
      }
    }
    enlazados[tabla] = cuantos;
  }

  return NextResponse.json({ creados, enlazados });
}

type Admin = ReturnType<typeof createAdminClient>;

/** Los nombres que aparecen en las órdenes y no están en `proveedores`. */
async function juntarSueltos(admin: Admin) {
  const proveedores = await traerTodo<{ id: string; nombre: string }>((desde, hasta) =>
    admin.from("proveedores").select("id, nombre").range(desde, hasta)
  );
  const indice = indiceDeProveedores(proveedores);

  // Por clave normalizada: "Candia" y "CANDIA" son uno solo, y de las dos
  // escrituras se guarda la primera que apareció.
  const sueltos = new Map<string, string>();

  for (const { tabla, columna } of DONDE) {
    const filas = await traerTodo<Record<string, unknown>>((desde, hasta) =>
      admin.from(tabla).select(columna).not(columna, "is", null).range(desde, hasta)
    );

    for (const fila of filas) {
      const nombre = String(fila[columna] ?? "").trim();
      const clave = claveDeProveedor(nombre);
      if (!clave || indice.has(clave) || sueltos.has(clave)) continue;
      sueltos.set(clave, nombre);
    }
  }

  return { indice, sueltos };
}
