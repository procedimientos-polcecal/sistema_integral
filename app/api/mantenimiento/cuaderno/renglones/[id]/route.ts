import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { traerTodo } from "@/lib/core/paginado";
import { auditar, nombreParaAuditoria } from "@/lib/core/auditoria";
import { actualizarElEstado } from "@/lib/mantenimiento/cuadernoEstado";
import { sePuedeSeparar, type RenglonDelCuaderno } from "@/lib/mantenimiento/cuadernoGrupos";

/**
 * Sacar un renglón de una carga del cuaderno.
 *
 * ── PARA QUÉ EXISTE ─────────────────────────────────────────
 *
 * Porque la planilla del contratista trae tareas que **ya tienen su OT cargada
 * a mano**. Octubre de 2026 es el caso: 63 filas en el Excel y 91 órdenes de
 * PIPARO ya escritas en la planilla de Google. El freno de duplicados de la
 * generación avisa que el período está cargado, pero avisar no alcanza: hace
 * falta poder sacar las filas que ya están cubiertas, una por una, mirándolas.
 *
 * La alternativa era dejarlas y no generarlas nunca, y eso deja la carga
 * eternamente en `EN_CHEQUEO` con renglones que nadie sabe por qué no salieron.
 *
 * ── ESTO NO ES «SEPARAR» ────────────────────────────────────
 *
 * El `DELETE` de `/renglones` saca el `grupo_id` y deja el renglón vivo. Éste
 * **borra la fila**. Son dos cosas distintas y por eso están en dos rutas
 * distintas: un `DELETE` que según el cuerpo desagrupa o destruye es el tipo de
 * ambigüedad que se paga una sola vez y cara.
 *
 * ── LO QUE NO SE PUEDE SACAR ────────────────────────────────
 *
 * - El renglón **que ya es una orden de trabajo**: la OT quedaría contando
 *   horas sin nada de dónde hayan salido, y la OT no se deshace desde acá.
 * - El que está en un **grupo que ya generó**: sacarlo le cambia el total a una
 *   orden que ya está escrita en la planilla. Es la misma vara de
 *   `sePuedeSeparar`, y se la llama a ella y no a una copia.
 *
 * ── POR QUÉ SE AUDITA ───────────────────────────────────────
 *
 * El archivo del que salió el renglón sigue en el bucket, así que **qué decía**
 * se puede contestar sin esta tabla. Lo que no: **quién lo sacó y cuándo**. Y
 * estas filas son con lo que se le paga al contratista, así que una que
 * desaparece es una hora que no se factura por el criterio de una persona.
 * Es la pregunta exacta para la que existe `auditoria`.
 *
 * El registro se escribe **antes** del borrado: si no entra, no se borra. Es el
 * orden que fijó `lib/core/borradoDeEspejo.ts`, y vale por lo mismo —auditar
 * después es auditar lo que ya no se puede reconstruir el día que el registro
 * falle—.
 *
 * Hasta acá el verbo `borrar` lo escribían sólo las sincronizaciones. Éste es
 * el primero que escribe una persona, y por eso el `valor_anterior` lleva el
 * renglón entero en una línea legible, además del `contexto`.
 */

