import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { esAdminCompras } from "@/lib/compras/auth";

/**
 * La lista de a quiénes se les avisa cuando Mantenimiento pregunta por un
 * repuesto: `compras_consultados`.
 *
 * Tercera lista de la pantalla de configuración, hermana de `compras_aprobadores`
 * y de `os_aprobadores`, y con la misma guardia a propósito: administrarla es
 * tarea de administración del módulo. Si alcanzara con estar en ella, cualquiera
 * de la lista podría sacar a los demás. Que tres secciones contiguas se editen
 * con reglas distintas es de las cosas que nadie descubre hasta que a alguien le
 * falta un botón.
 *
 * **Sin alias**, como la de OS: el alias de `compras_aprobadores` es con qué
 * texto figura cada uno en el desplegable estricto de la planilla, y acá no hay
 * ninguna planilla que firmar.
 *
 * ── LAS DOS DIFERENCIAS CON LAS HERMANAS ─────────────────────────────────────
 *
 * **Estar en esta lista no es un permiso: es ser el destinatario de un aviso.**
 * Allá, estar en la lista ES poder aprobar. Acá no habilita nada: contestar una
 * consulta lo habilita el acceso a Compras más que haya una pregunta abierta
 * (`puedeResponderConsulta`), así que quien cubre a alguien de licencia contesta
 * sin que nadie edite esto. Lo único que decide esta tabla es a quién le suena el
 * teléfono (`avisarAQuienDecide`, y el aviso `compras-consultas-repuestos` del
 * resumen diario).
 *
 * De ahí sale la segunda, que es la que hay que cuidar al editar este archivo:
 * **no hay guarda del último**. Las dos hermanas llaman a `puedeQuitarDeLaLista`
 * / `puedeQuitarDeLaListaDeOS` y devuelven 409 antes de vaciar la lista, porque
 * sin nadie que apruebe ningún requerimiento avanza y ninguna OS pasa a
 * comparativa. Vaciar ésta no traba nada: las preguntas abiertas se siguen
 * pudiendo contestar y una pregunta nueva se guarda igual en la orden, sólo que
 * no interrumpe a nadie —`avisarAQuienDecide` devuelve «nadie aprueba» y
 * `queDecirDelAviso` se lo dice a quien preguntó, con dónde se arma la lista—.
 * Copiar esa guarda al traer el resto de la sección sería inventar un permiso que
 * esta lista no es; hay un test negativo que lo fija
 * (`lib/compras/rutaDeLaListaDeConsultados.test.ts`).
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function guardia(supabase: Supabase) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };
  }

  if (!(await esAdminCompras(supabase, user.id))) {
    return {
      error: NextResponse.json(
        {
          error:
            "Administrar quién contesta las consultas de repuestos requiere nivel " +
            "de administrador del módulo",
        },
        { status: 403 }
      ),
    };
  }
  return { user };
}

/** Alta: sumar a alguien a la lista. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const g = await guardia(supabase);
  if (g.error) return g.error;

  const body = await request.json().catch(() => null);
  const usuarioId = String(body?.usuario_id ?? "").trim();
  if (!usuarioId) return NextResponse.json({ error: "Falta el usuario" }, { status: 400 });

  // `upsert` y no `insert`: poner a alguien que ya está es lo que se pidió, no un
  // error que mostrar. Pasa con dos administradores a la vez o con el botón
  // apretado dos veces, y un 23505 ahí no le dice nada a nadie.
  const { data, error } = await createAdminClient()
    .from("compras_consultados")
    .upsert({ usuario_id: usuarioId }, { onConflict: "usuario_id" })
    .select("usuario_id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data, { status: 201 });
}

/**
 * Baja: sacar a alguien de la lista.
 *
 * Sin comprobar cuántos quedan, a propósito: ver el encabezado.
 */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const g = await guardia(supabase);
  if (g.error) return g.error;

  const usuarioId = new URL(request.url).searchParams.get("usuario_id") ?? "";
  if (!usuarioId) return NextResponse.json({ error: "Falta el usuario" }, { status: 400 });

  const { error } = await createAdminClient()
    .from("compras_consultados")
    .delete()
    .eq("usuario_id", usuarioId);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
