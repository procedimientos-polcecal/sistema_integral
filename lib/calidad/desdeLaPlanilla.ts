import type { SupabaseClient } from "@supabase/supabase-js";
import { fechaDeSheets } from "@/lib/core/fechaDeSheets";
import { escribirCeldas, leerValores } from "@/lib/core/sheets";
import { movimientoDesdeElRenglon, type CatalogoDeLaPlanilla } from "./importar";
import { traerCarbonilleros, traerMovimientos } from "./consultas";

/**
 * Qué filas de la planilla hay que convertir en movimientos.
 *
 * Función pura: no habla con Sheets ni con Supabase. La corrida que sí lo hace
 * vive más abajo en este mismo archivo.
 *
 * **EL ANCLA ES EL ID DEL MOVIMIENTO, ESCRITO EN LA COLUMNA `K`.** Al leer una
 * fila y crear su movimiento, el SdG escribe ahí el id; en la corrida siguiente
 * esa fila ya no es nueva porque lleva su marca, esté donde esté.
 *
 * **El número de fila no servía, y está medido.** El 13/10/2026 lo di por
 * estable con una consulta que PostgREST cortó en 1.000 de 1.122 filas sin
 * avisar —la trampa que el CLAUDE.md documenta— y el tramo que quedó afuera era
 * justo donde estaba el corrimiento. Con las 1.122 a la vista: **30 filas
 * desalineadas**, por dos costumbres distintas que se dan las dos:
 *
 *   - entre el 04 y el 08/09 se insertaron tres filas en el medio, para dejar
 *     un camión olvidado en su lugar cronológico, y todo lo de abajo se corrió
 *     (+1, +2, +3);
 *   - a cinco consumos ya escritos les cambiaron la cantidad en el lugar.
 *
 * Una clave por número de fila se rompe con lo primero; una por contenido se
 * rompe con lo segundo. El id aguanta las dos: dice *"es la misma fila"* aunque
 * se haya movido, y entonces la comparación de contenido pasa a significar
 * *"además le cambiaron el número"*, que es un aviso y no una adivinanza.
 *
 * Lo que trae de nuevo, y por eso se informa en vez de resolverse solo: copiar
 * y pegar una fila duplica su id, y borrar un movimiento del SdG deja el id
 * huérfano en la planilla.
 *
 * Spec: docs/superpowers/specs/2026-10-13-calidad-la-planilla-manda-design.md
 */

/** Las columnas de `Entradas  Salidas`, por índice. */
const COL = { codigo: 0, descripcion: 1, entradas: 2, salidas: 3, fecha: 7, id: 10 } as const;

/** La columna `K`, que estaba vacía en las 3.399 filas y de la `K` a la `P` también. */
export const COLUMNA_DEL_ID = COL.id;

/** Lo que el SdG ya guardó de una fila que leyó. */
export interface FilaOcupada {
  /** Dónde estaba la última vez que se la vio. Se refresca en cada corrida. */
  fila: number;
  /** Positivas, como están en la planilla. `null` si esa columna estaba vacía. */
  entradas: number | null;
  salidas: number | null;
}

export interface FilaNueva {
  fila: number;
  celdas: unknown[];
}

export interface FilaConProblema {
  fila: number;
  fecha: string | null;
  codigo: string;
  descripcion: string;
  entradas: number | null;
  salidas: number | null;
  motivo: string;
}

/** Un movimiento que hoy está en otra fila que la que el SdG tenía anotada. */
export interface Reubicada {
  id: string;
  fila: number;
}