/** El renglón en una línea, que es lo que contesta «qué decía». */
function comoSeLee(r: RenglonDelCuaderno): string {
  const partes = [
    r.fecha ?? "sin fecha",
    r.fecha_hasta && r.fecha_hasta !== r.fecha ? `al ${r.fecha_hasta}` : null,
    `«${r.tarea.trim()}»`,
    r.horas === null || r.horas === undefined ? "sin horas" : `${r.horas} h`,
    r.costo ? `$${r.costo}` : null,
    r.lugar_raw ? `lugar: «${r.lugar_raw}»` : null,
    r.linea ? `línea ${r.linea}` : null,
  ];
  return partes.filter(Boolean).join(" · ");
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "Falta el id del renglón" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  try {
    // La cadena del select va literal: armada en una variable, Supabase pierde
    // la inferencia.
    const { data: fila, error: errorLectura } = await supabase
      .from("mant_cuadernos_renglones")
      .select("id, cuaderno_id, foto_id, linea, fecha, fecha_hasta, tarea, lugar_raw, sector_id, sector_propuesto, equipo_id, horas, costo, dudoso, motivo_dudoso, heredado, grupo_id, orden_trabajo_id")
      .eq("id", id)
      .maybeSingle();
    if (errorLectura) return NextResponse.json({ error: errorLectura.message }, { status: 500 });
    if (!fila) return NextResponse.json({ error: "No existe ese renglón" }, { status: 404 });

    const renglon = fila as unknown as RenglonDelCuaderno;

    if (renglon.orden_trabajo_id) {
      return NextResponse.json(
        {
          error:
            "Ese renglón ya se convirtió en una orden de trabajo del sistema, así que no se saca desde acá: " +
            "la orden quedaría sin nada de dónde salieron sus horas. Si está mal, hay que corregir la OT.",
        },
        { status: 409 }
      );
    }

    // Un grupo que ya generó no se toca por ninguna punta: la misma vara que
    // usa separar, llamada a la misma función.
    if (renglon.grupo_id) {
      const companeros = await traerTodo((d, h) =>
        supabase
          .from("mant_cuadernos_renglones")
          .select("id, orden_trabajo_id")
          .eq("grupo_id", renglon.grupo_id as string)
          .order("id")
          .range(d, h)
      );
      const problemas = sePuedeSeparar(companeros as unknown as RenglonDelCuaderno[]);
      if (problemas.length > 0) return NextResponse.json({ error: problemas.join(" ") }, { status: 409 });
    }

    const admin = createAdminClient();

    // ── El registro, antes del borrado ──────────────────────
    const { data: quien } = await supabase
      .from("usuarios")
      .select("nombre, apellido, email")
      .eq("id", user.id)
      .maybeSingle();

    const registro = await auditar(admin, {
      modulo: "mantenimiento",
      entidad: "mant_cuadernos_renglones",
      entidadId: renglon.id,
      accion: "borrar",
      usuario: { id: user.id, nombre: nombreParaAuditoria(quien) },
      valorAnterior: comoSeLee(renglon),
      valorNuevo: null,
      contexto: { cuaderno_id: renglon.cuaderno_id, renglon },
    });
    if (!registro.ok) {
      return NextResponse.json(
        {
          error:
            `No se sacó el renglón porque no se pudo registrar quién lo sacaba: ${registro.error}. ` +
            `Lo que no se deshace queda registrado o no se hace.`,
        },
        { status: 500 }
      );
    }

    // `orden_trabajo_id is null` también acá: si la generación lo convirtió
    // entre la lectura y la escritura, no se lo lleva puesto.
    const { data: borrados, error } = await admin
      .from("mant_cuadernos_renglones")
      .delete()
      .eq("id", id)
      .is("orden_trabajo_id", null)
      .select("id");
    if (error) return NextResponse.json({ error: `No se pudo sacar el renglón: ${error.message}` }, { status: 500 });
    if ((borrados ?? []).length === 0) {
      return NextResponse.json(
        { error: "El renglón se convirtió en una orden de trabajo mientras lo sacabas. No se tocó nada." },
        { status: 409 }
      );
    }

    // Sacar un pendiente puede dejar la carga sin ninguno: el estado se
    // recalcula desde lo que quedó. Si falla no tira el borrado —la fila ya no
    // está y eso es lo que cuenta—: se dice y nada más.
    const falloElEstado = await actualizarElEstado(admin, renglon.cuaderno_id);

    return NextResponse.json({
      ok: true,
      id: renglon.id,
      decia: comoSeLee(renglon),
      aviso: falloElEstado
        ? `El renglón se sacó, pero no se pudo actualizar el estado de la carga: ${falloElEstado}`
        : null,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
