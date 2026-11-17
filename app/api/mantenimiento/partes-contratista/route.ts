import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { puedeEditarMantenimiento } from "@/lib/mantenimiento/auth";
import { cuerpoJson } from "@/lib/core/cuerpo";
import { traerTodo } from "@/lib/core/paginado";
import {
  leerElParte, normalizarLugar,
  type CabeceraDelParte, type RenglonDelParte,
} from "@/lib/mantenimiento/partesDeContratista";

/**
 * Los partes diarios del contratista: el papel, tal como está escrito.
 *
 * Esta ruta **no crea ninguna OT**. Guarda la hoja con las horas que quien la
 * cargó le puso a cada renglón; las OT salen después, agrupando una semana
 * entera —ver `./generar/route.ts`—. Separarlo es lo que permite cargar las
 * quince hojas de una quincena sin ir creando órdenes a medias.
 *
 * ── LAS TRES ESCRITURAS, Y LA MISMA PUERTA ──────────────────
 *
 * - **POST** da de alta la hoja.
 * - **PUT** la corrige entera, **mientras ningún renglón haya generado OT**.
 * - **DELETE** la saca, con la misma condición.
 *
 * Esa condición es una sola y es la misma de siempre: **una vez que el renglón
 * es una orden, el papel deja de ser editable desde acá**. Cambiarle las horas
 * dejaría a la OT contando algo que ya no dice el parte, y la OT no se deshace
 * desde el sistema —se borra a mano en la planilla, fila por fila—.
 *
 * El POST y el PUT leen el cuerpo con **la misma función**, `leerElParte`, que
 * es pura y vive en `lib/`: son la misma hoja leída dos veces y con una copia
 * en cada una el día que el control cambie una lo sigue haciendo viejo.
 */

type Admin = ReturnType<typeof createAdminClient>;

/** Las filas de `mant_partes_contratista_renglones`, en el orden del papel. */
function filasDeRenglones(parteId: string, renglones: readonly RenglonDelParte[]) {
  return renglones.map((r, i) => ({
    parte_id: parteId,
    orden: i + 1,
    actividad: r.actividad,
    lugar_raw: r.lugar_raw,
    sector_id: r.sector_id,
    equipo_id: r.equipo_id,
    horas: r.horas,
  }));
}

/**
 * Lo que el catálogo aprende de esta hoja.
 *
 * Cada lugar que vino con sector enganchado queda aprendido, para que la
 * quincena siguiente venga puesto. **No se aprende lo que quedó en null**:
 * enseñarle "no sé" al catálogo no ayuda a nadie y pisaría lo que ya sabe.
 *
 * Un fallo acá no tumba el parte: lo que se pierde es la comodidad de la
 * próxima carga, no el dato. Se dice igual, y por eso devuelve el aviso en vez
 * de lanzar.
 */
async function aprenderLosLugares(
  admin: Admin,
  proveedorId: string,
  renglones: readonly RenglonDelParte[],
  usuarioId: string
): Promise<string | null> {
  const aprender = renglones
    .filter((r) => r.sector_id)
    .map((r) => ({
      proveedor_id: proveedorId,
      texto: normalizarLugar(r.lugar_raw),
      texto_original: r.lugar_raw,
      sector_id: r.sector_id,
      equipo_id: r.equipo_id,
      cargado_por: usuarioId,
    }));
  if (aprender.length === 0) return null;

  // Por `(proveedor_id, texto)`, que es la clave única: el último enganche
  // gana, que es lo que quiere quien acaba de corregir uno equivocado.
  const { error } = await admin
    .from("mant_contratista_lugares")
    .upsert(aprender, { onConflict: "proveedor_id,texto" });
  if (!error) return null;

  return (
    `El parte quedó guardado, pero los lugares no se aprendieron: ${error.message}. ` +
    `La próxima carga va a volver a preguntarlos.`
  );
}

