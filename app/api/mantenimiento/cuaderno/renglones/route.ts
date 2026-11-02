import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { traerTodo } from "@/lib/core/paginado";
import { normalizarLugar } from "@/lib/mantenimiento/partesDeContratista";
import {
  sePuedenJuntar, sePuedeSeparar, type RenglonDelCuaderno,
} from "@/lib/mantenimiento/cuadernoGrupos";

/**
 * Corregir, juntar y separar los renglones de un cuaderno.
 *
 * - **PATCH** edita un renglón: las seis columnas que se chequean en pantalla
 *   (fecha, tarea, sector, equipo, horas y costo) y confirmar el sector que
 *   propuso el sistema. **`lugar_raw` no se edita nunca**: es lo que escribió
 *   PIPARO, la prueba de qué decía el papel.
 * - **POST `{ ids }`** junta: corre `sePuedenJuntar` y, si pasa, les escribe a
 *   todos un `grupo_id` nuevo.
 * - **DELETE `{ grupo_id }`** separa: lo pone en null.
 *
 * Un renglón ya convertido en OT no se toca por ninguna de las tres puntas:
 * cambiarle las horas, o sacarlo de su grupo, dejaría a la orden contando algo
 * que ya no es lo que dice el papel, y la OT no se deshace desde acá.
 *
 * Lecturas con el cliente de sesión (RLS ya filtra por `mant_puede_ver()`),
 * escrituras con el admin.
 */

/** Un `.in()` con muchos ids arma una URL que PostgREST rechaza con un 400. */
const MAXIMO_IDS = 200;

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

