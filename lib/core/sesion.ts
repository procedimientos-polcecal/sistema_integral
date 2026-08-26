import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/**
 * Quién está mirando, preguntado una sola vez por request.
 *
 * `auth.getUser()` no lee la cookie: valida el token contra el servidor de auth
 * de Supabase, o sea que es un viaje de red. Y se lo llamaba tres veces por
 * navegación —el middleware, el layout del módulo y la página—, cada una con su
 * propio cliente, preguntando lo mismo.
 *
 * `cache()` de React memoiza dentro del mismo render en el servidor: la primera
 * llamada viaja y las demás reciben lo mismo sin salir. No es un caché entre
 * requests ni entre usuarios; vive y muere con el render, que es exactamente lo
 * que hace falta acá.
 *
 * El middleware queda afuera a propósito: corre en otro momento y no comparte
 * el render, así que su verificación sigue siendo la de siempre. Es la que
 * protege a las rutas que no validan por su cuenta.
 */
export const usuarioActual = cache(async () => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
});
