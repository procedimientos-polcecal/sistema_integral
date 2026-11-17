import type { SupabaseClient } from "@supabase/supabase-js";
import type { TipoDeEntidad } from "@/lib/core/mensajes";
import { traerTodo } from "@/lib/core/paginado";
import { ENTIDADES, TIPOS_DE_ENTIDAD } from "./entidades";

/**
 * Las menciones sin leer de una persona que todavía puede abrir su hilo.
 *
 * **Es la única definición de «mención pendiente» del sistema.** La usan dos
 * lugares que tienen que decir el mismo número: la bandeja
 * (`GET /api/mensajes/mios`) y el aviso de la campana
 * (`contarMencionesSinLeer`). Si cada uno armara su consulta, el día que una
 * cambie la otra seguiría contando distinto y la campana diría «3» sobre una
 * bandeja con dos tarjetas: un número que no coincide con lo que se ve es peor
 * que ningún número.
 *
 * Recibe el cliente **admin** y filtra por `usuario_id` a mano, por lo mismo que
 * la ruta: el nombre del autor vuelve `null` con el cliente de la sesión, y
 * `puedeVerlo` lee los permisos de la persona nombrada. El permiso es uno solo:
 * cada uno cuenta sus menciones y nada más.
 *
 * Una mención de un hilo cuyo registro la persona ya no puede ver **no entra**:
 * es un aviso que lleva a una pantalla que lo rebota, y el texto saldría en la
 * bandeja de quien perdió el permiso de leerlo.
 */

export type FilaDeMencion = {
  mensaje_id: string;
  mensajes: {
    entidad_tipo: TipoDeEntidad;
    entidad_id: string;
    texto: string;
    creado_en: string;
    autor: { nombre: string; apellido?: string | null } | null;
  };
};

export async function mencionesSinLeerVisibles(
  admin: SupabaseClient,
  usuarioId: string
): Promise<FilaDeMencion[]> {
  // `traerTodo` porque la tabla crece y PostgREST corta en 1000 sin avisar. Se
  // ordena por la clave para que las páginas no se pisen.
  const filas = await traerTodo<FilaDeMencion>((desde, hasta) =>
    admin
      .from("mensajes_menciones")
      // La cadena va literal. **El `autor` nombra su foreign key y tiene que
      // seguir nombrándola**: `mensajes_menciones` abre un segundo camino de
      // `mensajes` a `usuarios` —el muchos-a-muchos—, así que
      // `autor:usuarios(...)` a secas es ambiguo y PostgREST contesta 300
      // PGRST201. Medido contra la base: sin el FK, 300; con él, 200.
      .select("mensaje_id, mensajes!inner(entidad_tipo, entidad_id, texto, creado_en, autor:usuarios!mensajes_creado_por_fkey(nombre, apellido))")
      .eq("usuario_id", usuarioId)
      .is("leido_en", null)
      .order("mensaje_id")
      .range(desde, hasta)
      // Sin esquema generado, Supabase infiere el embebido como lista aunque
      // PostgREST devuelva un objeto cuando el vínculo es de uno a uno.
      .returns<FilaDeMencion[]>()
  );

  // Una pregunta de permiso por tipo, no por mención.
  const tiposQueVe = new Set<TipoDeEntidad>();
  for (const tipo of TIPOS_DE_ENTIDAD) {
    if (filas.some((f) => f.mensajes.entidad_tipo === tipo) &&
        (await ENTIDADES[tipo].puedeVerlo(admin, usuarioId))) {
      tiposQueVe.add(tipo);
    }
  }
  return filas.filter((f) => tiposQueVe.has(f.mensajes.entidad_tipo));
}

/**
 * Cuántas menciones sin leer tiene `usuarioId`, para la campana y el resumen.
 *
 * Cuenta **mensajes** y no hilos, igual que `GET /api/mensajes/mios`: la
 * bandeja agrupa por registro pero cada mención es de un mensaje, y es lo que el
 * correo contó al mandarse.
 *
 * Si la lectura falla devuelve 0 y lo dice en el log: la campana corre en cada
 * página del sistema y no puede caerse por esto, y mientras la migración de la
 * mensajería no esté aplicada la tabla no existe. Es el modo de fallar de los
 * demás conteos.
 */
export async function contarMencionesSinLeer(
  admin: SupabaseClient,
  usuarioId: string
): Promise<number> {
  try {
    return (await mencionesSinLeerVisibles(admin, usuarioId)).length;
  } catch (e) {
    console.error("mensajes: no se pudieron contar las menciones sin leer:", e instanceof Error ? e.message : e);
    return 0;
  }
}
