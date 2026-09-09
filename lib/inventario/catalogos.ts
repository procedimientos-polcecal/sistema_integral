/**
 * La lista del pañol: quién retira y a dónde va.
 *
 * Son dos catálogos propios del módulo y no los del núcleo, y la razón está en
 * la migración `20260903090920`: lo que el kardex llama "SECTOR" no es un
 * sector sino a dónde va el material o qué oficio lo retira —MECÁNICO,
 * ELECTRICISTA, LUBRICADOR—, y lo que llama "QUIEN" incluye contratistas y
 * "REGULADOR". Meter eso en `sectores` y `empleados` sería metérselo a los
 * otros cuatro módulos, que comparten esas tablas.
 *
 * Se enganchan con el núcleo cuando se puede y quedan en null cuando no. Ese
 * enganche es lo que permite que el gasto del pañol se cruce con RRHH y con
 * Mantenimiento sin obligar a las dos listas a ser la misma.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { traerTodo } from "@/lib/core/paginado";
import { indiceDeEmpleados, reconocer } from "@/lib/inventario/enlaces";

export interface Destino {
  id: string;
  nombre: string;
  sector_id: string | null;
}

export interface Solicitante {
  id: string;
  nombre: string;
  destino_id: string | null;
  empleado_id: string | null;
}

/**
 * Qué solicitantes se pueden enganchar al padrón, y con quién.
 *
 * Sólo los que hoy están en null: uno ya resuelto no se vuelve a tocar, porque
 * puede haberlo enlazado una persona a mano y el reconocimiento automático no
 * tiene por qué saber más que ella.
 *
 * Va aparte de la escritura para poder probarla, y usa el mismo índice que la
 * sincronización usa para el texto de la planilla: la regla de cuándo dos
 * nombres son la misma persona tiene que ser una sola.
 */
export function empleadosDeLosSolicitantes(
  solicitantes: Solicitante[],
  empleados: { id: string; nombre: string; apellido?: string | null }[]
): { id: string; empleado_id: string }[] {
  const indice = indiceDeEmpleados(empleados);
  const cambios: { id: string; empleado_id: string }[] = [];

  for (const s of solicitantes) {
    if (s.empleado_id) continue;
    const empleado_id = reconocer(indice, s.nombre);
    if (empleado_id) cambios.push({ id: s.id, empleado_id });
  }
  return cambios;
}

/**
 * Engancha con el padrón los solicitantes que todavía están sueltos.
 *
 * Corre con cada sincronización y es idempotente. Existe porque el padrón se
 * mueve: alguien que hoy no está mañana entra, y sin esto su nombre en el pañol
 * seguiría sin legajo para siempre. Los que quedan en null son los que de
 * verdad no están —los contratistas, "REGULADOR"— y los que están escritos de
 * dos formas distintas, que hay que arreglar a mano en un lado o en el otro.
 *
 * Devuelve cuántos enganchó y los nombres que siguen sueltos, para poder decirlo.
 */
export async function reconciliarSolicitantes(
  admin: SupabaseClient
): Promise<{ enganchados: number; sueltos: string[] }> {
  const [solicitantes, empleados] = await Promise.all([
    traerTodo<Solicitante & { activo: boolean }>((desde, hasta) =>
      admin.from("inventario_solicitantes")
        .select("id, nombre, destino_id, empleado_id, activo").range(desde, hasta)
    ),
    traerTodo<{ id: string; nombre: string; apellido: string | null }>((desde, hasta) =>
      admin.from("empleados").select("id, nombre, apellido").range(desde, hasta)
    ),
  ]);

  const cambios = empleadosDeLosSolicitantes(solicitantes, empleados);

  // De a uno: son unos pocos por corrida y un upsert obligaría a mandar el
  // resto de las columnas, que es cómo se pisa sin querer lo que otro editó.
  for (const c of cambios) {
    await admin.from("inventario_solicitantes")
      .update({ empleado_id: c.empleado_id }).eq("id", c.id);
  }

  return {
    enganchados: cambios.length,
    sueltos: sueltosDespuesDeEnganchar(solicitantes, cambios),
  };
}

/**
 * Los nombres que siguen sin empleado después de enganchar.
 *
 * Devuelve los nombres y no el conteo porque son cinco contra 64: el aviso los
 * puede decir enteros, y "5 sin enganchar" obliga a ir a buscar cuáles. Va
 * aparte de la escritura por lo mismo que `empleadosDeLosSolicitantes`: para
 * poder probarla.
 *
 * Sólo los activos. Uno dado de baja no es un pendiente —alguien lo dio de baja
 * a propósito— y nombrarlo sería mandar a arreglar lo que ya está resuelto. Es
 * además el mismo recorte que hace el conteo de la pantalla de la lista, así que
 * los dos números coinciden.
 */
export function sueltosDespuesDeEnganchar(
  solicitantes: { id: string; nombre: string; empleado_id: string | null; activo: boolean }[],
  cambios: { id: string; empleado_id: string }[]
): string[] {
  const recienEnganchados = new Set(cambios.map((c) => c.id));

  return solicitantes
    .filter((s) => s.activo && !s.empleado_id && !recienEnganchados.has(s.id))
    .map((s) => s.nombre)
    .sort((a, b) => a.localeCompare(b, "es"));
}
