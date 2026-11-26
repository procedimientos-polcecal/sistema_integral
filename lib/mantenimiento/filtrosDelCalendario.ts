/**
 * Los tres filtros del mes de órdenes: especialidad, tipo y quién lo hace.
 *
 * Vive acá y no adentro de `CalendarioDeOT.tsx` porque **la hoja impresa tiene
 * que filtrar igual que la pantalla**: los botones de imprimir llevan los
 * filtros puestos en la URL y la hoja los vuelve a aplicar del otro lado. Dos
 * copias del mismo `if` se separan sin que nada avise —una empieza a comparar
 * con tilde, la otra no— y el síntoma sería una hoja que dice tener catorce
 * órdenes donde la pantalla muestra once.
 */
import { norm } from "@/lib/core/texto";

/** El valor del filtro de especialidad que busca las órdenes que no la tienen. */
export const SIN_ESPECIALIDAD = "__SIN__";

export interface Filtros {
  especialidad: string;
  tipo: string;
  quien: string;
}

export const SIN_FILTROS: Filtros = { especialidad: "", tipo: "", quien: "" };

/**
 * Lo mínimo que una orden tiene que tener para que se la pueda filtrar.
 *
 * Es un tipo estructural y no `OrdenDelDia` a propósito: ese vive en un
 * componente de pantalla, e importarlo desde `lib/` armaría un ciclo. Cualquier
 * cosa con estos tres campos sirve, y `OrdenDelDia` lo satisface.
 */
export interface OrdenFiltrable {
  especialidad: string | null;
  tipo: string | null;
  quien: string | null;
}

/**
 * Si esa orden pasa los filtros puestos. Un filtro vacío no filtra nada.
 *
 * Todo se compara con `norm()` porque los tres campos llegan de la planilla,
 * donde los escribe gente: «Lubricacion» y «LUBRICACIÓN» son el mismo valor.
 */
export function pasaElFiltro(o: OrdenFiltrable, f: Filtros): boolean {
  if (f.especialidad) {
    const vacia = !norm(o.especialidad);
    if (f.especialidad === SIN_ESPECIALIDAD ? !vacia : norm(o.especialidad) !== norm(f.especialidad)) {
      return false;
    }
  }
  if (f.tipo && norm(o.tipo) !== norm(f.tipo)) return false;
  if (f.quien && norm(o.quien) !== norm(f.quien)) return false;
  return true;
}
