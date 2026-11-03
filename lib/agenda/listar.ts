import type { SupabaseClient } from "@supabase/supabase-js";
import { traerTodo } from "@/lib/core/paginado";
import { divergenciaVista } from "./pedido";
import { aEventoVista, corteDelHistorial, type EventoVista, type FilaCruda } from "./vista";

/**
 * Los eventos que muestra la pantalla de la Agenda.
 *
 * **Es la lectura del `GET /api/agenda/eventos` con una ventana**, y por eso
 * existe: ese GET trae todo lo que la persona ve desde siempre, y una agenda no
 * tiene techo. Se lee acá con el cliente del usuario —las mismas policies que la
 * ruta: cada uno ve lo que creó y aquello a lo que lo invitaron— y no con el
 * admin. El `select` es el de la ruta; si uno cambia, el otro también.
 *
 * La ventana pide **lo que no terminó, el último mes y todo lo divergido**, sea
 * de cuando sea: una alerta no puede esconderse por antigua. `historial: true`
 * saca la ventana y trae todo.
 *
 * `usuarios!dueno_id` y no `usuarios`: `agenda_divergencias_vistas` es una tabla
 * puente entre `agenda_eventos` y `usuarios`, así que el embed pelado contesta
 * `PGRST201`. Y para quien no es el dueño ni administrador ese embed viene
 * `null` (RLS de `usuarios`), de ahí el directorio que recibe `aEventoVista`.
 */
export async function traerEventos(
  supabase: SupabaseClient,
  opciones: { historial: boolean; directorio: ReadonlyMap<string, string>; ahora?: Date }
): Promise<EventoVista[]> {
  const corte = corteDelHistorial(opciones.ahora);

  const filas = await traerTodo<FilaCruda & { divergencia_el: string | null; agenda_divergencias_vistas?: { divergencia_el: string }[] }>(
    (desde, hasta) => {
      const consulta = supabase
        .from("agenda_eventos")
        .select(
          "*, agenda_invitados(email, usuario_id), usuarios!dueno_id(nombre, apellido), agenda_divergencias_vistas(divergencia_el)"
        );
      return (opciones.historial ? consulta : consulta.or(`fin.gte.${corte},divergencia.not.is.null`))
        // El id desempata: sin un orden total, la paginación puede repetir o saltear filas.
        .order("inicio", { ascending: true })
        .order("id", { ascending: true })
        .range(desde, hasta);
    }
  );

  return filas.map((f) =>
    aEventoVista(
      // `agenda_divergencias_vistas` ya viene recortada a las del que mira (RLS):
      // cada uno da por vistas las suyas.
      { ...f, divergencia_vista: divergenciaVista(f.divergencia_el, f.agenda_divergencias_vistas ?? []) },
      opciones.directorio
    )
  );
}