export interface PorLeer {
  /** Las que hay que convertir con `movimientoDesdeElRenglon`. */
  nuevas: FilaNueva[];
  /** Ya leídas y con otro contenido ahora. No se corrigen solas: se informan. */
  cambiadas: FilaConProblema[];
  /** Con número en las dos columnas: no se sabe si es entrada o salida. */
  ambiguas: FilaConProblema[];
  /** El mismo id en dos filas. Las dos quedan en disputa y no se toca ninguna. */
  duplicadas: FilaConProblema[];
  /** Con un id que no es de ningún movimiento del SdG. */
  huerfanas: FilaConProblema[];
  /** Ids del SdG que ya no están en la planilla. */
  desaparecidas: string[];
  /** Las que cambiaron de número de fila: hay que actualizarles `sheets_fila`. */
  reubicadas: Reubicada[];
}

function numero(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function describir(fila: number, celdas: unknown[], motivo: string): FilaConProblema {
  return {
    fila,
    fecha: fechaDeSheets(celdas[COL.fecha]),
    codigo: String(celdas[COL.codigo] ?? "").trim(),
    descripcion: String(celdas[COL.descripcion] ?? "").trim(),
    entradas: numero(celdas[COL.entradas]),
    salidas: numero(celdas[COL.salidas]),
    motivo,
  };
}

/** Tres decimales, que es `numeric(12,3)` en la base. */
function igual(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) < 0.0005;
}

export function filasPorLeer(ocupadas: Map<string, FilaOcupada>, filas: unknown[][]): PorLeer {
  const nuevas: FilaNueva[] = [];
  const cambiadas: FilaConProblema[] = [];
  const ambiguas: FilaConProblema[] = [];
  const duplicadas: FilaConProblema[] = [];
  const huerfanas: FilaConProblema[] = [];
  const reubicadas: Reubicada[] = [];

  // Primero, en qué filas aparece cada id. Un id repetido no se puede detectar
  // mirando una fila sola, y mientras esté repetido ninguna de las dos sirve
  // como ancla. La fila 1 es el encabezado; se cuenta desde 1, como la ve una
  // persona.
  const apariciones = new Map<string, number[]>();
  filas.slice(1).forEach((celdas, i) => {
    const id = String(celdas[COL.id] ?? "").trim();
    if (!id) return;
    const previas = apariciones.get(id);
    if (previas) previas.push(i + 2);
    else apariciones.set(id, [i + 2]);
  });

  const vistos = new Set<string>();

  filas.slice(1).forEach((celdas, i) => {
    const fila = i + 2;

    const codigo = String(celdas[COL.codigo] ?? "").trim();
    const descripcion = String(celdas[COL.descripcion] ?? "").trim();
    const id = String(celdas[COL.id] ?? "").trim();
    if (!codigo && !descripcion && !id) return;

    const entradas = numero(celdas[COL.entradas]);
    const salidas = numero(celdas[COL.salidas]);

    if (id) {
      vistos.add(id);

      // Copiar y pegar una fila se lleva su id. Sin esto el SdG creería que la
      // copia es el original y seguiría el movimiento hasta la fila que no es.
      const donde = apariciones.get(id) ?? [fila];
      if (donde.length > 1) {
        duplicadas.push(
          describir(
            fila,
            celdas,
            `El mismo id está en dos filas de la planilla (${donde.join(", ")}): ` +
              "probablemente se copió una fila. Borrá la columna K de la copia."
          )
        );
        return;
      }

      // El id está en la planilla pero el movimiento ya no está en el SdG. No
      // se relee: volvería a entrar con otro id y el camión quedaría dos veces.
      const ya = ocupadas.get(id);
      if (!ya) {
        huerfanas.push(
          describir(
            fila,
            celdas,
            `La columna K dice ${id}, que no es ningún movimiento del SdG. ` +
              "Si la fila tiene que entrar, borrá esa celda."
          )
        );
        return;
      }

      if (ya.fila !== fila) reubicadas.push({ id, fila });

      // No se corrige sola: cambiar una fila vieja mueve el saldo de todo lo
      // que vino después. Se informa y lo decide una persona.
      if (!igual(ya.entradas, entradas) || !igual(ya.salidas, salidas)) {
        cambiadas.push(
          describir(
            fila,
            celdas,
            `La planilla dice entradas ${entradas ?? "—"} y salidas ${salidas ?? "—"}; ` +
              `el SdG había leído entradas ${ya.entradas ?? "—"} y salidas ${ya.salidas ?? "—"}.`
          )
        );
      }
      return;
    }

    // Con número en las dos columnas no se sabe qué es, y
    // `movimientoDesdeElRenglon` tomaría la entrada perdiendo la salida.
    if (entradas !== null && entradas !== 0 && salidas !== null && salidas !== 0) {
      ambiguas.push(
        describir(fila, celdas, "La fila tiene entrada y salida a la vez: no se sabe cuál es.")
      );
      return;
    }

    nuevas.push({ fila, celdas });
  });

  // Que un movimiento ya no tenga su fila no rompe nada ni crea nada: alguien
  // borró la fila allá, y eso se informa.
  const desaparecidas = [...ocupadas.keys()].filter((id) => !vistos.has(id)).sort();

  return { nuevas, cambiadas, ambiguas, duplicadas, huerfanas, desaparecidas, reubicadas };
}

