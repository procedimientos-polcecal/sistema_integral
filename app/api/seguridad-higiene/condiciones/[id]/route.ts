import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { nivelSyhDe } from "@/lib/seguridadHigiene/auth";
import {
  camposDeAdminEnviados,
  esquemaDeCambio,
  problemaDelLugarResultante,
} from "@/lib/seguridadHigiene/cambioDeCondicion";
import { validar, errorDeValidacion } from "@/lib/core/validar";
import { hoyEnArgentina } from "@/lib/core/fechas";

/**
 * Una condición insegura: corregirla o completarla (PATCH) y ver sus fotos (GET).
 *
 * Igual que el alta, va con el cliente del usuario y **no** con el admin, para
 * que corran las policies y el trigger `syh_condiciones_proteger_gestion`. La
 * ruta contesta antes con el nombre del campo; el trigger queda de segunda
 * línea, para quien le hable a la base sin pasar por acá.
 *
 * ── LA AUDITORÍA: SE MIRÓ Y NO SE AGREGA ────────────────────
 *
 * Cerrar una condición la saca de la lista de lo que hay que arreglar, pero no
 * mueve plata ni stock ni escribe en Odoo, y **se deshace** borrando la fecha
 * de ejecución (reabrir): no hay nada que se pierda. La fila sigue ahí, con su
 * número, quién la detectó y qué se vio. Lo que `auditar()` cubre en este repo
 * es lo que no tiene vuelta atrás, y esto la tiene.
 *
 * Lo único que se pierde al corregir es el valor anterior (un puntaje, una
 * fecha máxima) y quién lo cambió; `actualizada_en` dice cuándo. Si algún día
 * importa saber quién cerró qué, el verbo `cerrar` ya existe en `ACCIONES` y no
 * pide migración: sería una llamada a `auditar()` en el `if` de `fecha_ejecucion`.
 */