/**
 * Los renglones de un parte que **ya son una orden de trabajo**. Vacío si
 * ninguno lo es; `null` si no se pudo comprobar.
 *
 * Lo preguntan el PUT y el DELETE, y tiene que ser la misma pregunta: un parte
 * que generó no se corrige **ni** se borra. Si la lectura falla, «ninguno
 * generó» sería una conclusión falsa y la escritura seguiría.
 */
async function losQueYaSonOT(admin: Admin, parteId: string): Promise<number | null> {
  const { data, error } = await admin
    .from("mant_partes_contratista_renglones")
    .select("id")
    .eq("parte_id", parteId)
    .not("orden_trabajo_id", "is", null);
  if (error) return null;
  return (data ?? []).length;
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

  const leido = leerElParte(await cuerpoJson(request));
  if (!leido.ok) {
    return NextResponse.json({ error: leido.problemas.join(" "), problemas: leido.problemas }, { status: 400 });
  }
  const { cabecera, renglones, total } = leido;

  const admin = createAdminClient();

  const { data: parte, error } = await admin
    .from("mant_partes_contratista")
    .insert({ ...cabecera, cargado_por: user.id })
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
          ? `El parte ${cabecera.numero} de ese contratista ya está cargado. Los números son ` +
            `correlativos, así que revisá si no es la misma hoja.`
          : `No se pudo guardar el parte: ${error.message}`,
      },
      { status: repetido ? 409 : 500 }
    );
  }

  const { error: errorRenglones } = await admin
    .from("mant_partes_contratista_renglones")
    .insert(filasDeRenglones(parte.id, renglones));

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
  const catalogo_error = await aprenderLosLugares(admin, cabecera.proveedor_id, renglones, user.id);

  return NextResponse.json({ data: parte, horas: total, catalogo_error });
}

/**
 * Corregir un parte entero: la cabecera y los renglones.
 *
 * ── POR QUÉ SE REESCRIBE ENTERO Y NO POR CAMPO ──────────────
 *
 * Porque el control es del parte y no de la celda: los renglones tienen que
 * dar el total que dice el papel, y un PATCH que cambiara unas horas sueltas
 * dejaría el parte sin cerrar sin que nada lo note. `leerElParte` vuelve a
 * correr el mismo control que el alta, así que **un parte corregido cierra o
 * no se guarda**, igual que uno nuevo.
 *
 * Los renglones se borran y se vuelven a insertar. Es seguro porque ninguno
 * generó OT —se comprueba antes— y porque **nada cuelga de esa tabla por clave
 * foránea** (`node scripts/que-cuelga-de.mjs mant_partes_contratista_renglones`),
 * así que borrar una fila no se lleva nada en cascada. Lo que sí se pierde son
 * sus ids, y no los usa nadie: a un renglón se lo nombra por su `orden` dentro
 * del parte.
 *
 * ── LA VENTANA QUE QUEDA ABIERTA ────────────────────────────
 *
 * Entre comprobar que ningún renglón generó y borrarlos hay dos sentencias. Si
 * justo ahí alguien genera la quincena, el borrado se niega a llevarse los que
 * ya tienen orden y el parte quedaría a medias. Por eso el borrado lleva su
 * propia guarda (`orden_trabajo_id is null`) y, si no se llevó todo lo que
 * había, **no se inserta nada** y se devuelve un 409 que lo dice. Es la misma
 * ventana que ya tenía el DELETE, y el mismo riesgo asumido del módulo:
 * generar lo aprieta una persona.
 */
