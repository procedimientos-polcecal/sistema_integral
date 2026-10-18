/**
 * Qué se borra cuando una fila desaparece de la planilla.
 *
 * POR QUÉ EXISTE
 *
 * Las sincronizaciones hacen `upsert`: traen lo que la planilla tiene y pisan
 * lo que ya estaba. Lo que **no** hacían es borrar, así que una fila que
 * alguien sacaba de la planilla seguía viva en el SdG para siempre, y el
 * espejo dejaba de ser un espejo sin que nada avisara.
 *
 * Esto decide qué se borra. Vive en `core` y no en un módulo porque lo usan
 * Mantenimiento —OT, avisos, órdenes de servicio— y Compras, y la parte
 * peligrosa es exactamente la misma en los cuatro.
 *
 * EL PRINCIPIO
 *
 * **Sólo se borra aquello cuya ausencia en la planilla prueba algo.**
 *
 * Que una fila no haya venido en la lectura puede significar dos cosas muy
 * distintas: que alguien la borró, o que nosotros no la vimos. Las dos se
 * parecen y una sola justifica borrar. Entonces se protege todo lo que cae del
 * lado de "no probamos nada":
 *
 * - La que **la planilla nunca tuvo**, porque la escribió la app y todavía no
 *   se exportó. Hoy hay una OT así.
 * - La que **nació mientras corríamos**. Leímos la planilla a las 9:15 y a las
 *   9:16 alguien cargó una OT: no estaba en lo que leímos y eso no es culpa de
 *   nadie.
 * - **Todas, si alguna fuente no se pudo leer.** La sincronización de órdenes
 *   de servicio lee una pestaña por área y la de Compras varias hojas; si una
 *   falla, sus filas faltan en bloque y borrarlas sería vaciar un área entera
 *   por un error de red.
 *
 * Lo que **no** protege es la fila que la app editó. Se discutió y se decidió
 * que no: si la planilla manda, manda también para borrar, y una fila que
 * sobrevive a su borrado porque alguien le tocó un campo es justo el tipo de
 * divergencia silenciosa que esto viene a cerrar. Lo que sí hace es contarlas
 * aparte, para que el informe diga qué se llevó puesto.
 *
 * EL FRENO DE MANO
 *
 * Un borrado de verdad no se deshace, así que hay un tope: si lo que habría
 * que borrar pasa de cierto tamaño, **no se borra nada** y se informa. No es
 * paranoia abstracta —el 13/10/2026 una lectura devolvió dos filas de una
 * planilla de 623 porque estaba recalculando, y con este borrado puesto esa
 * lectura se habría llevado 621 órdenes de trabajo—. `leerValores()` ahora
 * corta sola en ese caso, pero el freno cubre lo que todavía no sabemos que
 * puede salir mal: una pestaña renombrada, un filtro que alguien dejó puesto,
 * un `IMPORTRANGE` que devolvió vacío.
 *
 * El freno se puede levantar a mano cuando el borrado grande es de verdad
 * —una limpieza de fin de año—, y eso es a propósito: lo levanta una persona
 * que miró el número, no el cron.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { traerTodo } from "@/lib/core/paginado";
import { auditar } from "@/lib/core/auditoria";

/** Una fila del espejo que la planilla no trajo. */
export interface FilaDelEspejo {
  id: string;
  /** Cómo la nombra la planilla: el N° de OT, el de aviso, el RI. Para informar. */
  numero: string | number | null;
  /** La escribió la app y todavía no llegó a la planilla. */
  nuncaEstuvoEnLaPlanilla: boolean;
  /** La app le cambió algo: sirve para contar qué se lleva el borrado. */
  editadaEnLaApp: boolean;
  /** Cuándo apareció en la base, en ISO. */
  creadaEn: string | null;
}

/** Por qué una fila no se borra. */
export interface Protegida {
  fila: FilaDelEspejo;
  motivo: string;
}

export interface Veredicto {
  borrar: FilaDelEspejo[];
  protegidas: Protegida[];
  /** Cuántas de las que se van habían sido editadas desde la app. */
  editadas: number;
  /** Con texto, no se borra **nada** y hay que decírselo a quien disparó la corrida. */
  freno: string | null;
}

