import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { puedeEditarCantera } from "@/lib/cantera/auth";
import { correlativosUsados, traerYacimientos } from "@/lib/cantera/consultas";
import { anioParaCodigo, armarCodigo, proximoCorrelativo } from "@/lib/cantera/codigos";

/**
 * Dar de alta un bochón (voladura secundaria).
 *
 * Igual que una voladura: se elige la cantera y —si ya se sabe— la fecha de
 * voladura, y el servidor genera el código `B{NN}{yac}{AA}`. El resto se
 * completa en el editor. La constraint `unique (yacimiento_id, anio,
 * correlativo)` ataja dos altas simultáneas con un 23505 y se reintenta.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarCantera(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permiso para cargar bochones" }, { status: 403 });
  }

  const b = await cuerpoJson(request);
  const yacimientoId = String(b?.yacimiento_id ?? "");
  if (!yacimientoId) return NextResponse.json({ error: "Falta la cantera" }, { status: 400 });

  const yac = (await traerYacimientos(supabase)).find((y) => y.id === yacimientoId);
  if (!yac) return NextResponse.json({ error: "Esa cantera no existe" }, { status: 404 });

  const fecha =
    typeof b?.fecha_voladura === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.fecha_voladura)
      ? b.fecha_voladura
      : null;
  const anio = anioParaCodigo(fecha);

  for (let intento = 0; intento < 3; intento++) {
    const usados = await correlativosUsados(supabase, "cantera_bochones", yacimientoId, anio);
    const correlativo = proximoCorrelativo(usados) + intento;
    const codigo = armarCodigo("B", yac.codigo, correlativo, anio);

    const { data, error } = await supabase
      .from("cantera_bochones")
      .insert({
        codigo,
        yacimiento_id: yacimientoId,
        anio,
        correlativo,
        fecha_voladura: fecha,
        voladura_codigo:
          typeof b?.voladura_codigo === "string" && b.voladura_codigo.trim()
            ? b.voladura_codigo.trim()
            : null,
        cargado_por: user.id,
      })
      .select("codigo")
      .single();

    if (!error) return NextResponse.json({ data });
    if (error.code !== "23505") return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ error: "No se pudo asignar un código libre. Probá de nuevo." }, { status: 409 });
}
