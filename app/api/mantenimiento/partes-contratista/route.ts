import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { traerTodo } from "@/lib/core/paginado";
import {
  repartirHoras, normalizarLugar, type RenglonDelParte,
} from "@/lib/mantenimiento/partesDeContratista";

/**
 * Los partes diarios del contratista: el papel, tal como está escrito.
 *
 * Esta ruta **no crea ninguna OT**. Guarda la hoja y reparte sus horas entre
 * los renglones del detalle; las OT salen después, agrupando una semana entera
 * —ver `./generar/route.ts`—. Separarlo es lo que permite cargar las quince
 * hojas de una quincena sin ir creando órdenes a medias.
 */

interface RenglonDelCuerpo extends RenglonDelParte {
  sector_id?: string | null;
  equipo_id?: string | null;
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const desde = searchParams.get("desde");
  const hasta = searchParams.get("hasta");

  // Con el cliente de sesión: RLS ya filtra por `mant_puede_ver()`, así que
  // acá no hace falta comprobar el permiso a mano.
  const partes = await traerTodo((d, h) => {
    let q = supabase
      .from("mant_partes_contratista")
      .select(
        "*, proveedores(nombre), mant_partes_contratista_renglones(" +
        "id, orden, actividad, lugar_raw, sector_id, equipo_id, horas, orden_trabajo_id)"
      )
      .order("fecha", { ascending: false })
      .order("numero", { ascending: false })
      .range(d, h);
    if (desde) q = q.gte("fecha", desde);
    if (hasta) q = q.lte("fecha", hasta);
    return q;
  });

  return NextResponse.json({ data: partes });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const body = await cuerpoJson(request);
  const {
    proveedor_id, numero, fecha, dirigido_a, hora_entrada, hora_salida,
    horas_expresion, horas_declaradas, horas_50, horas_100, materiales,
  } = body ?? {};

  const renglones: RenglonDelCuerpo[] = Array.isArray(body?.renglones) ? body.renglones : [];

  // ── Lo que falta, todo junto ────────────────────────────────
  //
  // La vara de `validar()` del núcleo: quien tiene el papel delante quiere
  // saber todo lo que no cierra de una sola vez. Acá se valida a mano porque
  // los mensajes dicen qué pasa con **esta hoja** —"la suma da 16 y el papel
  // dice 18"—, que es mejor que cualquier cosa genérica.
  const falta: string[] = [];
  if (!proveedor_id) falta.push("el contratista");
  if (!Number.isFinite(Number(numero)) || Number(numero) <= 0) falta.push("el número del parte");
  if (!fecha) falta.push("la fecha");
  if (!String(horas_expresion ?? "").trim()) falta.push("las horas normales");
  if (!Number.isFinite(Number(horas_declaradas)) || Number(horas_declaradas) <= 0) {
    falta.push("el total de horas que dice el papel");
  }
  for (const [i, r] of renglones.entries()) {
    if (!String(r?.actividad ?? "").trim()) falta.push(`la actividad del renglón ${i + 1}`);
    if (!String(r?.lugar_raw ?? "").trim()) falta.push(`el lugar del renglón ${i + 1}`);
  }
  if (falta.length > 0) {
    return NextResponse.json({ error: `Falta cargar ${falta.join(", ")}.` }, { status: 400 });
  }