export interface Opciones {
  /** Las filas del espejo que esta corrida no tocó. */
  candidatas: FilaDelEspejo[];
  /** Cuántas filas tiene la tabla, para medir si el borrado es desproporcionado. */
  totalEnLaBase: number;
  /** El instante en que arrancó la corrida, en ISO. */
  inicioDeLaCorrida: string;
  /** Las fuentes que no se pudieron leer. Con una sola, no se borra nada. */
  fuentesSinLeer?: readonly string[] | null;
  /** Tope absoluto: más que esto es sospechoso. */
  tope?: number;
  /** Tope relativo, en porcentaje de la tabla. */
  topePorcentaje?: number;
  /** Lo levantó una persona que miró el número. */
  sinFreno?: boolean;
}

/**
 * Los topes.
 *
 * Cincuenta filas o el 10% de la tabla, lo que sea **mayor**: en una tabla
 * chica el porcentaje solo frenaría cualquier limpieza normal, y en una grande
 * el número fijo solo dejaría pasar un desastre. Con 2.201 OT el freno salta a
 * las 221; con 172 avisos, a las 50.
 */
const TOPE = 50;
const TOPE_PORCENTAJE = 10;

/** Qué se borra, qué se protege y si hay que frenar del todo. */
export function queSeBorra(opciones: Opciones): Veredicto {
  const {
    candidatas, totalEnLaBase, inicioDeLaCorrida,
    fuentesSinLeer, tope = TOPE, topePorcentaje = TOPE_PORCENTAJE, sinFreno = false,
  } = opciones;

  const protegidas: Protegida[] = [];
  const borrar: FilaDelEspejo[] = [];

  for (const fila of candidatas) {
    if (fila.nuncaEstuvoEnLaPlanilla) {
      protegidas.push({ fila, motivo: "la escribió la app y todavía no se exportó" });
      continue;
    }
    if (fila.creadaEn && fila.creadaEn > inicioDeLaCorrida) {
      protegidas.push({ fila, motivo: "apareció después de que leyéramos la planilla" });
      continue;
    }
    borrar.push(fila);
  }

  const editadas = borrar.filter((f) => f.editadaEnLaApp).length;

  // Una fuente que no se leyó no dice nada sobre sus filas. Esto va antes que
  // el tope: aunque sean tres, no hay razón para creer que las borraron.
  if (fuentesSinLeer && fuentesSinLeer.length > 0) {
    return {
      borrar: [], protegidas, editadas: 0,
      freno:
        `No se borró nada: no se pudo leer ${fuentesSinLeer.join(", ")}. ` +
        "Las filas que faltan pueden estar ahí. Se guardó lo que sí se leyó.",
    };
  }

  const limite = Math.max(tope, Math.ceil((totalEnLaBase * topePorcentaje) / 100));
  if (!sinFreno && borrar.length > limite) {
    return {
      borrar: [], protegidas, editadas: 0,
      freno:
        `No se borró nada: la planilla no trajo ${borrar.length} de las ${totalEnLaBase} filas ` +
        `que hay, y el tope es ${limite}. Si el borrado es correcto, hay que confirmarlo a mano.`,
    };
  }

  return { borrar, protegidas, editadas, freno: null };
}

/**
 * Cómo se cuenta lo que pasó, para el informe y el registro.
 *
 * Que diga **cuáles** y no sólo cuántas: un borrado no se deshace, así que el
 * número de OT tiene que quedar escrito en algún lado el día que alguien
 * pregunte dónde fue a parar la 1843.
 */
export function comoSeCuenta(veredicto: Veredicto): string | null {
  if (veredicto.freno) return veredicto.freno;
  if (veredicto.borrar.length === 0) return null;

  const numeros = veredicto.borrar.map((f) => f.numero ?? f.id);
  const lista = numeros.length > 20
    ? `${numeros.slice(0, 20).join(", ")} y ${numeros.length - 20} más`
    : numeros.join(", ");

  const editadas = veredicto.editadas > 0
    ? ` ${veredicto.editadas} de ellas tenían cambios hechos desde el sistema.`
    : "";

  return `Se borraron ${veredicto.borrar.length} que la planilla ya no tiene: ${lista}.${editadas}`;
}

/* ──────────────────────────────────────────────────────────────────────────
 * La otra mitad: la que toca la base
 *
 * `queSeBorra` decide y no sabe nada de Supabase, que es lo que la hace
 * testeable. Esto la usa: busca las candidatas, le pregunta, borra y audita.
 * Vive al lado y no en cada sincronización porque son cuatro, y cuatro copias
 * de un borrado es cuatro veces la posibilidad de que una se olvide el freno.
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Cómo se llama cada cosa en la tabla que se espeja.
 *
 * Son nombres de columna en texto porque la tabla es distinta en cada
 * sincronización. El precio es que un nombre mal escrito no lo atrapa el
 * compilador: lo atrapa PostgREST en la corrida, con un error que nombra la
 * columna. A cambio, la lógica peligrosa existe una sola vez.
 */