/* ────────────────────────────────────────────────────────────────────────── */

/** La pestaña de datos. Lleva dos espacios en el medio, y no es un error. */
export const PESTANA = "Entradas  Salidas";

const PLANILLA = () => process.env.GOOGLE_SHEETS_STOCK_CARBONILLA_ID ?? "";

export interface ResumenDeLectura {
  filasLeidas: number;
  nuevos: number;
  cambiadas: number;
  ambiguas: number;
  duplicadas: number;
  huerfanas: number;
  desaparecidas: number;
  reubicadas: number;
  sinReconocer: number;
}

/**
 * Traer de la planilla los movimientos que el libro todavía no tiene.
 *
 * **Lee la planilla entera**, no los últimos N días: son 3.399 filas y una sola
 * lectura, y de paso así se ve si alguien corrigió una fila vieja.
 *
 * **ESTA LECTURA ESCRIBE**, que es lo que la hace distinta de las otras tres
 * planillas: le pone a cada fila nueva el id de su movimiento en la columna
 * `K`. Sin esa marca el ancla vuelve a ser el número de fila, que ya se rompió.
 *
 * **El id se escribe ANTES de insertar, a propósito.** Si Google falla, no se
 * inserta nada y no pasa nada. Si falla el `insert`, en la planilla quedan ids
 * de movimientos que no existen: la corrida siguiente los informa como
 * huérfanos, que es ruidoso pero visible. Al revés —insertar y después
 * escribir— un fallo dejaría filas sin marca que la corrida siguiente volvería
 * a importar, y el stock se duplicaría en silencio. Entre un aviso de más y un
 * dato de más, el aviso.
 *
 * **Lanza si Google falla, y eso es a propósito.** Quien la llama tiene que
 * anotarse como `ok: false` en `sincronizaciones` y no correr el control contra
 * Odoo: una corrida que falla a mitad y se anota bien deja el libro incompleto
 * sin que nada avise, y el control sobre un libro a medias inventa desvíos.
 *
 * Spec: docs/superpowers/specs/2026-10-13-calidad-la-planilla-manda-design.md
 */
