import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { esAdminCompras } from "@/lib/compras/auth";
import {
  bajarPlanillaDeProveedores, leerProveedores, decidirImportacion,
  camposParaGuardar, planillaConfigurada,
} from "@/lib/compras/importarProveedores";

export const maxDuration = 300;

/**
 * Trae la base de proveedores del Excel que lleva administración.
 *
 * Mientras la gente no use la app, esa lista es la de verdad y va cambiando.
 * Esto la trae cuando hace falta, cuantas veces haga falta: el cruce es por
 * nombre, así que correrlo dos veces seguidas no cambia nada la segunda.
 *
 * Lo que no reconoce con certeza no lo toca. Un duplicado no se nota el primer
 * día; se nota cuando alguien mira cuánto le compramos a un proveedor y le
 * faltan la mitad de las compras.
 */
export async function POST() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  // Reescribe la lista de proveedores de todo el sistema: es de quien
  // administra el módulo, no de cualquiera que pueda editar una compra.
  if (!(await esAdminCompras(supabase, user.id))) {
    return NextResponse.json(
      { error: "Importar proveedores requiere administrar el módulo Compras" },
      { status: 403 }
    );
  }

  if (!planillaConfigurada()) {
    return NextResponse.json(
      {
        error:
          "Falta configurar GOOGLE_DRIVE_PROVEEDORES_ID, o las credenciales de Google.",
      },
      { status: 503 }
    );
  }

  let delExcel;
  try {
    delExcel = leerProveedores(await bajarPlanillaDeProveedores());
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }

  if (delExcel.length === 0) {
    return NextResponse.json(
      { error: "El archivo no tiene ninguna fila con la columna «Proveedor»." },
      { status: 422 }
    );
  }

  const admin = createAdminClient();
  const { data: deLaBase, error } = await admin
    .from("proveedores")
    .select("id, nombre")
    .limit(2000);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const { actualizar, insertar, aRevisar } = decidirImportacion(delExcel, deLaBase ?? []);

  const fallos: string[] = [];
  const unidos: { antes: string; ahora: string }[] = [];

  let actualizados = 0;
  for (const { id, fila, erraNombre } of actualizar) {
    const { error } = await admin
      .from("proveedores")
      .update(camposParaGuardar(fila))
      .eq("id", id);
    if (error) fallos.push(`${fila.nombre}: ${error.message}`);
    else {
      actualizados++;
      if (erraNombre) unidos.push({ antes: erraNombre, ahora: fila.nombre });
    }
  }

  let altas = 0;
  for (let i = 0; i < insertar.length; i += 100) {
    const lote = insertar.slice(i, i + 100).map(camposParaGuardar);
    const { error } = await admin.from("proveedores").insert(lote);
    if (error) fallos.push(`altas: ${error.message}`);
    else altas += lote.length;
  }

  return NextResponse.json({
    leidos: delExcel.length,
    actualizados,
    altas,
    unidos,
    // Los que no se pudieron reconocer con certeza. No se tocaron: van acá
    // para que los resuelva quien conoce a los proveedores.
    aRevisar,
    fallos,
  });
}
