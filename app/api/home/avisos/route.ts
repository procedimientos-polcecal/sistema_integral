import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { Rol, UsuarioModulo } from "@/lib/core/types";
import { avisosDeUsuario } from "@/lib/home/avisosDeUsuario";

/**
 * Sólo las notificaciones del globo. La consume la campana, que vive en
 * `components/Header.tsx` —o sea, en el layout— y por lo tanto corre en
 * **todas** las páginas del sistema.
 *
 * Existe aparte de `/api/home/resumen` justamente por eso: el resumen arma los
 * números de las tarjetas y es caro, y hasta ahora se pagaba ese costo en cada
 * navegación aunque la campana sólo usara `notificaciones`.
 *
 * El cálculo vive en `lib/home/avisosDeUsuario.ts` y no acá porque lo comparte
 * con el cron del resumen diario, que no tiene sesión. Dos copias de las mismas
 * trece consultas se irían separando sin que nada avise, y entonces la campana
 * y la notificación dirían cosas distintas.
 *
 * UN AVISO DE `AVISOS` NO SE CALCULA, A PROPÓSITO
 *
 * `cantera-sin-conciliar` está definido en `lib/home/avisos.ts` pero no tiene
 * conteo, porque no se puede contar barato: `sinConciliar` sale de
 * `contarAvisos` (`lib/cantera/tablero.ts`), que filtra por `cruce`, `crucePerf`
 * y `cruceVol`. Ninguno de los tres es una columna: los deriva
 * `armarFilaVoladura` a partir de la voladura, su yacimiento y sus consumos.
 * Contarlo exige traer las tres tablas enteras, o sea volver a poner en **cada
 * página del sistema** justo lo que esta ruta existe para sacar.
 *
 * Eran tres hasta el 07/10/2026: los otros dos eran los de service de Taller
 * Vial, que no se podían contar barato porque necesitaban el último horómetro de
 * cada equipo cruzado con el último service por escalón. Ya no existen —medían
 * una tabla con un solo service y sólo podían decir 0 o 1; el porqué está en
 * `/api/home/resumen`—, y el que los reemplaza, `taller-vial-sin-service`, sí
 * entra: le alcanza con los `equipo_id` distintos de `taller_vial_services`.
 *
 * La información de Cantera **no se pierde del sistema**: se sigue viendo en la
 * tarjeta del Inicio, que arma `/api/home/resumen`. Lo que se pierde es la
 * campana, y ahora también el resumen diario que se manda por push.
 *
 * El arreglo, si alguna vez se decide pagarlo, es una vista que precalcule el
 * cruce de Cantera, igual que `inicio_ritmo_modulos`: entonces vuelve como un
 * `count … head` más, y aparece en los dos lugares de una.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { data: usuario } = await supabase.from("usuarios").select("rol").eq("id", user.id).single();
  if (!usuario) return NextResponse.json({ error: "Sin acceso" }, { status: 403 });

  const { data: grants } = await supabase
    .from("usuario_modulos").select("id, usuario_id, modulo, nivel").eq("usuario_id", user.id);

  const notificaciones = await avisosDeUsuario(supabase, {
    id: user.id,
    rol: usuario.rol as Rol,
    grants: (grants ?? []) as UsuarioModulo[],
  });

  return NextResponse.json({ notificaciones });
}
