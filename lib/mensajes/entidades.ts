import type { SupabaseClient } from "@supabase/supabase-js";
import { traerTodo } from "@/lib/core/paginado";
import type { TipoDeEntidad } from "@/lib/core/mensajes";
import { nivelMantenimientoDe } from "@/lib/mantenimiento/auth";
import { nivelSyhDe } from "@/lib/seguridadHigiene/auth";
import { nombreCompleto } from "./avisos";

/**
 * El puente entre «un hilo pegado a un registro» y «quién puede ver ese
 * registro».
 *
 * ## Por qué no es siempre una función de nivel
 *
 * `puedeVerlo` contesta **«puede ver este registro»** y no «tiene el módulo».
 * Casi siempre es lo mismo —una OT la ve quien tiene Mantenimiento, una
 * condición insegura quien tiene Seguridad e Higiene—, pero no siempre:
 * `compras_requerimientos` tiene el SELECT en `true` desde la migración 018
 * («el circuito de compras es transversal a toda la empresa»), así que un
 * requerimiento lo ven los catorce aunque el módulo lo tengan ocho. El hilo
 * sigue al registro y no al módulo, y por eso un tipo puede declarar «cualquiera
 * con sesión» sin que sea un hueco.
 *
 * Las funciones de nivel del repo (`nivelXDe`) comparten casi todas la firma
 * `(supabase, userId) => Promise<nivel | null>`, así que sumar una entidad que
 * sí depende de su módulo es **una línea** con `porNivel()`. Seguridad e
 * Higiene es la excepción —su `nivelSyhDe` devuelve `{ ok, nivel }` porque
 * distingue «no tiene permiso» de «no se pudo averiguar»— y tiene su adaptador
 * abajo.
 *
 * ## Qué cliente se le pasa
 *
 * **El cliente admin, siempre.** `nivelXDe` lee `usuarios` y `usuario_modulos`
 * del usuario que se le nombra, y con el cliente de la sesión `usuarios` sólo
 * deja leer la fila propia: preguntar por *otra* persona —que es lo que hace
 * `quienesLoVen`, y lo que hace el POST con cada mencionado— devolvería `null`
 * para todos y nadie podría ser mencionado. El permiso ya lo comprobó la ruta
 * antes de llegar acá.
 *
 * ## Si no se pudo averiguar, lanza
 *
 * Sólo Seguridad e Higiene puede saberlo. Devolver `false` ahí diría «no lo
 * puede ver» cuando lo cierto es «no sé», y la ruta contestaría 403 por una
 * caída de la base. Las rutas atrapan el error y contestan 503.
 */

type Cliente = SupabaseClient;

export interface Entidad {
  /** La tabla del registro al que se pega el hilo. */
  tabla: string;
  /**
   * Cómo se nombra, con su artículo y sin el número: «la orden de trabajo».
   * Va dentro de una oración («te mencionó en la orden de trabajo N° 2983»),
   * así que el género importa.
   */
  comoSeLlama: string;
  puedeVerlo: (sb: Cliente, userId: string) => Promise<boolean>;
  /**
   * A dónde lleva un enlace al registro, **relativa a la raíz del sitio**. El
   * correo la necesita absoluta y esa la arma la ruta, que es quien conoce el
   * entorno.
   *
   * Recibe también el número porque la pantalla de Mantenimiento no tiene
   * página por orden: se llega con el buscador, `?q=<número>`.
   */
  ruta: (id: string, numero?: number | null) => string;
  /**
   * El número visible de cada registro (el de la OT, el del RI, el de la
   * condición), por id. Un id que no está en el mapa es un registro que ya no
   * existe: es como se sabe que el hilo quedó huérfano.
   */
  numeros: (sb: Cliente, ids: string[]) => Promise<Map<string, number>>;
}

/** El nivel que sea, con tal de que no sea «ninguno»: la forma de una línea. */
function porNivel(
  nivelDe: (sb: Cliente, userId: string) => Promise<unknown | null>
): Entidad["puedeVerlo"] {
  return async (sb, userId) => (await nivelDe(sb, userId)) !== null;
}

/** De a 200 ids por consulta: un `.in()` más largo arma una URL que PostgREST rechaza con un 400 sin decir por qué. */
const LOTE = 200;

async function numerosDe(
  ids: string[],
  columna: string,
  leer: (lote: string[]) => PromiseLike<{
    data: Record<string, unknown>[] | null;
    error: { message: string } | null;
  }>
): Promise<Map<string, number>> {
  const mapa = new Map<string, number>();
  const unicos = [...new Set(ids)];
  for (let i = 0; i < unicos.length; i += LOTE) {
    const { data, error } = await leer(unicos.slice(i, i + LOTE));
    if (error) throw new Error(error.message);
    for (const fila of data ?? []) mapa.set(String(fila.id), Number(fila[columna]));
  }
  return mapa;
}

