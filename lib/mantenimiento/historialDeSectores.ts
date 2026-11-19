/**
 * El historial de paradas y arranques de cada sector.
 *
 * La fuente es `sectores_status_log`, que escribe
 * `app/api/mantenimiento/sectores/status/route.ts` cada vez que alguien usa
 * «Cambiar estado» en el tablero. Es el único lugar donde queda escrito que
 * una planta estuvo parada, así que lo que se puede preguntar sobre esa tabla
 * es lo que se puede contestar después: cuántas veces paró Hidratación este
 * año, cuánto duró cada parada, quién la dio por terminada.
 *
 * **Cuánto duró un estado no es una columna**, y no puede serlo: se sabe
 * recién cuando llega el cambio siguiente, y del estado actual no se sabe
 * todavía. Por eso se calcula acá, al leer, cruzando cada fila con la próxima
 * del mismo sector. Guardarlo obligaría a reescribir la fila anterior en cada
 * cambio —una fila que ya pasó— y a inventar un valor para la última.
 */

/** Una fila de `sectores_status_log`, con el sector y el autor ya resueltos. */
export interface CambioDeSector {
  id: string;
  /** Null cuando el sector se borró. La fila sobrevive igual desde la 20261119104730. */
  sector_id: string | null;
  /** Cómo se llama hoy el sector, o null si ya no está. */
  sector: string | null;
  old_status: string | null;
  new_status: string;
  reason: string | null;
  /** ISO con zona, tal como lo devuelve `timestamptz`. */
  changed_at: string;
  /** Nombre y apellido de quien lo hizo, o null. */
  autor: string | null;
}

/** Un cambio con lo que duró el estado que dejó puesto. */
export interface CambioConPermanencia extends CambioDeSector {
  /**
   * Cuándo dejó de estar en ese estado, o null si sigue así.
   *
   * Null no es «no se sabe»: es «hasta hoy», y por eso `duracionMs` igual
   * tiene un número. Son dos preguntas distintas y la pantalla las muestra
   * distinto — un estado abierto se dice «hace 3 días», no «duró 3 días».
   */
  hasta: string | null;
  /** Cuánto duró, en milisegundos. Nunca negativo. */
  duracionMs: number;
}

/**
 * Cada cambio con lo que duró el estado que dejó puesto.
 *
 * El cruce es **por sector**: la fila siguiente en el tiempo de *otro* sector
 * no cierra ésta. Ordena por su cuenta en vez de confiar en cómo venga la
 * lista, porque la pantalla reordena al filtrar y un orden equivocado acá no
 * da error: da duraciones mal, que es peor.
 *
 * `ahoraIso` entra por parámetro y no se lee de `Date.now()` para que los
 * tests puedan preguntar por un instante fijo — y porque esto corre en el
 * servidor, donde «ahora» tiene que ser el mismo para toda la pantalla.
 */
export function conPermanencia(
  cambios: CambioDeSector[],
  ahoraIso: string
): CambioConPermanencia[] {
  const ahora = Date.parse(ahoraIso);

  // Una fila huérfana —sector borrado— no se cruza con ninguna otra: su
  // `sector_id` es null y dos null no son el mismo sector. Se le da una clave
  // propia por fila para que no se encadene con las demás huérfanas, que
  // pueden ser de sectores distintos.
  const claveDe = (c: CambioDeSector) => c.sector_id ?? `huerfana:${c.id}`;

  const porSector = new Map<string, CambioDeSector[]>();
  for (const c of cambios) {
    const clave = claveDe(c);
    const delSector = porSector.get(clave) ?? [];
    delSector.push(c);
    porSector.set(clave, delSector);
  }

  const resultado: CambioConPermanencia[] = [];

  for (const delSector of porSector.values()) {
    // De la más vieja a la más nueva: así la que cierra a cada una es la de al
    // lado. El desempate por `id` es para que dos cambios con la misma marca
    // de tiempo —posible, el default es `now()` y una transacción puede meter
    // dos— salgan siempre en el mismo orden.
    const enOrden = [...delSector].sort(
      (a, b) =>
        Date.parse(a.changed_at) - Date.parse(b.changed_at) ||
        a.id.localeCompare(b.id)
    );

    enOrden.forEach((c, i) => {
      const siguiente = enOrden[i + 1];
      const desde = Date.parse(c.changed_at);
      const corte = siguiente ? Date.parse(siguiente.changed_at) : ahora;

      resultado.push({
        ...c,
        hasta: siguiente ? siguiente.changed_at : null,
        // Nunca negativo: una fila con fecha futura —la cargó alguien mal, o
        // el reloj del servidor— daría una duración al revés, y un «-2 días»
        // en pantalla no se entiende. Cero se lee como «un instante».
        duracionMs: Math.max(0, corte - desde),
      });
    });
  }

  return resultado;
}

const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;

/**
 * Cuánto duró, escrito como lo diría una persona.
 *
 * Se corta en dos unidades a propósito: «3 días 4 h» alcanza para decidir, y
 * «3 días 4 h 17 min 9 s» no agrega nada sobre una parada de planta.
 */
