import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { esAdminVentas, noSePudoAveriguar, puedeEditarVentas } from "@/lib/ventas/auth";
import { validar, errorDeValidacion } from "@/lib/core/validar";

/**
 * Escribir los clientes que la previsualización marcó como nuevos.
 *
 * ── POR QUÉ RECIBE LAS FILAS Y NO EL ARCHIVO OTRA VEZ ───────
 *
 * Porque lo que se confirma es **lo que la persona vio**. Volver a subir el
 * archivo obligaría a reinterpretarlo, y entre la previsualización y el clic la
 * interpretación podría dar otra cosa —alguien cargó un cliente con ese CUIT en
 * el medio, o se corrigió un alias de columna—: se escribiría algo distinto de
 * lo que se aprobó, sin que nada avise.
 *
 * El costo es que el cuerpo lo arma el navegador y podría venir tocado. Se paga
 * barato: acá se valida **campo por campo con zod**, igual que el alta de a
 * uno, y el `unique` del CUIT y las policies de la tabla siguen siendo el
 * último control. Lo que no se puede hacer desde acá es nada que no se pueda
 * hacer desde el alta normal.
 *
 * ── NO PISA NADA, NUNCA ─────────────────────────────────────
 *
 * Es un `insert` y no un upsert. Un cliente que ya está se saltea en la
 * previsualización, y si alguien lo cargó en el medio, el `unique` del CUIT lo
 * rechaza y esta ruta lo cuenta aparte en vez de cortar: con 300 filas, perder
 * las 299 buenas por una que chocó sería lo peor que podría hacer.
 *
 * ── DE A LOTES, Y EL RESULTADO DICE QUÉ ENTRÓ ───────────────
 *
 * Un `insert` de 300 filas de una arma una URL y un cuerpo que PostgREST puede
 * rechazar, y además un fallo se lleva las 300. En lotes de 50 un choque deja
 * afuera 50 como mucho, y el resultado dice cuántas entraron y cuáles no.
 */

export const maxDuration = 120;

/**
 * Lo mismo que acepta el alta de a uno, más `vendedor_id`.
 *
 * `vendedor_id` viene resuelto por la previsualización contra los usuarios
 * activos, así que acá ya es un uuid: lo que no se reconoció llegó en null. Y
 * como asignar vendedor es de `admin` —igual que en el PATCH de un cliente—,
 * si viene alguno se comprueba el nivel antes de escribir.
 */
const esquemaDeFila = z.object({
  razon_social: z.string().trim().refine((t) => t.length > 0, "Falta la razón social"),
  nombre_fantasia: z.string().nullish(),
  cuit: z.string().nullish(),
  estado: z.literal(["prospecto", "activo", "inactivo"]),
  localidad: z.string().nullish(),
  provincia: z.string().nullish(),
  rubro: z.string().nullish(),
  telefono: z.string().nullish(),
  email: z.string().nullish(),
  sitio_web: z.string().nullish(),
  origen: z.string().nullish(),
  vendedor_id: z.guid().nullish(),
  notas: z.string().nullish(),
});

/**
 * El tope de filas por confirmación.
 *
 * No es una limitación técnica sino un freno con el mismo espíritu que el de
 * `borradoDeEspejo`: una confirmación de miles de filas es casi siempre un
 * archivo equivocado, y es mejor que falle diciendo el número a que entre.
 */
const MAXIMO_DE_FILAS = 2000;

const esquema = z.object({
  clientes: z
    .array(esquemaDeFila)
    .min(1, "No hay ningún cliente para importar")
    .max(MAXIMO_DE_FILAS, `No se pueden importar más de ${MAXIMO_DE_FILAS} clientes de una vez`),
});

/** De a 50: un choque deja afuera 50 como mucho, y no las 300. */
const LOTE = 50;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const permiso = await puedeEditarVentas(supabase, user.id);
  if (!permiso.ok) return noSePudoAveriguar(permiso);
  if (!permiso.si) {
    return NextResponse.json({ error: "No tenés permiso para cargar clientes" }, { status: 403 });
  }

  const r = validar(esquema, await request.json().catch(() => null));
  if (!r.ok) return errorDeValidacion(r.problemas);
  const { clientes } = r.datos;

  // Asignar vendedor es de `admin`, igual que en el PATCH de un cliente. Se
  // comprueba una vez y no por fila.
  if (clientes.some((c) => c.vendedor_id)) {
    const esAdmin = await esAdminVentas(supabase, user.id);
    if (!esAdmin.ok) return noSePudoAveriguar(esAdmin);
    if (!esAdmin.si) {
      return NextResponse.json(
        {
          error:
            "El archivo asigna vendedor y eso requiere nivel admin en Ventas. " +
            "Sacá la columna Vendedor y volvé a importar, o pedile a un administrador que lo haga.",
        },
        { status: 403 }
      );
    }
  }

  const aInsertar = clientes.map((c) => ({
    razon_social: c.razon_social,
    nombre_fantasia: c.nombre_fantasia ?? null,
    cuit: c.cuit ?? null,
    estado: c.estado,
    localidad: c.localidad ?? null,
    provincia: c.provincia ?? null,
    rubro: c.rubro ?? null,
    telefono: c.telefono ?? null,
    email: c.email ?? null,
    sitio_web: c.sitio_web ?? null,
    origen: c.origen ?? null,
    vendedor_id: c.vendedor_id ?? null,
    notas: c.notas ?? null,
    creado_por: user.id,
  }));

  let creados = 0;
  const rechazados: { razon_social: string; motivo: string }[] = [];

  for (let i = 0; i < aInsertar.length; i += LOTE) {
    const lote = aInsertar.slice(i, i + LOTE);
    const { data, error } = await supabase
      .from("ventas_clientes")
      .insert(lote)
      .select("id");

    if (!error) {
      creados += data?.length ?? 0;
      continue;
    }

    // El lote entero falló. Se reintenta de a uno para no perder 49 buenos por
    // uno que chocó, y para poder decir **cuál** fue: un «falló el lote 3» no
    // le sirve a nadie.
    for (const fila of lote) {
      const { error: suyo } = await supabase.from("ventas_clientes").insert(fila);
      if (suyo) {
        rechazados.push({
          razon_social: fila.razon_social,
          motivo:
            suyo.code === "23505"
              ? `Ya hay un cliente con el CUIT ${fila.cuit}.`
              : suyo.message,
        });
      } else {
        creados += 1;
      }
    }
  }

  return NextResponse.json({ creados, rechazados });
}