export const ENTIDADES: Record<TipoDeEntidad, Entidad> = {
  orden_trabajo: {
    tabla: "ordenes_trabajo",
    comoSeLlama: "la orden de trabajo",
    puedeVerlo: porNivel(nivelMantenimientoDe),
    ruta: (_id, numero) =>
      numero == null ? "/mantenimiento/ordenes" : `/mantenimiento/ordenes?q=${numero}`,
    numeros: (sb, ids) =>
      numerosDe(ids, "ot_number", (lote) =>
        sb.from("ordenes_trabajo").select("id, ot_number").in("id", lote)
      ),
  },

  requerimiento: {
    tabla: "compras_requerimientos",
    comoSeLlama: "el requerimiento de compra",
    // Cualquiera con sesión, y no es un descuido: ver el comentario de arriba.
    // La sesión ya la comprobó la ruta; lo que no se puede es llegar acá sin
    // ella.
    puedeVerlo: async () => true,
    ruta: (id) => `/compras/requerimientos/${id}`,
    numeros: (sb, ids) =>
      numerosDe(ids, "nro_ri", (lote) =>
        sb.from("compras_requerimientos").select("id, nro_ri").in("id", lote)
      ),
  },

  condicion_insegura: {
    tabla: "syh_condiciones",
    comoSeLlama: "la condición insegura",
    puedeVerlo: async (sb, userId) => {
      const r = await nivelSyhDe(sb, userId);
      if (!r.ok) {
        throw new Error(`No se pudieron comprobar los permisos de Seguridad e Higiene: ${r.error}`);
      }
      return r.nivel !== null;
    },
    // La pantalla no abre una ficha por URL —la condición abierta es estado
    // local—, así que el enlace lleva a la lista.
    ruta: () => "/seguridad-higiene/condiciones",
    numeros: (sb, ids) =>
      numerosDe(ids, "numero", (lote) =>
        sb.from("syh_condiciones").select("id, numero").in("id", lote)
      ),
  },
};

/** Los tipos que el registro conoce, para validar lo que entra. */
export const TIPOS_DE_ENTIDAD = Object.keys(ENTIDADES) as TipoDeEntidad[];

/**
 * Cómo se nombra un registro concreto en una oración: «la orden de trabajo
 * N° 2983». Sin número —el registro ya no existe— queda sólo el nombre del tipo.
 */
export function queEs(tipo: TipoDeEntidad, numero: number | null): string {
  const base = ENTIDADES[tipo].comoSeLlama;
  return numero == null ? base : `${base} N° ${numero}`;
}

export interface UsuarioQueLoVe {
  id: string;
  nombre: string;
  /** Null si no tiene correo cargado. Tiene que viajar: la pantalla avisa que a esa persona no le va a llegar nada. */
  email: string | null;
}

/**
 * Los usuarios activos que pueden ver los registros de un tipo, con su nombre
 * y su correo.
 *
 * **Cuántas consultas son**: dos por persona —`usuarios` y `usuario_modulos`,
 * dentro de `nivelXDe`— lanzadas en paralelo, más una para la lista. Con los 14
 * usuarios de hoy son 29 consultas. No se midió cuánto tarda; se eligió así
 * porque con ese volumen no vale la pena otra cosa.
 *
 * **El día que deje de alcanzar** es cuando esta lista tarde más que el resto
 * de la pantalla que la pide, y la salida no es optimizar cada `nivelXDe` sino
 * leer `usuario_modulos` **una vez** para todos y calcular el nivel en memoria
 * con `nivelEnModulo`. Eso es otro diseño —no sirve para un tipo cuyo permiso no
 * sale de los grants— y por eso no se hizo antes de necesitarlo.
 *
 * **Los inactivos no entran**: a alguien que se fue no se lo menciona.
 */
export async function quienesLoVenConDatos(
  sb: Cliente,
  tipo: TipoDeEntidad
): Promise<UsuarioQueLoVe[]> {
  const usuarios = await traerTodo<{
    id: string; nombre: string; apellido: string | null; email: string | null;
  }>((desde, hasta) =>
    sb
      .from("usuarios")
      .select("id, nombre, apellido, email")
      .eq("activo", true)
      .order("nombre")
      .order("id")
      .range(desde, hasta)
  );

  const puede = ENTIDADES[tipo].puedeVerlo;
  const veredictos = await Promise.all(usuarios.map((u) => puede(sb, u.id)));

  return usuarios
    .filter((_, i) => veredictos[i])
    .map((u) => ({ id: u.id, nombre: nombreCompleto(u), email: u.email }));
}

/** Los ids de quienes pueden ver los registros de un tipo. */
export async function quienesLoVen(sb: Cliente, tipo: TipoDeEntidad): Promise<string[]> {
  return (await quienesLoVenConDatos(sb, tipo)).map((u) => u.id);
}
