import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Un pedido viejo, para cargar otro parecido.
 *
 * Se piden los mismos materiales una y otra vez, así que el formulario de un
 * requerimiento nuevo puede traer uno viejo y completarse con él. **Qué se
 * copia y qué no lo decide `lib/compras/reutilizarRequerimiento.ts`**, que es
 * puro y tiene los tests; acá sólo se busca y se devuelve.
 *
 * Va con el cliente del usuario y **no** con el admin, igual que su gemela de
 * Mantenimiento: así quien no puede ver un pedido tampoco lo puede copiar, sin
 * escribir un chequeo de permisos aparte que después se desincronice del de la
 * pantalla. Lo que hoy contesta esa policy es que **lo puede ver cualquiera**
 * —`compras_req_select` es `using (true)`, porque el circuito de compras es
 * transversal a toda la empresa (migración 018)—, así que esto no abre nada
 * que el listado de Compras no muestre ya. Si esa policy se cierra algún día,
 * esta ruta se cierra con ella y sin tocarla.
 *
 * Se busca por `nro_ri` y no por `id` porque es el número que la gente conoce:
 * es el que dice la planilla, el que sale en los mensajes y el que alguien
 * tipea. **No es la clave primaria**, así que puede no ser único si algo salió
 * mal; por eso el orden y el `limit(1)`, que es preferible a un error 500 por
 * un duplicado que no es culpa de quien está cargando.
 *
 * Sólo lee.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const numero = Number(new URL(request.url).searchParams.get("numero") ?? "");
  if (!Number.isSafeInteger(numero) || numero <= 0) {
    return NextResponse.json({ error: "Falta el número de RI" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("compras_requerimientos")
    // Una sola línea y sin concatenar: partida con `+` deja de ser un literal
    // y Supabase pierde la inferencia, que es la regla de CLAUDE.md.
    //
    // Van sólo los campos que se copian. Traer la fila entera sería mandarle a
    // la pantalla el costo, el proveedor y el circuito de aprobación de un
    // pedido que no se está mirando: nada de eso se usa y queda en el navegador.
    .select("nro_ri, descripcion, codigo, cantidad, detalle_extra, area_id, ubicacion_id, equipo_id, prioridad, empresa_id, paga_ambas")
    .eq("nro_ri", numero)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // El mismo mensaje para "no existe" y para "no lo podés ver". Son dos cosas
  // distintas y a quien está cargando no le sirve la diferencia: lo que puede
  // hacer es lo mismo en los dos casos.
  if (!data || data.length === 0) {
    return NextResponse.json(
      { error: `No se encontró el RI ${numero}.` },
      { status: 404 }
    );
  }

  return NextResponse.json({ data: data[0] });
}