export interface EspejoBorrable {
  tabla: string;
  /** La que nombra la fila para el informe: "ot_number", "nro_ri". */
  numero: string;
  /** La que esta corrida sella: "synced_at", "sheets_sincronizado_en". */
  sincronizado: string;
  /** Cuándo apareció la fila: "created_at_app", "created_at". */
  creada: string;
  /** El puntero a la planilla: "sheets_row", "sheets_fila". */
  fila: string;
  /**
   * Cómo se sabe que la escribió la app. `columna` con el valor que lo
   * significa: `app_created = true`, `origen = "app"`.
   */
  deLaApp: { columna: string; valor: string | boolean };
  /** La marca de "la app le cambió algo", si la tabla la tiene. */
  editada?: string | null;
  /** Para la auditoría. */
  modulo: string;
  entidad: string;
}

export interface LoQuePaso {
  borradas: number;
  /** Para contárselo a quien disparó la corrida. `null` si no hubo nada que decir. */
  aviso: string | null;
  /** Los números borrados, para el registro de sincronización. */
  numeros: Array<string | number>;
}

/**
 * Borra lo que la planilla dejó de tener.
 *
 * Se llama **después** del `upsert`, porque lo que decide quién sobra es haber
 * sido sellada por esta corrida: todo lo que la planilla trajo quedó con
 * `sincronizado = cuando`, así que las candidatas son las demás.
 *
 * Nunca tira. Un borrado que falla no puede tumbar una sincronización que ya
 * guardó bien lo nuevo: lo único que pasa es que quedan de más unas filas que
 * la planilla no tiene, y la próxima corrida las limpia. Es el mismo criterio
 * que ya usaba el borrado de comparativas.
 */