  // ── El reparto ──────────────────────────────────────────────
  //
  // Es también el control de la factura: si la suma no da el total escrito a
  // mano, **no se guarda**. Sin esa comprobación esto sería sólo transcribir.
  const reparto = repartirHoras(
    String(horas_expresion),
    renglones.map((r) => ({
      actividad: String(r.actividad).trim(),
      lugar_raw: String(r.lugar_raw).trim(),
    })),
    Number(horas_declaradas)
  );
  if (!reparto.ok) {
    return NextResponse.json(
      { error: reparto.problemas.join(" "), problemas: reparto.problemas },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  const { data: parte, error } = await admin
    .from("mant_partes_contratista")
    .insert({
      proveedor_id,
      numero: Number(numero),
      fecha,
      dirigido_a: String(dirigido_a ?? "").trim() || null,
      hora_entrada: String(hora_entrada ?? "").trim() || null,
      hora_salida: String(hora_salida ?? "").trim() || null,
      horas_expresion: String(horas_expresion).trim(),
      horas_declaradas: Number(horas_declaradas),
      horas_50: horas_50 === "" || horas_50 == null ? null : Number(horas_50),
      horas_100: horas_100 === "" || horas_100 == null ? null : Number(horas_100),
      materiales: String(materiales ?? "").trim() || null,
      cargado_por: user.id,
    })
    .select()
    .single();

  if (error) {
    // El número es único por contratista **a propósito**: los partes son
    // correlativos, así que un repetido es casi siempre la misma hoja cargada
    // dos veces. Se dice con esas palabras en vez de con el error de Postgres.
    const repetido = error.code === "23505";
    return NextResponse.json(
      {
        error: repetido
          ? `El parte ${numero} de ese contratista ya está cargado. Los números son ` +
            `correlativos, así que revisá si no es la misma hoja.`
          : `No se pudo guardar el parte: ${error.message}`,
      },
      { status: repetido ? 409 : 500 }
    );
  }

  const { error: errorRenglones } = await admin
    .from("mant_partes_contratista_renglones")
    .insert(reparto.renglones.map((r, i) => ({
      parte_id: parte.id,
      orden: i + 1,
      actividad: r.actividad,
      lugar_raw: r.lugar_raw,
      sector_id: renglones[i]?.sector_id || null,
      equipo_id: renglones[i]?.equipo_id || null,
      horas: r.horas,
    })));

  if (errorRenglones) {
    // Un parte sin renglones no sirve para nada y además ocupa su número, así
    // que se deshace. Es seguro: nada apunta todavía a esta fila y las OT se
    // generan después, nunca acá.
    await admin.from("mant_partes_contratista").delete().eq("id", parte.id);
    return NextResponse.json(
      { error: `No se pudo guardar el detalle, así que el parte no quedó: ${errorRenglones.message}` },
      { status: 500 }
    );
  }

  // ── Lo que el catálogo aprende ──────────────────────────────
  //
  // Cada lugar que vino con sector enganchado queda aprendido, para que la
  // quincena siguiente venga puesto. **No se aprende lo que quedó en null**:
  // enseñarle "no sé" al catálogo no ayuda a nadie y pisaría lo que ya sabe.
  //
  // Un fallo acá no tumba el parte: lo que se pierde es la comodidad de la
  // próxima carga, no el dato. Se dice igual.
  let catalogo_error: string | null = null;
  const aprender = renglones
    .map((r, i) => ({ r, lugar: reparto.renglones[i].lugar_raw }))
    .filter(({ r }) => r.sector_id)
    .map(({ r, lugar }) => ({
      proveedor_id,
      texto: normalizarLugar(lugar),
      texto_original: lugar,
      sector_id: r.sector_id,
      equipo_id: r.equipo_id || null,
      cargado_por: user.id,
    }));

  if (aprender.length > 0) {
    // Por `(proveedor_id, texto)`, que es la clave única: el último enganche
    // gana, que es lo que quiere quien acaba de corregir uno equivocado.
    const { error: e } = await admin
      .from("mant_contratista_lugares")
      .upsert(aprender, { onConflict: "proveedor_id,texto" });
    if (e) {
      catalogo_error =
        `El parte quedó guardado, pero los lugares no se aprendieron: ${e.message}. ` +
        `La próxima carga va a volver a preguntarlos.`;
    }
  }

  return NextResponse.json({ data: parte, horas: reparto.total, catalogo_error });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Falta el id del parte" }, { status: 400 });

  const admin = createAdminClient();

  // Un parte que ya generó OT no se borra: borrarlo dejaría órdenes contando
  // horas que ya no tienen de dónde salir, y la OT no se deshace desde acá.
  const { data: generados } = await admin
    .from("mant_partes_contratista_renglones")
    .select("id")
    .eq("parte_id", id)
    .not("orden_trabajo_id", "is", null)
    .limit(1);

  if (generados && generados.length > 0) {
    return NextResponse.json(
      {
        error:
          "Ese parte ya generó órdenes de trabajo, así que no se puede borrar. " +
          "Si está mal cargado, hay que corregir las OT una por una.",
      },
      { status: 409 }
    );
  }

  const { error } = await admin.from("mant_partes_contratista").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
