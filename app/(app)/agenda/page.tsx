import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { usuarioActual } from "@/lib/core/sesion";
import { traerTodo } from "@/lib/core/paginado";
import { hoyEnArgentina } from "@/lib/core/fechas";
import { traerEventos } from "@/lib/agenda/listar";
import { desdeParaLeer, leerDia, leerVista } from "@/lib/agenda/rango";
import { leerLaSaludDeLaAgenda, lineasDeSalud } from "@/lib/agenda/avisosDeLaAgenda";
import AgendaClient from "./AgendaClient";
import SaludDeLaAgenda from "./SaludDeLaAgenda";

/**
 * La Agenda: la puerta de los eventos propios y de aquellos a los que la
 * persona fue invitada.
 *
 * La ven los catorce usuarios y no hay un permiso de módulo que comprobar: lo
 * único que se pide es sesión (el layout de `(app)` ya rechaza al desactivado).
 * Qué ve cada uno lo resuelve RLS en `agenda_eventos`.
 *
 * ── LOS EVENTOS SE LEEN ACÁ, Y NO HAY UN GET ────────────────────────────────
 *
 * Con el cliente del usuario y pidiendo lo que importa (ver `traerEventos`):
 * una agenda crece sin techo. La ventana la fijan `?vista=` y `?dia=`, y
 * `?historial=1` la saca. Las rutas de
 * `/api/agenda` son sólo las de las escrituras; el GET de lectura se borró
 * porque nadie lo llamaba.
 *
 * ── EL DIRECTORIO DE USUARIOS SALE DEL CLIENTE ADMIN, Y LA RAZÓN ES LA POLICY ─
 *
 * `usuarios_select_self` es `id = auth.uid() or es_admin()`: un no-admin se lee
 * sólo a sí mismo. Con el cliente de la persona, la lista de «a quién invitar»
 * vendría con una sola fila y el nombre del dueño de un evento ajeno vendría
 * vacío. **No es una comodidad**: sin el admin la pantalla no funciona para
 * casi nadie. Por eso la proyección es angosta: a la pantalla llega **sólo**
 * nombre, apellido y correo de los usuarios activos —son casillas de la
 * empresa y es lo que el calendario de Google ya muestra—; el resto de la fila
 * no sale del servidor.
 */
export default async function AgendaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const crudos = await searchParams;
  const historial = crudos.historial === "1";
  // El día que se mira viaja en la URL, y de él depende qué se lee: mirar una
  // semana vieja tiene que traer esa semana. Lo que no se entiende cae al
  // default en vez de tumbar la pantalla (ver `lib/agenda/rango.ts`).
  const vista = leerVista(crudos.vista);
  const dia = leerDia(crudos.dia, hoyEnArgentina());

  const user = await usuarioActual();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const admin = createAdminClient();

  // Un fallo del directorio no tumba la pantalla: sin él se ven los correos en
  // vez de los nombres, y el selector de usuarios queda vacío (se puede escribir
  // un correo). Pero se dice, porque un selector vacío sin explicación parece
  // que no hay a quién invitar.
  let directorio: { id: string; email: string | null; nombre: string; apellido: string }[] = [];
  let errorDelDirectorio = "";
  try {
    directorio = await traerTodo((desde, hasta) =>
      admin
        .from("usuarios")
        .select("id, email, nombre, apellido")
        .eq("activo", true)
        .order("apellido")
        .order("id")
        .range(desde, hasta)
    );
  } catch (e) {
    errorDelDirectorio = e instanceof Error ? e.message : String(e);
  }

  const nombreDe = (u: { nombre: string; apellido: string }) => `${u.nombre ?? ""} ${u.apellido ?? ""}`.trim();
  const porId = new Map(directorio.map((u) => [u.id, nombreDe(u)]));

  // Un fallo de la lectura de eventos NO es «no tenés eventos»: se dice.
  let eventos: Awaited<ReturnType<typeof traerEventos>> = [];
  let errorDeEventos = "";
  try {
    eventos = await traerEventos(supabase, {
      historial,
      desde: desdeParaLeer(vista, dia),
      directorio: new Map([...porId].filter(([, n]) => n !== "")),
    });
  } catch (e) {
    errorDeEventos = e instanceof Error ? e.message : String(e);
  }

  // El número de cada OT, para decir «de la orden #2903» y enlazar. Se lee con
  // el cliente de la persona: quien no ve Mantenimiento no la lee y la pantalla
  // dice «una orden de trabajo» sin número, que es lo cierto. De a lotes: un
  // `.in()` con muchos ids arma una URL que PostgREST rechaza con un 400.
  const numerosDeOT: Record<string, number> = {};
  const idsDeOT = [...new Set(eventos.flatMap((e) => (e.otId ? [e.otId] : [])))];
  for (let i = 0; i < idsDeOT.length; i += 200) {
    const { data } = await supabase
      .from("ordenes_trabajo")
      .select("id, ot_number")
      .in("id", idsDeOT.slice(i, i + 200));
    for (const o of data ?? []) numerosDeOT[o.id as string] = o.ot_number as number;
  }

  // La salud de la conexión con Google, **sólo para admin_sistema**: es adonde
  // llevan los dos avisos de salud de la campana. Se lee con el cliente de la
  // persona (`ultima_sincronizacion` la leen todos los autenticados) y no tumba
  // la pantalla: si la lectura falla, `sinComprobar` lo dice en vez de callar.
  const { data: yoMismo } = await supabase.from("usuarios").select("rol").eq("id", user.id).maybeSingle();
  const salud = yoMismo?.rol === "admin_sistema" ? await leerLaSaludDeLaAgenda(supabase) : null;

  const yo = user.email?.toLowerCase();
  const invitables = directorio
    .filter((u) => u.email && u.id !== user.id && u.email.toLowerCase() !== yo)
    .map((u) => ({ email: (u.email as string).trim().toLowerCase(), nombre: nombreDe(u) }));

  return (
    <div className="space-y-4">
      {salud && <SaludDeLaAgenda lineas={lineasDeSalud(salud.corridas)} sinComprobar={salud.sinComprobar} />}
      {errorDeEventos && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          No se pudieron leer los eventos: {errorDeEventos}. Lo que se ve abajo no es tu agenda completa: recargá la
          pantalla.
        </div>
      )}
      {errorDelDirectorio && (
        <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900" role="alert">
          No se pudo leer la lista de usuarios ({errorDelDirectorio}). Se ven los correos en vez de los nombres y no se
          puede elegir un usuario para invitar, pero se puede escribir un correo.
        </div>
      )}
      <AgendaClient
        eventos={eventos}
        miId={user.id}
        ahoraIso={new Date().toISOString()}
        usuarios={invitables}
        numerosDeOT={numerosDeOT}
        historial={historial}
        lecturaFallo={errorDeEventos !== ""}
      />
    </div>
  );
}
