import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import MisMencionesClient from "./MisMencionesClient";

/**
 * Las menciones que me hicieron, sin leer. Pantalla propia, fuera de todo
 * módulo y fuera de «Mis avisos».
 *
 * **Fuera de los módulos** por lo mismo que «Mis pedidos» y «Mis avisos»: a
 * alguien lo pueden mencionar en una condición insegura sin que tenga Seguridad
 * e Higiene en el menú, y en un requerimiento sin tener Compras —de 14 usuarios
 * 10 no tienen Mantenimiento y 6 no tienen Compras—. Colgar la bandeja de un
 * módulo dejaría sin ella a quien más la necesita.
 *
 * **Y no dentro de «Mis avisos»**, que era la otra opción, porque esa pantalla
 * es la de los avisos de falla de Mantenimiento: lista la tabla `avisos`,
 * filtrada por área y paginada en el servidor, y no comparte con una mención ni
 * los datos ni los filtros. Meter las dos cosas ahí era una pantalla que dice
 * «avisos» para dos significados, y esa palabra ya está ocupada dos veces —los
 * avisos de Mantenimiento y la campana de notificaciones—; ver el comentario de
 * «Disponibilidad» en `lib/core/nav.ts`. Por eso esta se llama «Menciones».
 *
 * **Para ver, esta página sólo pide sesión.** Qué menciones salen lo decide
 * `GET /api/mensajes/mios`: cada uno ve las suyas, y sólo las de registros que
 * todavía puede abrir. Repetirlo acá sería una segunda copia de la regla.
 *
 * Las menciones las trae el cliente, no esta página: la ruta hace una consulta
 * de permiso por tipo y una de números por tipo, y el cliente necesita volver a
 * pedirlas después de marcar una.
 */
export default async function MisMencionesPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return <MisMencionesClient />;
}