export async function leerLaPlanilla(supabase: SupabaseClient): Promise<ResumenDeLectura> {
  if (!PLANILLA()) {
    throw new Error(
      "Falta GOOGLE_SHEETS_STOCK_CARBONILLA_ID: sin eso no se puede leer la planilla de stock."
    );
  }

  const [carbonilleros, movimientos] = await Promise.all([
    traerCarbonilleros(supabase),
    traerMovimientos(supabase),
  ]);

  const catalogo: CatalogoDeLaPlanilla = new Map(
    carbonilleros.map((c) => [c.codigo_planilla, { id: c.id, carbon: c.carbon }])
  );

  // Lo que el SdG ya leyó de cada fila, por id. El signo se devuelve a positivo
  // para poder compararlo con las columnas de la planilla, que no lo tienen.
  // `sheets_fila` es lo que dice si el movimiento está escrito allá; desde el
  // 14/10/2026 ya no es la clave, sino dónde estaba la última vez.
  const ocupadas = new Map<string, FilaOcupada>();
  for (const m of movimientos) {
    if (m.sheets_fila === null) continue;
    const t = Number(m.toneladas);
    ocupadas.set(m.id, {
      fila: m.sheets_fila,
      entradas: t > 0 ? t : null,
      salidas: t < 0 ? -t : null,
    });
  }

  const filas = await leerValores(PLANILLA(), PESTANA, { sinFormato: true });
  const r = filasPorLeer(ocupadas, filas);

  const nuevos: Record<string, unknown>[] = [];
  const marcas: { pestana: string; columna: number; fila: number; valor: string }[] = [];
  const problemas: FilaConProblema[] = [
    ...r.cambiadas,
    ...r.ambiguas,
    ...r.duplicadas,
    ...r.huerfanas,
  ];

  for (const n of r.nuevas) {
    const conv = movimientoDesdeElRenglon(n.celdas, n.fila, catalogo);
    if (conv.clase === "vacia") continue;
    if (conv.clase === "sin_importar") {
      problemas.push(describir(n.fila, n.celdas, conv.motivo));
      continue;
    }
    // El id se arma acá y no lo pone la base: hay que escribirlo en la planilla
    // antes de insertar, así que tiene que conocerse antes.
    const id = crypto.randomUUID();
    // `origen` queda en 'importacion', que es lo que dice de dónde vino: de la
    // planilla, igual que los 1.047 de septiembre.
    nuevos.push({ id, ...conv.movimiento, cargado_por: null });
    marcas.push({ pestana: PESTANA, columna: COL.id, fila: n.fila, valor: id });
  }

  // Una sola llamada para las marcas: con 1.124 filas, una por celda gastaría
  // la cuota y dejaría la planilla a medio marcar si falla la tercera.
  await escribirCeldas(PLANILLA(), marcas);

  for (let i = 0; i < nuevos.length; i += 500) {
    const { error } = await supabase.from("calidad_movimientos").insert(nuevos.slice(i, i + 500));
    if (error) throw new Error(error.message);
  }

  // Las que se corrieron de lugar: `sheets_fila` pasa a decir dónde están hoy,
  // para que una corrección las reescriba en la fila que es.
  for (const u of r.reubicadas) {
    const { error } = await supabase
      .from("calidad_movimientos")
      .update({ sheets_fila: u.fila })
      .eq("id", u.id);
    if (error) throw new Error(error.message);
  }

  // La bandeja se rehace entera en cada corrida: lo que se arregló en la
  // planilla deja de figurar solo, sin que nadie tenga que ir a borrarlo.
  const { error: errorAlLimpiar } = await supabase
    .from("calidad_planilla_sin_reconocer")
    .delete()
    .gte("fila", 0);
  if (errorAlLimpiar) throw new Error(errorAlLimpiar.message);

  if (problemas.length) {
    const { error } = await supabase.from("calidad_planilla_sin_reconocer").insert(
      problemas.map((p) => ({
        fila: p.fila,
        fecha: p.fecha,
        codigo: p.codigo,
        descripcion: p.descripcion,
        entradas: p.entradas,
        salidas: p.salidas,
        motivo: p.motivo,
      }))
    );
    if (error) throw new Error(error.message);
  }

  return {
    filasLeidas: filas.length,
    nuevos: nuevos.length,
    cambiadas: r.cambiadas.length,
    ambiguas: r.ambiguas.length,
    duplicadas: r.duplicadas.length,
    huerfanas: r.huerfanas.length,
    desaparecidas: r.desaparecidas.length,
    reubicadas: r.reubicadas.length,
    sinReconocer: problemas.length,
  };
}
