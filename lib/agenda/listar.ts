import type { SupabaseClient } from "@supabase/supabase-js";
import { traerTodo } from "@/lib/core/paginado";
import { divergenciaVista } from "./pedido";
import { aEventoVista, type EventoVista, type FilaCruda } from "./vista";

/**
 * Los eventos que muestra la pantalla de la Agenda.
 *
 * **Es la única lectura de eventos del sistema**: no hay un `GET` en
 * `/api/agenda/eventos` (se borró, nadie lo llamaba) y la pantalla lee desde su
 * Server Component. Se lee con el cliente del usuario y no con el admin, para
 * que corran las policies: cada uno ve lo que creó y aquello a lo que lo
 * invitaron. Una agenda no tiene techo, de ahí la ventana.
 *
 * **La ventana la fija quien llama**, con `desde`: lo que termina desde ese
 * instante, y además **todo lo divergido y todo lo pendiente**, sea de cuando
 * sea. Antes la función calculaba su propio corte (el último mes), y eso no
 * sobrevive a un calendario por el que se navega: mirar una semana de hace dos
 * meses habría vuelto vacío, sin avisar. Ahora la semana que se mira y el corte
 * del historial los combina `desdeParaLeer`, y esta función no decide nada.
 *
 * Los pendientes (`google_pendiente`: se guardó en el SdG y nunca llegó a
 * Google) se traen igual que los divergidos, y no por simetría: la banda de
 * alertas de arriba de la grilla los nombra, y una promesa sobre una fila que la
 * consulta no leyó es una promesa falsa. Una alerta no puede esconderse por
 * antigua. `historial: true` saca la ventana y trae todo.
 *
 * `usuarios!dueno_id` y no `usuarios`: `agenda_divergencias_vistas` es una tabla
 * puente entre `agenda_eventos` y `usuarios`, así que el embed pelado contesta
 * `PGRST201`. Y para quien no es el dueño ni administrador ese embed viene
 * `null` (RLS de `usuarios`), de ahí el directorio que recibe `aEventoVista`.
 */
export async function traerEventos(
  supabase: SupabaseClient,
  opciones: { historial: boolean; desde: string; directorio: ReadonlyMap<string, string> }
): Promise<EventoVista[]> {
  const filas = await traerTodo<FilaCruda & { divergencia_el: string | null; agenda_divergencias_vistas?: { divergencia_el: string }[] }>(
    (primera, ultima) => {
      const consulta = supabase
        .from("agenda_eventos")
        .select(
          "*, agenda_invitados(email, usuario_id), usuarios!dueno_id(nombre, apellido), agenda_divergencias_vistas(divergencia_el)"
        );
      return (opciones.historial
        ? consulta
        : consulta.or(`fin.gte.${opciones.desde},divergencia.not.is.null,google_pendiente.not.is.null`))
        // El id desempata: sin un orden total, la paginación puede repetir o saltear filas.
        .order("inicio", { ascending: true })
        .order("id", { ascending: true })
        .range(primera, ultima);
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