function fechaValida(f: unknown): f is string {
  if (typeof f !== "string" || !FECHA.test(f)) return false;
  const d = new Date(`${f}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === f;
}

/** Un número que escribió una persona: acepta la coma decimal. Null si no es uno. */
function aNumero(x: unknown): number | null {
  if (typeof x === "number") return Number.isFinite(x) ? x : null;
  if (typeof x === "string" && x.trim() !== "") {
    const n = Number(x.trim().replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const textoOVacio = (x: unknown): x is string => typeof x === "string" && x.trim() !== "";

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const cuerpo = await cuerpoJson<Record<string, unknown>>(request);
  const id = cuerpo.id;
  if (!textoOVacio(id)) return NextResponse.json({ error: "Falta el id del renglón" }, { status: 400 });

  // ── Qué cambia, validado junto ──────────────────────────────
  // Se informan todos los problemas a la vez, y se distingue «no vino» de «vino
  // en null»: borrar el sector o el precio es una decisión, no un olvido.
  const problemas: string[] = [];
  const cambios: Record<string, unknown> = {};

  if ("fecha" in cuerpo) {
    if (cuerpo.fecha === null) cambios.fecha = null;
    else if (fechaValida(cuerpo.fecha)) cambios.fecha = cuerpo.fecha;
    else problemas.push("La fecha tiene que ser un día válido, como 2026-09-17.");
  }
  if ("tarea" in cuerpo) {
    if (textoOVacio(cuerpo.tarea)) cambios.tarea = cuerpo.tarea.trim();
    else problemas.push("La tarea no puede quedar vacía.");
  }
  for (const campo of ["horas", "costo"] as const) {
    if (!(campo in cuerpo)) continue;
    if (cuerpo[campo] === null) { cambios[campo] = null; continue; }
    const n = aNumero(cuerpo[campo]);
    if (n === null || n < 0) problemas.push(`${campo === "horas" ? "Las horas" : "El costo"} tienen que ser un número, cero o más.`);
    else cambios[campo] = n;
  }
  for (const campo of ["sector_id", "equipo_id"] as const) {
    if (!(campo in cuerpo)) continue;
    if (cuerpo[campo] === null) cambios[campo] = null;
    else if (textoOVacio(cuerpo[campo])) cambios[campo] = cuerpo[campo];
    else problemas.push(`${campo === "sector_id" ? "El sector" : "El equipo"} no es válido.`);
  }
  const confirmar = cuerpo.confirmar_sector === true;

  if (problemas.length > 0) return NextResponse.json({ error: problemas.join(" ") }, { status: 400 });
  if (Object.keys(cambios).length === 0 && !confirmar) {
    return NextResponse.json({ error: "No hay nada que cambiar" }, { status: 400 });
  }

  // ── El renglón ──────────────────────────────────────────────
  const { data: renglon, error: errorLectura } = await supabase
    .from("mant_cuadernos_renglones")
    .select("id, cuaderno_id, lugar_raw, sector_id, orden_trabajo_id")
    .eq("id", id)
    .maybeSingle();
  if (errorLectura) return NextResponse.json({ error: errorLectura.message }, { status: 500 });
  if (!renglon) return NextResponse.json({ error: "No existe ese renglón" }, { status: 404 });
  if (renglon.orden_trabajo_id) {
    return NextResponse.json(
      { error: "Ese renglón ya se convirtió en una orden de trabajo y no se edita desde acá." },
      { status: 409 }
    );
  }

  // Elegir un sector a mano **es** confirmarlo; y quitarlo deja de ser una
  // propuesta. En los dos casos la marca baja. Confirmar sin sector no tiene
  // sentido: no hay nada que confirmar.
  const sectorFinal = "sector_id" in cambios ? (cambios.sector_id as string | null) : renglon.sector_id;
  if (confirmar && !sectorFinal) {
    return NextResponse.json({ error: "El renglón no tiene sector para confirmar." }, { status: 400 });
  }
  if ("sector_id" in cambios || confirmar) cambios.sector_propuesto = false;

  const admin = createAdminClient();
  // `orden_trabajo_id is null` también en el update: si la generación lo
  // convirtió entre la lectura y acá, no se le pisa nada.
  const { data: guardado, error } = await admin
    .from("mant_cuadernos_renglones")
    .update(cambios)
    .eq("id", id)
    .is("orden_trabajo_id", null)
    .select("id, foto_id, linea, fecha, tarea, lugar_raw, sector_id, sector_propuesto, equipo_id, horas, costo, dudoso, motivo_dudoso, heredado, grupo_id, orden_trabajo_id")
    .maybeSingle();
  if (error) {
    // 23503: el sector o el equipo no existe en el catálogo.
    const faltaCatalogo = (error as { code?: string }).code === "23503";
    return NextResponse.json(
      { error: faltaCatalogo ? "Ese sector o ese equipo no existe en el catálogo." : `No se pudo guardar: ${error.message}` },
      { status: faltaCatalogo ? 400 : 500 }
    );
  }
  if (!guardado) {
    return NextResponse.json({ error: "El renglón se convirtió en una orden mientras lo editabas." }, { status: 409 });
  }

  // ── Lo que el catálogo aprende ──────────────────────────────
  //
  // Cuando una persona fija o confirma el sector, **el lugar queda aprendido**
  // para el próximo cuaderno. La clave es `normalizarLugar(lugar_raw)` y no la
  // línea entera: lo que se repite de un día al otro es el lugar («P/Trit N°3»),
  // y una clave con la tarea pegada no volvería a aparecer nunca.
  //
  // **El equipo no se aprende.** El `equipo_id` de este renglón es el de *esta*
  // tarea («cinta 9»), pero el lugar casi siempre es un sector entero: guardarlo
  // se le pegaría a todos los renglones futuros de ese lugar. El enganche lo
  // vuelve a leer de la línea cuando el texto lo nombra. El costo de no
  // guardarlo es elegirlo otra vez en un lugar que sea una sola máquina; el de
  // guardarlo mal es un equipo equivocado que nadie nota. Y como el upsert pisa
  // la fila, un equipo que hubiera quedado de antes se borra: «el último
  // enganche gana», igual que en los partes de Candia.
  //
  // Un fallo acá no tumba la corrección: lo que se pierde es la comodidad de la
  // próxima carga, no el dato. Se dice igual.
  let catalogo_error: string | null = null;
  const lugar = (renglon.lugar_raw ?? "").trim();
  const aprendeSector = ("sector_id" in cuerpo && sectorFinal) || confirmar;
  if (aprendeSector && sectorFinal && normalizarLugar(lugar)) {
    try {
      const { data: carga, error: errorCarga } = await supabase
        .from("mant_cuadernos")
        .select("proveedor_id")
        .eq("id", renglon.cuaderno_id)
        .maybeSingle();
      if (errorCarga || !carga) throw new Error(errorCarga?.message ?? "no se encontró la carga");

      const { error: e } = await admin.from("mant_contratista_lugares").upsert(
        {
          proveedor_id: carga.proveedor_id,
          texto: normalizarLugar(lugar),
          texto_original: lugar,
          sector_id: sectorFinal,
          equipo_id: null,
          cargado_por: user.id,
        },
        { onConflict: "proveedor_id,texto" }
      );
      if (e) throw new Error(e.message);
    } catch (e) {
      catalogo_error =
        `El renglón quedó guardado, pero el lugar no se aprendió: ${e instanceof Error ? e.message : String(e)}. ` +
        `El próximo cuaderno va a volver a preguntarlo.`;
    }
  }

  return NextResponse.json({ data: guardado, catalogo_error });
}

/**
 * Junta renglones en una sola orden de trabajo.
 *
 * Además de `sePuedenJuntar`, **no se saca a nadie de un grupo que ya tiene
 * orden**: el renglón que se llevara dejaría a esa OT contando horas que ya no
 * son las suyas.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { ids: crudos } = await cuerpoJson<{ ids?: unknown }>(request);
  if (!Array.isArray(crudos) || !crudos.every(textoOVacio)) {
    return NextResponse.json({ error: "Falta la lista de renglones a juntar" }, { status: 400 });
  }
  const ids = [...new Set(crudos as string[])];
  if (ids.length > MAXIMO_IDS) {
    return NextResponse.json({ error: `Se pueden juntar hasta ${MAXIMO_IDS} renglones de una vez.` }, { status: 400 });
  }

  try {
    const { data: filas, error } = await supabase
      .from("mant_cuadernos_renglones")
      .select("id, cuaderno_id, foto_id, linea, fecha, tarea, lugar_raw, sector_id, sector_propuesto, equipo_id, horas, costo, dudoso, motivo_dudoso, heredado, grupo_id, orden_trabajo_id")
      .in("id", ids);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const elegidos = (filas ?? []) as unknown as (RenglonDelCuaderno & { cuaderno_id: string })[];
    if (elegidos.length !== ids.length) {
      return NextResponse.json({ error: "Alguno de los renglones ya no existe." }, { status: 404 });
    }
    // Un grupo es de un solo cuaderno: no se mezclan las horas de dos cargas.
    if (new Set(elegidos.map((r) => r.cuaderno_id)).size > 1) {
      return NextResponse.json({ error: "Los renglones son de cargas distintas y no se pueden juntar." }, { status: 400 });
    }

    const problemas = sePuedenJuntar(elegidos);

    // Los grupos de los que se sacaría a alguien.
    const gruposViejos = [...new Set(elegidos.map((r) => r.grupo_id).filter((g): g is string => !!g))];
    if (gruposViejos.length > 0) {
      const companeros = await traerTodo((d, h) =>
        supabase
          .from("mant_cuadernos_renglones")
          .select("id, grupo_id, orden_trabajo_id")
          .in("grupo_id", gruposViejos)
          .order("id")
          .range(d, h)
      );
      for (const g of gruposViejos) {
        const del = companeros.filter((c) => c.grupo_id === g) as unknown as RenglonDelCuaderno[];
        if (sePuedeSeparar(del).length > 0) {
          problemas.push("Uno de los renglones viene de un grupo que ya tiene una orden de trabajo y no se lo puede sacar de ahí.");
        }
      }
    }

    if (problemas.length > 0) return NextResponse.json({ error: problemas.join(" "), problemas }, { status: 400 });

    const grupo_id = crypto.randomUUID();
    const admin = createAdminClient();
    const { data: escritos, error: errorEscritura } = await admin
      .from("mant_cuadernos_renglones")
      .update({ grupo_id })
      .in("id", ids)
      .is("orden_trabajo_id", null)
      .select("id");
    if (errorEscritura) {
      return NextResponse.json({ error: `No se pudo juntar: ${errorEscritura.message}` }, { status: 500 });
    }
    if ((escritos ?? []).length !== ids.length) {
      // La generación convirtió alguno entre la lectura y la escritura. No se
      // deshace a ciegas: se dice cuántos quedaron y se deja que se revise.
      return NextResponse.json(
        {
          error:
            `Se juntaron ${(escritos ?? []).length} de ${ids.length} renglones: alguno se convirtió en una orden mientras tanto. ` +
            `Revisá el grupo antes de generar.`,
          grupo_id,
        },
        { status: 409 }
      );
    }

    return NextResponse.json({ grupo_id, ids });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

/** Separa un grupo: sus renglones vuelven a ser sueltos. */
export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const { grupo_id: delCuerpo } = await cuerpoJson<{ grupo_id?: unknown }>(request);
  const grupo_id = textoOVacio(delCuerpo) ? delCuerpo : new URL(request.url).searchParams.get("grupo_id");
  if (!grupo_id) return NextResponse.json({ error: "Falta el grupo a separar" }, { status: 400 });

  try {
    const miembros = await traerTodo((d, h) =>
      supabase
        .from("mant_cuadernos_renglones")
        .select("id, orden_trabajo_id")
        .eq("grupo_id", grupo_id)
        .order("id")
        .range(d, h)
    );
    if (miembros.length === 0) return NextResponse.json({ error: "No existe ese grupo" }, { status: 404 });

    const problemas = sePuedeSeparar(miembros as unknown as RenglonDelCuaderno[]);
    if (problemas.length > 0) return NextResponse.json({ error: problemas.join(" ") }, { status: 409 });

    const admin = createAdminClient();
    const { data: separados, error } = await admin
      .from("mant_cuadernos_renglones")
      .update({ grupo_id: null })
      .eq("grupo_id", grupo_id)
      .is("orden_trabajo_id", null)
      .select("id");
    if (error) return NextResponse.json({ error: `No se pudo separar: ${error.message}` }, { status: 500 });

    return NextResponse.json({ ok: true, separados: (separados ?? []).length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
