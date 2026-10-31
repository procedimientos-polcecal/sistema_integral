import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { nivelSyhDe, noSePudoAveriguar } from "@/lib/seguridadHigiene/auth";
import {
  camposDeAdminEnviados,
  esquemaDeCambio,
  problemaDelLugarResultante,
} from "@/lib/seguridadHigiene/cambioDeCondicion";
import { auditar, nombreParaAuditoria } from "@/lib/core/auditoria";
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
 * ── QUÉ SE AUDITA ACÁ Y QUÉ NO ──────────────────────────────
 *
 * **Cerrar no se audita, y eso no cambió.** Cerrar una condición la saca de la
 * lista de lo que hay que arreglar, pero no mueve plata ni stock ni escribe en
 * Odoo, y **se deshace** borrando la fecha de ejecución: no hay nada que se
 * pierda. La fila sigue ahí, con su número, quién la detectó y qué se vio. Lo
 * que `auditar()` cubre en este repo es lo que no tiene vuelta atrás.
 *
 * **Las dos que sí, desde el 31/10/2026, son las que destruyen un dato:**
 *
 *   * **Reabrir** borra la fecha de ejecución. Esa fecha es el único lugar
 *     donde quedaba cuándo se arregló la condición: después de reabrir no hay
 *     de dónde sacarla, así que es el reverso exacto del argumento de arriba
 *     —cerrar se deshace **porque** reabrir no—.
 *   * **Corregir un puntaje que ya tenía valor.** `nivel_riesgo` es una
 *     columna generada sobre los cinco, así que cambiar uno reescribe la
 *     clasificación entera y el número de antes no queda en ningún lado.
 *     Poner un puntaje por primera vez **no** entra: no destruye nada.
 *
 * Las dos son el verbo `corregir` —el único de los nueve que no es un acto en
 * una dirección sino el paso de un valor a otro— y por eso llevan
 * `valor_anterior` y `valor_nuevo`: sin el par el registro diría que alguien
 * corrigió algo y no qué. `corregir` ya está en `ACCIONES` y en el check de la
 * tabla (`20261026080102`), así que esto no pidió migración.
 *
 * Y el registro va **antes** del update, como el borrado de espejo: si no
 * entra, no se cambia nada. Auditar después dejaría el caso en que el cambio
 * ya está hecho y el rastro no.
 */

const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Los cinco puntajes del riesgo, en el orden en que los pide la planilla. */
const PUNTAJES = ["frecuencia", "antecedentes", "controles", "magnitud_dano", "legislacion"] as const;

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

  // Corregir y borrar fotos son las dos escrituras que faltaban mirar esto: un
  // usuario desactivado con la sesión viva podía seguir corrigiendo condiciones
  // ajenas. Ninguna función de la base lo mira —`tiene_acceso_syh()` y las dos
  // de abajo sólo miran los grants—, así que si no está acá no está en ningún
  // lado. El fallo de la lectura es un 503 y no un 403, igual que en el alta.
  const { data: usuario, error: errorDelUsuario } = await supabase
    .from("usuarios")
    .select("activo")
    .eq("id", user.id)
    .maybeSingle();
  if (errorDelUsuario) {
    return NextResponse.json(
      { error: `No se pudo comprobar tu usuario: ${errorDelUsuario.message}` },
      { status: 503 }
    );
  }
  if (!usuario?.activo) {
    return NextResponse.json({ error: "Tu usuario está desactivado" }, { status: 403 });
  }

  // Un solo nivel y de ahí los dos permisos, en vez de preguntar dos veces:
  // `esAdminSyh` y `puedeEditarSyh` son el mismo cálculo con otro corte.
  const permiso = await nivelSyhDe(supabase, user.id);
  if (!permiso.ok) return noSePudoAveriguar(permiso);
  const nivel = permiso.nivel;
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

  // Los cinco puntajes y el número entran en el `select` porque son lo que el
  // registro de auditoría necesita guardar antes de pisarlos: leerlos después
  // ya es tarde.
  const { data: actual, error: errorDeLectura } = await supabase
    .from("syh_condiciones")
    .select(
      "id, numero, sector_id, equipo_id, fecha_ejecucion, nivel_riesgo, frecuencia, antecedentes, controles, magnitud_dano, legislacion"
    )
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

  const sinRegistro = await problemaDeAuditoria(supabase, user.id, actual, cambio);
  if (sinRegistro) return sinRegistro;

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