export async function PUT(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!(await puedeEditarMantenimiento(supabase, user.id))) {
    return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  }

  const cuerpo = await cuerpoJson<Record<string, unknown>>(request);
  const id = String(cuerpo?.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "Falta el id del parte" }, { status: 400 });

  const leido = leerElParte(cuerpo);
  if (!leido.ok) {
    return NextResponse.json({ error: leido.problemas.join(" "), problemas: leido.problemas }, { status: 400 });
  }
  const { cabecera, renglones, total } = leido;

  const admin = createAdminClient();

  const { data: existe, error: errorExiste } = await admin
    .from("mant_partes_contratista")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (errorExiste) return NextResponse.json({ error: errorExiste.message }, { status: 500 });
  if (!existe) return NextResponse.json({ error: "No existe ese parte" }, { status: 404 });

  const generados = await losQueYaSonOT(admin, id);
  if (generados === null) {
    return NextResponse.json(
      { error: "No se pudo comprobar si el parte ya generó órdenes de trabajo, así que no se tocó nada." },
      { status: 500 }
    );
  }
  if (generados > 0) {
    return NextResponse.json(
      {
        error:
          "Ese parte ya generó órdenes de trabajo, así que no se puede corregir. " +
          "Las horas quedarían diciendo una cosa en el parte y otra en la OT, y la OT no se " +
          "deshace desde acá: si está mal, hay que corregir las órdenes una por una.",
      },
      { status: 409 }
    );
  }

  const { error: errorCabecera } = await admin
    .from("mant_partes_contratista")
    .update(cabecera)
    .eq("id", id);
  if (errorCabecera) {
    const repetido = (errorCabecera as { code?: string }).code === "23505";
    return NextResponse.json(
      {
        error: repetido
          ? `Ya hay otro parte ${cabecera.numero} de ese contratista. Los números son ` +
            `correlativos, así que revisá cuál de los dos es.`
          : `No se pudo guardar el parte: ${errorCabecera.message}`,
      },
      { status: repetido ? 409 : 500 }
    );
  }

  // Cuántos había antes de borrar. Es lo único que permite darse cuenta de que
  // el borrado dejó alguno, o sea de que generó entre la comprobación y acá.
  const { count: habia } = await admin
    .from("mant_partes_contratista_renglones")
    .select("id", { count: "exact", head: true })
    .eq("parte_id", id);

  const { data: borrados, error: errorBorrado } = await admin
    .from("mant_partes_contratista_renglones")
    .delete()
    .eq("parte_id", id)
    .is("orden_trabajo_id", null)
    .select("id");
  if (errorBorrado) {
    return NextResponse.json(
      { error: `La cabecera se guardó pero el detalle no se pudo reemplazar: ${errorBorrado.message}` },
      { status: 500 }
    );
  }
  if ((borrados ?? []).length !== (habia ?? 0)) {
    return NextResponse.json(
      {
        error:
          "Alguno de los renglones se convirtió en una orden de trabajo mientras se guardaba, " +
          "así que el detalle no se reemplazó. Volvé a abrir el parte y mirá cómo quedó.",
      },
      { status: 409 }
    );
  }

  const { error: errorRenglones } = await admin
    .from("mant_partes_contratista_renglones")
    .insert(filasDeRenglones(id, renglones));
  if (errorRenglones) {
    // El parte quedó sin detalle, y eso no sirve para nada. Inventarle uno
    // sería peor: se dice con todas las letras para que alguien lo cargue.
    return NextResponse.json(
      {
        error:
          `El detalle no se pudo guardar y el parte quedó sin renglones: ${errorRenglones.message}. ` +
          `Volvé a cargarlo antes de generar la quincena.`,
      },
      { status: 500 }
    );
  }

  const catalogo_error = await aprenderLosLugares(admin, cabecera.proveedor_id, renglones, user.id);

  return NextResponse.json({ data: { id }, horas: total, catalogo_error });
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
  // Es la misma pregunta que hace el PUT, hecha con la misma función.
  const generados = await losQueYaSonOT(admin, id);
  if (generados === null) {
    return NextResponse.json(
      { error: "No se pudo comprobar si el parte ya generó órdenes de trabajo, así que no se borró nada." },
      { status: 500 }
    );
  }

  if (generados > 0) {
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