const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!ES_UUID.test(id)) {
    return NextResponse.json({ error: "No existe esa condición" }, { status: 404 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  // Un solo nivel y de ahí los dos permisos, en vez de preguntar dos veces:
  // `esAdminSyh` y `puedeEditarSyh` son el mismo cálculo con otro corte.
  const nivel = await nivelSyhDe(supabase, user.id);
  const esAdmin = nivel === "admin";
  const puedeEditar = esAdmin || nivel === "edicion";
  if (!puedeEditar) {
    return NextResponse.json(
      { error: "No tenés permiso para corregir condiciones inseguras" },
      { status: 403 }
    );
  }

  const cuerpo = await request.json().catch(() => null);
  if (typeof cuerpo !== "object" || cuerpo === null || Array.isArray(cuerpo)) {
    return NextResponse.json({ error: "El pedido no trae un cuerpo válido" }, { status: 400 });
  }

  // El 403 con el nombre del campo, antes de validar nada y antes del trigger.
  if (!esAdmin) {
    const pedidos = camposDeAdminEnviados(cuerpo);
    if (pedidos.length > 0) {
      return NextResponse.json(
        {
          error:
            `Evaluar el riesgo, asignar y cerrar una condición requiere nivel admin en Seguridad e Higiene. ` +
            `No podés cambiar: ${pedidos.join(", ")}.`,
        },
        { status: 403 }
      );
    }
  }

  const r = validar(esquemaDeCambio, cuerpo);
  if (!r.ok) return errorDeValidacion(r.problemas);
  const cambio = r.datos;

  if (Object.keys(cambio).length === 0) {
    return NextResponse.json({ error: "No hay nada para cambiar" }, { status: 400 });
  }

  // Cerrar con una fecha futura la sacaría de la lista de lo pendiente por algo
  // que todavía no pasó.
  if (cambio.fecha_ejecucion && cambio.fecha_ejecucion > hoyEnArgentina()) {
    return NextResponse.json(
      { error: "La fecha de ejecución no puede ser futura" },
      { status: 400 }
    );
  }

  const { data: actual, error: errorDeLectura } = await supabase
    .from("syh_condiciones")
    .select("id, sector_id, equipo_id, fecha_ejecucion")
    .eq("id", id)
    .maybeSingle();
  if (errorDeLectura) {
    return NextResponse.json(
      { error: `No se pudo leer la condición: ${errorDeLectura.message}` },
      { status: 500 }
    );
  }
  if (!actual) return NextResponse.json({ error: "No existe esa condición" }, { status: 404 });

  // Una cerrada ya no es de la primera etapa: la policy de `edicion` la deja
  // afuera y un update contra ella no toca ninguna fila.
  if (actual.fecha_ejecucion && !esAdmin) {
    return NextResponse.json(
      { error: "La condición está cerrada: sólo un admin puede corregirla o reabrirla" },
      { status: 403 }
    );
  }

  const problemaDelLugar = problemaDelLugarResultante(actual, cambio);
  if (problemaDelLugar) return NextResponse.json({ error: problemaDelLugar }, { status: 400 });

  const { data, error } = await supabase
    .from("syh_condiciones")
    .update({
      ...cambio,
      // Un texto vacío en las observaciones es borrarlas.
      ...("observaciones" in cambio ? { observaciones: cambio.observaciones?.trim() || null } : {}),
      actualizada_en: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*, sectores(nombre), equipos(name, code), syh_peligros(nombre)")
    .maybeSingle();

  if (error) {
    // El trigger y RLS (42501) hablan en castellano y su rechazo es definitivo.
    if (error.code === "42501") {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    // Un id que no existe (sector, equipo, peligro o responsable).
    if (error.code === "23503") {
      return NextResponse.json(
        { error: "El sector, el equipo, el peligro o el responsable elegido no existe" },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: `No se pudo guardar el cambio: ${error.message}` },
      { status: 500 }
    );
  }
  // Cero filas sin error: RLS la dejó afuera (se cerró mientras tanto).
  if (!data) {
    return NextResponse.json(
      { error: "No se pudo guardar: la condición cambió mientras la editabas. Recargá la pantalla." },
      { status: 409 }
    );
  }

  return NextResponse.json({ data });
}

/**
 * Las fotos de la condición, con un link firmado para verlas y otro para
 * bajarlas. Las dos firmas duran una hora —lo que dura la ficha abierta—, y
 * quien necesite más pide otras: el bucket es privado y no hay links eternos.
 *
 * Se firma con el cliente del usuario: la policy de lectura del bucket es la
 * misma `tiene_acceso_syh()` que la de la tabla, así que no hace falta el
 * cliente admin ni repetir el permiso a mano.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!ES_UUID.test(id)) {
    return NextResponse.json({ error: "No existe esa condición" }, { status: 404 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  if ((await nivelSyhDe(supabase, user.id)) === null) {
    return NextResponse.json({ error: "Sin acceso a Seguridad e Higiene" }, { status: 403 });
  }

  const { data: condicion, error: errorDeCondicion } = await supabase
    .from("syh_condiciones")
    .select("numero")
    .eq("id", id)
    .maybeSingle();
  if (errorDeCondicion) {
    return NextResponse.json(
      { error: `No se pudo leer la condición: ${errorDeCondicion.message}` },
      { status: 500 }
    );
  }
  if (!condicion) return NextResponse.json({ error: "No existe esa condición" }, { status: 404 });

  const { data: fotos, error } = await supabase
    .from("syh_fotos")
    .select("id, ruta, subida_el")
    .eq("condicion_id", id)
    .order("subida_el");
  if (error) {
    return NextResponse.json(
      { error: `No se pudieron leer las fotos: ${error.message}` },
      { status: 500 }
    );
  }

  const bucket = supabase.storage.from("syh-fotos");
  const UNA_HORA = 60 * 60;

  const firmadas = await Promise.all(
    (fotos ?? []).map(async (f, i) => {
      const extension = f.ruta.includes(".") ? f.ruta.split(".").pop() : "jpg";
      const [ver, bajar] = await Promise.all([
        bucket.createSignedUrl(f.ruta, UNA_HORA),
        bucket.createSignedUrl(f.ruta, UNA_HORA, {
          download: `condicion-${condicion.numero}-foto-${i + 1}.${extension}`,
        }),
      ]);
      return {
        id: f.id,
        subida_el: f.subida_el,
        // Sin link se dice: una foto que no se puede abrir se muestra como tal,
        // no desaparece de la lista.
        link: ver.data?.signedUrl ?? null,
        descarga: bajar.data?.signedUrl ?? null,
        error: ver.error?.message ?? null,
      };
    })
  );

  return NextResponse.json({ data: firmadas });
}