/** La condición como está hoy, con lo que el registro necesita antes de pisarlo. */
interface CondicionActual {
  id: string;
  numero: number | null;
  fecha_ejecucion: string | null;
  nivel_riesgo: number | null;
  frecuencia: number | null;
  antecedentes: number | null;
  controles: number | null;
  magnitud_dano: number | null;
  legislacion: number | null;
}

/**
 * Registra lo que este cambio va a destruir, **antes** de destruirlo.
 *
 * Qué entra y qué no está en el encabezado del archivo. Lo que se decide acá es
 * que **es una sola fila por PATCH y no una por campo**: `nivel_riesgo` es una
 * columna generada sobre los cinco puntajes, así que una corrección que toca
 * tres es un solo acto con una sola clasificación antes y otra después; tres
 * filas contarían la misma corrección a medias y ninguna de las tres diría cuál
 * era el nivel.
 *
 * Devuelve la respuesta de error, o null si no había nada que registrar o si
 * quedó registrado.
 */
async function problemaDeAuditoria(
  supabase: SupabaseClient,
  usuarioId: string,
  actual: CondicionActual,
  cambio: Record<string, unknown>
): Promise<NextResponse | null> {
  const partes: { que: string; anterior: string; nuevo: string }[] = [];

  // Reabrir. Es el reverso del argumento por el que cerrar no se audita: cerrar
  // se deshace **porque** esto borra la fecha, y después de borrarla no hay de
  // dónde sacar cuándo se había arreglado.
  if ("fecha_ejecucion" in cambio && actual.fecha_ejecucion && !cambio.fecha_ejecucion) {
    partes.push({
      que: "reabrir",
      anterior: `ejecutada el ${actual.fecha_ejecucion}`,
      nuevo: "reabierta (sin fecha de ejecución)",
    });
  }

  // Sólo los puntajes que **ya tenían** valor: ponerlo por primera vez no
  // destruye nada, y auditar eso llenaría la tabla con las 35 condiciones que
  // el módulo existe para que alguien evalúe.
  const pisados = PUNTAJES.filter(
    (c) => c in cambio && actual[c] !== null && cambio[c] !== actual[c]
  );
  if (pisados.length > 0) {
    const comoEstaba = pisados.map((c) => `${c} ${actual[c]}`).join(", ");
    const comoQueda = pisados.map((c) => `${c} ${cambio[c] ?? "sin puntaje"}`).join(", ");
    partes.push({
      que: "puntajes",
      anterior: `${comoEstaba} (nivel ${actual.nivel_riesgo ?? "sin calcular"})`,
      nuevo: comoQueda,
    });
  }

  if (partes.length === 0) return null;

  const { data: quien } = await supabase
    .from("usuarios")
    .select("nombre, apellido, email")
    .eq("id", usuarioId)
    .maybeSingle();

  const registro = await auditar(supabase, {
    modulo: "seguridad_higiene",
    entidad: "syh_condiciones",
    entidadId: actual.id,
    accion: "corregir",
    usuario: { id: usuarioId, nombre: nombreParaAuditoria(quien) },
    valorAnterior: partes.map((p) => p.anterior).join(" · "),
    valorNuevo: partes.map((p) => p.nuevo).join(" · "),
    contexto: {
      ruta: "seguridad-higiene/condiciones/[id]",
      numero: actual.numero,
      que: partes.map((p) => p.que),
    },
  });

  if (!registro.ok) {
    return NextResponse.json(
      {
        error:
          `No se pudo registrar la corrección en la auditoría, así que no se cambió ` +
          `nada: ${registro.error}`,
      },
      { status: 500 }
    );
  }
  return null;
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

  const permiso = await nivelSyhDe(supabase, user.id);
  if (!permiso.ok) return noSePudoAveriguar(permiso);
  if (permiso.nivel === null) {
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
