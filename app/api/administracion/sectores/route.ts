import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { es_admin_check } from "@/lib/core/route-utils";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { createAdminClient } from "@/lib/supabase/admin";
import { traerTodo } from "@/lib/core/paginado";
import { yaExisteElNombre, type SectorAdmin } from "@/lib/core/sectores";

/**
 * Las ocho tablas que apuntan a un sector.
 *
 * `sectores_status_log` no está: es historia del sector, no algo que lo use, y
 * contarla haría que un sector sin nadie parezca ocupado.
 */
const TABLAS_QUE_LO_USAN = [
  "empleados", "equipos", "avisos", "ordenes_trabajo", "ordenes_servicio",
  "compras_ubicaciones", "inventario_movimientos", "inventario_destinos",
] as const;

/**
 * El catálogo entero, con la cuenta de quién usa cada sector.
 *
 * Antes esta pantalla los leía embebidos desde `empresas`, así que los
 * transversales —diecinueve de treinta y nueve— no aparecían: no se podían ver,
 * renombrar ni dar de baja desde ningún lado.
 *
 * La cuenta se arma trayendo el `sector_id` de las ocho tablas y contando acá.
 * Son unas 3.200 filas de una columna, en ocho consultas. Es caro para una
 * pantalla, y se paga igual: sin la cuenta, dar de baja un sector es a ciegas
 * —desaparece de los desplegables y las filas que le apuntaban quedan sin forma
 * de corregirse—, que es exactamente el error que esta pantalla tiene que
 * evitar. La administración se abre de vez en cuando, no en cada pedido.
 */
export async function GET() {
  const supabase = await createClient();
  const check = await es_admin_check(supabase);
  if (check) return check;

  const { data: sectores, error } = await supabase
    .from("sectores")
    .select("id, nombre, activo, transversal, es_de_planta, codigo, empresa_id, empresas(nombre)")
    .order("nombre");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Las cuentas van con el cliente admin y no con el del usuario: las ocho
  // tablas son de cinco módulos distintos y sus políticas de lectura no son
  // todas `using (true)`. Con RLS de por medio, una tabla tapada devuelve cero
  // filas sin error, y el sector aparecería como "sin uso" cuando tiene ciento
  // setenta: un cero equivocado acá es lo que hace que alguien lo dé de baja.
  // La ruta ya exige admin del sistema, así que no abre nada que no viera.
  const admin = createAdminClient();
  const usos = new Map<string, number>();
  for (const tabla of TABLAS_QUE_LO_USAN) {
    const filas = await traerTodo<{ sector_id: string | null }>((desde, hasta) =>
      admin.from(tabla).select("sector_id").not("sector_id", "is", null).range(desde, hasta)
    );
    for (const f of filas) {
      if (f.sector_id) usos.set(f.sector_id, (usos.get(f.sector_id) ?? 0) + 1);
    }
  }

  const salida: SectorAdmin[] = (sectores ?? []).map((s) => ({
    id: s.id as string,
    nombre: s.nombre as string,
    activo: s.activo as boolean,
    transversal: s.transversal as boolean,
    es_de_planta: s.es_de_planta as boolean,
    codigo: (s.codigo as string | null) ?? null,
    empresa_id: (s.empresa_id as string | null) ?? null,
    // El embed llega como objeto o como arreglo según cómo esté declarada la
    // relación; las dos formas llegan a las pantallas.
    empresa: (Array.isArray(s.empresas) ? s.empresas[0] : s.empresas)?.nombre ?? null,
    usos: usos.get(s.id as string) ?? 0,
  }));

  return NextResponse.json(salida);
}

/**
 * Un sector nuevo, transversal o de una empresa.
 *
 * Antes sólo se podía crear dentro de una empresa, que es la mitad del
 * catálogo. Y no chequeaba el nombre contra el resto: así nacieron
 * "Administración" por POLCECAL, por POLYSAN y "(RRHH)", tres filas para la
 * misma área que ningún tablero sumaba junto. Ahora un nombre que ya existe
 * —aunque sea con otras tildes, en otra empresa o dado de baja— se rechaza y se
 * dice cuál es el que ya está.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const check = await es_admin_check(supabase);
  if (check) return check;

  const body = await cuerpoJson(request);
  const nombre = String(body.nombre ?? "").trim();
  const empresaId = body.empresaId ? String(body.empresaId) : null;
  const transversal = body.transversal === true;

  if (!nombre) {
    return NextResponse.json({ error: "Falta el nombre" }, { status: 400 });
  }
  // La base exige una cosa o la otra —el check `sectores_empresa_o_transversal`
  // de la 004—, así que se rechaza acá con un mensaje que se entiende.
  if (transversal === Boolean(empresaId)) {
    return NextResponse.json(
      { error: "Un sector es de una empresa o es transversal, nunca las dos ni ninguna" },
      { status: 400 }
    );
  }

  const { data: existentes } = await supabase
    .from("sectores")
    .select("id, nombre, activo, transversal, es_de_planta, codigo, empresa_id, empresas(nombre)");
  const choca = yaExisteElNombre((existentes ?? []) as unknown as SectorAdmin[], nombre);
  if (choca) {
    const donde = choca.es_de_planta
      ? "entre los de planta"
      : choca.transversal
        ? "como transversal"
        : "en una empresa";
    return NextResponse.json(
      {
        error:
          `Ya existe "${choca.nombre}" ${donde}` +
          (choca.activo ? "." : ", dado de baja. Reactivalo en vez de crear otro."),
      },
      { status: 409 }
    );
  }

  const { data, error } = await supabase
    .from("sectores")
    .insert({ nombre, empresa_id: empresaId, transversal })
    .select()
    .single();
  if (error) {
    const msg = error.code === "23505" ? "Ya existe un sector con ese nombre" : error.message;
    return NextResponse.json({ error: msg }, { status: error.code === "23505" ? 409 : 500 });
  }
  return NextResponse.json(data);
}