export async function borrarLoQueLaPlanillaNoTrajo(
  cliente: SupabaseClient,
  espejo: EspejoBorrable,
  corrida: {
    /** El valor que esta corrida escribió en `sincronizado`. */
    cuando: string;
    /** Cuándo arrancó, que puede ser anterior a `cuando`. */
    inicio: string;
    fuentesSinLeer?: readonly string[] | null;
    sinFreno?: boolean;
    actor?: "sincronizacion" | "cron";
  }
): Promise<LoQuePaso> {
  const sinNada: LoQuePaso = { borradas: 0, aviso: null, numeros: [] };

  // La cadena del select se arma acá porque las columnas cambian por tabla.
  // Se pierde la inferencia de tipos de Supabase —la regla de CLAUDE.md— y en
  // este caso no hay alternativa: la tabla es un parámetro. Por eso las dos
  // lecturas declaran su tipo con `.returns<>()`: sin eso Supabase las tipa
  // como `GenericStringError[]` y `tsc` las rechaza, que es la misma regla
  // avisando por el otro lado.
  const columnas = [
    "id", espejo.numero, espejo.creada, espejo.fila,
    espejo.deLaApp.columna, espejo.editada,
  ].filter(Boolean).join(", ");

  // Las dos lecturas van ordenadas por `id`. No es por prolijidad: `LIMIT` y
  // `OFFSET` sin `ORDER BY` no tienen garantizada la estabilidad entre
  // páginas, asi que una fila podria aparecer dos veces o ninguna. Medido el
  // 18/10/2026 sobre las 2.200 ordenes de trabajo, sin orden no fallaba — pero
  // lo que decide acá qué se borra no puede depender de que el planificador
  // siga eligiendo el mismo recorrido.
  let candidatas: Record<string, unknown>[];
  let total: number;
  try {
    candidatas = await traerTodo<Record<string, unknown>>((desde, hasta) =>
      cliente.from(espejo.tabla).select(columnas).neq(espejo.sincronizado, corrida.cuando)
        .order("id").range(desde, hasta).returns<Record<string, unknown>[]>()
    );
    // Las que nunca se sincronizaron también sobran: un `neq` no alcanza a un
    // null en SQL, así que van en su propia consulta.
    const nulas = await traerTodo<Record<string, unknown>>((desde, hasta) =>
      cliente.from(espejo.tabla).select(columnas).is(espejo.sincronizado, null)
        .order("id").range(desde, hasta).returns<Record<string, unknown>[]>()
    );
    candidatas.push(...nulas);
    // Un id no puede venir en las dos consultas —un valor es distinto de
    // `cuando` o es null, no las dos cosas—, pero si alguna vez pasara, el
    // número que se informa y el que se audita dejarían de ser el mismo que
    // se borra. Contar dos veces lo mismo es barato de evitar.
    const vistos = new Set<string>();
    candidatas = candidatas.filter((f) => !vistos.has(String(f.id)) && vistos.add(String(f.id)));

    const { count, error } = await cliente.from(espejo.tabla).select("id", { count: "exact", head: true });
    if (error) throw new Error(error.message);
    total = count ?? 0;
  } catch (e) {
    return { ...sinNada, aviso: `No se pudo mirar qué sobra, así que no se borró nada: ${(e as Error).message}` };
  }

  if (candidatas.length === 0) return sinNada;

  const veredicto = queSeBorra({
    candidatas: candidatas.map((f) => ({
      id: String(f.id),
      numero: (f[espejo.numero] ?? null) as string | number | null,
      nuncaEstuvoEnLaPlanilla:
        f[espejo.deLaApp.columna] === espejo.deLaApp.valor && f[espejo.fila] === null,
      editadaEnLaApp: espejo.editada ? f[espejo.editada] === true : false,
      creadaEn: (f[espejo.creada] ?? null) as string | null,
    })),
    totalEnLaBase: total,
    inicioDeLaCorrida: corrida.inicio,
    fuentesSinLeer: corrida.fuentesSinLeer,
    sinFreno: corrida.sinFreno,
  });

  if (veredicto.freno || veredicto.borrar.length === 0) {
    return { ...sinNada, aviso: comoSeCuenta(veredicto) };
  }

  // El registro va ANTES del borrado, y si no se puede escribir no se borra.
  //
  // En las otras seis rutas que auditan, el registro va después porque la
  // acción ya pasó: para cuando se audita, el asiento está posteado. Acá no:
  // nosotros decidimos el orden, y entre "borrar sin registro" y "no borrar",
  // la regla de esta casa —lo que no se deshace se audita— sólo admite lo
  // segundo. De paso la migración del verbo `borrar` se vuelve un requisito
  // que se hace cumplir solo en vez de un párrafo que alguien tiene que
  // acordarse de leer: sin ella, esto no borra nada y lo dice.
  //
  // Un evento por corrida y no uno por fila: lo que hay que poder reconstruir
  // es "esta corrida se llevó estas filas", y 221 eventos iguales con distinto
  // id no se leen.
  const numeros = veredicto.borrar.map((f) => f.numero ?? f.id);
  const registro = await auditar(cliente, {
    modulo: espejo.modulo,
    entidad: espejo.entidad,
    entidadId: `corrida ${corrida.cuando}`,
    accion: "borrar",
    actor: corrida.actor ?? "sincronizacion",
    valorAnterior: String(total),
    valorNuevo: String(total - veredicto.borrar.length),
    contexto: { tabla: espejo.tabla, numeros, corrida: corrida.cuando },
  });
  if (!registro.ok) {
    return {
      ...sinNada,
      aviso:
        `No se borró nada: la acción no se pudo registrar en la auditoría (${registro.error}). ` +
        "Un borrado sin registro no se hace. Si falta la migración 20261018134754, hay que aplicarla.",
    };
  }

  // De a 200: un `.in()` con muchos ids arma una URL que PostgREST rechaza con
  // un 400 que no dice por qué.
  const ids = veredicto.borrar.map((f) => f.id);
  let borradas = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const lote = ids.slice(i, i + 200);
    const { error } = await cliente.from(espejo.tabla).delete().in("id", lote);
    if (error) {
      return {
        borradas,
        numeros: veredicto.borrar.slice(0, borradas).map((f) => f.numero ?? f.id),
        aviso:
          `Se borraron ${borradas} de ${ids.length} y el resto quedó: ${error.message}. ` +
          "Se van a ver de más hasta la próxima sincronización. " +
          // El registro se escribió antes y dice las que se iban a borrar, no
          // las que se borraron. La auditoría es inmutable, así que la
          // corrección va acá y no allá: quien lea el registro tiene que saber
          // que ese número es una intención y no un hecho.
          `La auditoría de esta corrida anotó ${ids.length}, que es lo que se intentó.`,
      };
    }
    borradas += lote.length;
  }

  return { borradas, numeros, aviso: comoSeCuenta(veredicto) };
}