export function duracionLegible(ms: number): string {
  if (!isFinite(ms) || ms < MINUTO) return "menos de un minuto";

  if (ms < HORA) {
    const min = Math.floor(ms / MINUTO);
    return `${min} min`;
  }

  if (ms < DIA) {
    const horas = Math.floor(ms / HORA);
    const min = Math.floor((ms % HORA) / MINUTO);
    return min === 0 ? `${horas} h` : `${horas} h ${min} min`;
  }

  const dias = Math.floor(ms / DIA);
  const horas = Math.floor((ms % DIA) / HORA);
  const cuantos = `${dias} día${dias === 1 ? "" : "s"}`;
  return horas === 0 ? cuantos : `${cuantos} ${horas} h`;
}

export interface FiltrosDelHistorial {
  /** Ids de sector. Vacío es «todos». */
  sectores: string[];
  /** Estados a los que se pasó (`new_status`). Vacío es «todos». */
  estados: string[];
  /** "YYYY-MM-DD", inclusive. `""` es sin límite de ese lado. */
  desde: string;
  hasta: string;
  /** Busca en el motivo, el nombre del sector y el autor. */
  texto: string;
}

export const FILTROS_DEL_HISTORIAL_VACIOS: FiltrosDelHistorial = {
  sectores: [], estados: [], desde: "", hasta: "", texto: "",
};

/** Sin acentos y en minúsculas, para que «hidratacion» encuentre «Hidratación». */
const plano = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Los cambios que pasan los filtros.
 *
 * El día se compara sobre los **diez primeros caracteres del ISO**, que es la
 * fecha en UTC. Es una simplificación conocida y se elige a propósito: la
 * alternativa es convertir cada fila a hora de Argentina para compararla, y
 * las dos se equivocan en los mismos pocos casos —un cambio hecho entre las 21
 * y la medianoche cae en el día siguiente— pero ésta se equivoca igual para
 * todos. Importa poco porque el filtro es de rango, no de día exacto: nadie
 * pregunta «qué pasó el 12» sin mirar el 11 y el 13.
 */
export function filtrarCambios(
  cambios: CambioConPermanencia[],
  f: FiltrosDelHistorial
): CambioConPermanencia[] {
  const texto = plano(f.texto.trim());

  return cambios.filter((c) => {
    if (f.sectores.length > 0 && !(c.sector_id && f.sectores.includes(c.sector_id))) {
      return false;
    }
    if (f.estados.length > 0 && !f.estados.includes(c.new_status)) return false;

    const dia = c.changed_at.slice(0, 10);
    if (f.desde && dia < f.desde) return false;
    if (f.hasta && dia > f.hasta) return false;

    if (texto) {
      const donde = plano(
        `${c.sector ?? ""} ${c.reason ?? ""} ${c.autor ?? ""}`
      );
      if (!donde.includes(texto)) return false;
    }

    return true;
  });
}

/** Si hay algún filtro puesto. Sirve para saber si la tabla vacía es por eso. */
export const hayFiltrosDelHistorial = (f: FiltrosDelHistorial): boolean =>
  f.sectores.length > 0 || f.estados.length > 0 ||
  f.desde !== "" || f.hasta !== "" || f.texto.trim() !== "";

export interface ResumenDelHistorial {
  /** Cuántos cambios entraron. */
  cambios: number;
  /** Cuántas veces se pasó a PARADA o EN_REPARACION. */
  paradas: number;
  /** Cuánto tiempo sumaron los estados distintos de ACTIVA, en milisegundos. */
  fueraDeServicioMs: number;
  /** Cuántos sectores distintos aparecen. */
  sectores: number;
}

/**
 * El encabezado de la pantalla.
 *
 * «Fuera de servicio» suma **todo lo que no es ACTIVA**, o sea PARADA y
 * EN_REPARACION juntas: desde el lado de producción las dos son lo mismo —la
 * planta no produce— y separarlas daría dos números que nadie suma de cabeza.
 * La diferencia entre una y otra se ve en la fila.
 *
 * Suma el estado **abierto** también, con lo que lleva hasta ahora: si
 * Hidratación está parada desde hace cuatro días, esos cuatro días son parte
 * de la cuenta. Dejarlos afuera haría que el número bajara justo cuando hay
 * una planta parada, que es cuando se mira.
 */
export function resumirHistorial(
  cambios: CambioConPermanencia[]
): ResumenDelHistorial {
  let paradas = 0;
  let fueraDeServicioMs = 0;
  const sectores = new Set<string>();

  for (const c of cambios) {
    if (c.new_status !== "ACTIVA") {
      paradas += 1;
      fueraDeServicioMs += c.duracionMs;
    }
    sectores.add(c.sector_id ?? `huerfana:${c.id}`);
  }

  return { cambios: cambios.length, paradas, fueraDeServicioMs, sectores: sectores.size };
}
