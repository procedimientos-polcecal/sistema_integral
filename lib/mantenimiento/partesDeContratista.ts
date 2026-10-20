/**
 * Los partes diarios del contratista, y las OT que salen de ellos.
 *
 * Candia entrega **quince partes diarios en papel cada quince días**. Cada
 * hoja es un día de dos o tres personas repartido entre cinco frentes de
 * trabajo, y lo que se paga sale de una suma escrita a mano:
 *
 *     HORAS NORMALES   2 P. x 8H + 1 P. x 2H        HORAS  18H
 *
 * Acá vive todo lo que se puede probar sin hablar con nadie: leer esa suma,
 * repartirla entre los renglones del detalle, y agrupar los renglones de una
 * semana en las OT que les corresponden. Lo que habla con la base y con la
 * planilla está en las rutas.
 *
 * El diseño completo, con el porqué de cada regla, está en
 * `docs/superpowers/specs/2026-10-20-mantenimiento-partes-de-contratista-design.md`.
 */

// ── El texto de Candia ──────────────────────────────────────

/**
 * La forma canónica de un lugar escrito a mano, para poder buscarlo.
 *
 * Minúsculas, sin acentos y con los espacios colapsados: "Molino Horizontal",
 * "molino  horizontal" y "MOLINO HORIZONTAL" son el mismo lugar, y quien
 * escribe el parte no tiene por qué saberlo.
 *
 * **La eñe se conserva.** Normalizar en NFD la parte en `n` + tilde, y la
 * barrida de marcas se la lleva — "Rincón Soñado" y "Rincon Sonado" quedarían
 * iguales, que no molesta, pero "caño" y "cano" también, que sí. Se la protege
 * antes de descomponer y se la devuelve después, que es lo mismo que hace el
 * comparador de los desplegables.
 */
export function normalizarLugar(texto: string): string {
  return String(texto ?? "")
    .trim()
    .toLowerCase()
    .replace(/ñ/g, "\u0001")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\u0001/g, "ñ")
    .replace(/\s+/g, " ");
}

/**
 * Si una actividad es el riego.
 *
 * Importa porque el riego **no se reparte**: sus horas son el segundo término
 * de la suma, enteras. Se reconoce por la palabra y no por una lista cerrada —
 * Candia escribe "Riego", "Riego en planta" y "riego de caminos", y las tres
 * son lo mismo.
 */
export function esRiego(actividad: string): boolean {
  return /\briegos?\b|\bregar\b/.test(normalizarLugar(actividad));
}

// ── La suma de horas ────────────────────────────────────────

export interface Termino {
  personas: number;
  horas: number;
}

/**
 * Los términos de la expresión de horas, en el orden en que están escritos.
 *
 * Acepta las formas que aparecen en el papel: `2 P. x 8H`, `2P x 8 Hs`,
 * `2 Pers. × 8h`. El separador puede ser `x`, `X`, `×` o `*`, y la `+` es lo
 * único que separa términos.
 *
 * Devuelve `null` si algo no se pudo leer, y **no adivina**: una expresión que
 * no se entiende se le muestra a quien está cargando, que tiene el papel
 * delante. Repartir sobre una lectura dudosa pondría horas en sectores que
 * nadie eligió.
 */
export function terminosDeLaExpresion(expresion: string): Termino[] | null {
  const crudo = String(expresion ?? "").trim();
  if (!crudo) return null;

  const partes = crudo.split("+");
  const terminos: Termino[] = [];

  for (const parte of partes) {
    // «2 P. x 8H» → personas, horas. El `P.` es opcional porque alguna hoja lo
    // escribe sin punto y alguna sin la P.
    const m = parte
      .replace(/,/g, ".")
      .match(/^\s*(\d+(?:\.\d+)?)\s*(?:p\w*\.?)?\s*[x×*]\s*(\d+(?:\.\d+)?)\s*h?\w*\.?\s*$/i);
    if (!m) return null;

    const personas = Number(m[1]);
    const horas = Number(m[2]);
    if (!Number.isFinite(personas) || !Number.isFinite(horas)) return null;
    if (personas <= 0 || horas <= 0) return null;

    terminos.push({ personas, horas });
  }

  return terminos.length > 0 ? terminos : null;
}

/** Cuántas horas suma la expresión. Es lo que tiene que dar el total del papel. */
export function totalDeLaExpresion(terminos: readonly Termino[]): number {
  return terminos.reduce((suma, t) => suma + t.personas * t.horas, 0);
}

// ── El reparto ──────────────────────────────────────────────

export interface RenglonDelParte {
  actividad: string;
  lugar_raw: string;
}

export interface RenglonRepartido extends RenglonDelParte {
  horas: number;
}

export type Reparto =
  | { ok: true; renglones: RenglonRepartido[]; total: number }
  | { ok: false; problemas: string[] };

/**
 * Dos decimales: centésimas de hora, que son treinta y seis segundos.
 *
 * **No se redondea a la media hora ni a la hora**, que sería lo cómodo de leer:
 * 16 h entre 5 renglones dan 3,2 y redondear a 3 o a 3,5 rompe que la quincena
 * cierre contra la factura, que es para lo que existe todo esto.
 *
 * Con una división que no es exacta —16 entre 3— la suma de los renglones
 * puede quedar a centésimas del total del papel. **El número con el que se
 * controla la factura no es ése sino `horas_declaradas`**, que es lo que
 * Candia escribió y se guarda tal cual; las horas por renglón son una
 * convención para repartirlas entre sectores.
 */
function redondearHoras(h: number): number {
  return Math.round(h * 100) / 100;
}

/**
 * Cuántas horas le tocan a cada renglón del detalle.
 *
 * LA REGLA, que es la de Candia y no una invención del sistema:
 *
 * - **El segundo término de la suma es siempre el riego**, entero y sin
 *   repartir. `1 P. × 2H` son dos horas de riego.
 * - **El primer término se reparte en partes iguales entre los renglones
 *   restantes.**
 *
 * Se reparte **por renglón y no por actividad**, y la diferencia se ve en el
 * parte 1301: «Planta N°3 zaranda» y «bajo cintas» son dos renglones del mismo
 * sector, así que al agrupar se funden en una OT de 8 h. Repartiendo por
 * actividad, limpieza se llevaría las 16 y habría que volver a partirlas entre
 * tres sectores — la misma cuenta, un paso después y con una decisión más que
 * tomar.
 *
 * **Se niega con todos los problemas juntos**, que es la vara de `validar()`
 * del núcleo: quien tiene el papel delante quiere saber todo lo que no cierra
 * de una sola vez, no descubrirlo de a uno.
 */
export function repartirHoras(
  expresion: string,
  renglones: readonly RenglonDelParte[],
  horasDeclaradas: number
): Reparto {
  const problemas: string[] = [];

  const terminos = terminosDeLaExpresion(expresion);
  if (!terminos) {
    return {
      ok: false,
      problemas: [
        `No se entiende «${String(expresion ?? "").trim()}» como una suma de horas. ` +
        `Tiene que ser de la forma "2 P. x 8H" o "2 P. x 8H + 1 P. x 2H".`,
      ],
    };
  }

  // Más de dos términos no se interpreta. El segundo es el riego y del tercero
  // no se sabe nada: repartirlo sería inventar una regla, y ninguna de las
  // hojas medidas tiene uno. Si aparece, lo contesta una persona.
  if (terminos.length > 2) {
    problemas.push(
      `La suma tiene ${terminos.length} términos y sólo se saben leer dos: el primero ` +
      `se reparte y el segundo es el riego. Cargalo como dos partes o decime qué es el tercero.`
    );
  }

  const total = totalDeLaExpresion(terminos);
  if (total !== horasDeclaradas) {
    problemas.push(
      `La suma da ${total} h y el papel dice ${horasDeclaradas} h. ` +
      `Mientras no cierren, el parte no sirve para controlar la factura.`
    );
  }

  if (renglones.length === 0) {
    problemas.push("El detalle del trabajo está vacío: no hay entre qué repartir las horas.");
  }

  const losDeRiego = renglones.filter((r) => esRiego(r.actividad));
  const elResto = renglones.filter((r) => !esRiego(r.actividad));

  const hayRiegoEnLaSuma = terminos.length >= 2;

  if (hayRiegoEnLaSuma && losDeRiego.length === 0) {
    problemas.push(
      `La suma tiene un segundo término —${terminos[1].personas} × ${terminos[1].horas} h, ` +
      `que son las horas de riego— pero ningún renglón del detalle dice riego.`
    );
  }
  if (hayRiegoEnLaSuma && losDeRiego.length > 1) {
    problemas.push(
      `Hay ${losDeRiego.length} renglones de riego y un solo término para repartirles. ` +
      `Dejá uno solo.`
    );
  }
  // Y al revés: el detalle nombra el riego pero la suma no lo paga. **No se le
  // inventan horas**: se muestra, que es lo que pide el diseño. Que Candia lo
  // escriba no quiere decir que lo esté cobrando aparte.
  if (!hayRiegoEnLaSuma && losDeRiego.length > 0) {
    problemas.push(
      `El detalle nombra riego pero la suma «${expresion}» no tiene segundo término, ` +
      `así que no hay horas de riego para darle. Revisá el papel.`
    );
  }
  if (elResto.length === 0 && renglones.length > 0) {
    problemas.push(
      "Todos los renglones son riego, así que no hay entre qué repartir el primer término."
    );
  }

  if (problemas.length > 0) return { ok: false, problemas };

  const horasDeRiego = hayRiegoEnLaSuma ? terminos[1].personas * terminos[1].horas : 0;
  const porRenglon = (terminos[0].personas * terminos[0].horas) / elResto.length;

  const repartidos: RenglonRepartido[] = renglones.map((r) => ({
    ...r,
    horas: redondearHoras(esRiego(r.actividad) ? horasDeRiego : porRenglon),
  }));

  return {
    ok: true,
    renglones: repartidos,
    total: redondearHoras(repartidos.reduce((s, r) => s + r.horas, 0)),
  };
}

// ── La semana ───────────────────────────────────────────────

/**
 * El lunes de la semana de una fecha, en "YYYY-MM-DD".
 *
 * La semana corre **de lunes a domingo**, que es como se mira el trabajo de
 * planta y como vienen los partes. Se calcula en UTC a propósito: una fecha
 * sin hora construida como local se corre un día en Argentina, y de esa fecha
 * sale después la fecha de cierre de la OT.
 */
export function lunesDeLaSemana(fecha: string): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  // getUTCDay(): domingo es 0. Se lo lleva al final de la semana, no al principio.
  const dia = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dia);
  return d.toISOString().slice(0, 10);
}

// ── La agrupación en OT ─────────────────────────────────────

export interface RenglonParaAgrupar {
  id: string;
  parte_numero: number;
  fecha: string;
  actividad: string;
  lugar_raw: string;
  sector_id: string | null;
  equipo_id: string | null;
  horas: number;
}

export interface GrupoDeOT {
  /** `semana|actividad normalizada|sector`. Es lo que hace a una OT una OT. */
  clave: string;
  semana: string;
  actividad: string;
  sector_id: string;
  /**
   * El equipo, **sólo si todos los renglones del grupo apuntan al mismo**.
   *
   * Es la única excepción a «toda OT lleva equipo», que rige desde el
   * 19/10/2026 porque de ahí viven el MTBF y la ficha de la máquina. Acá la
   * agrupación es por sector —se pidió así: "1 actividad por OT por sector"—,
   * y una semana de limpieza que tocó el horno y además las cintas no es de
   * ninguna de las dos máquinas. **Poner una de ellas sería enlazar al que se
   * le parece**, con el agravante de que las horas irían a su MTBF.
   *
   * Queda en null y la pantalla lo dice antes de generar, que es lo que
   * permite arreglarlo enseñándole el equipo al catálogo.
   */
  equipo_id: string | null;
  horas: number;
  /** La fecha del último parte del grupo: es cuando se dio por terminado. */
  fecha_cierre: string;
  renglon_ids: string[];
  /** Los textos de Candia con su número de parte, para la descripción. */
  detalle: { parte_numero: number; fecha: string; lugar_raw: string; horas: number }[];
}

export interface Agrupacion {
  grupos: GrupoDeOT[];
  /** Los que no se pueden convertir todavía, y por qué. */
  sinSector: RenglonParaAgrupar[];
}

/**
 * Los renglones de una tanda, agrupados en las OT que les corresponden.
 *
 * Una OT por **(semana, actividad, sector)**, con las horas sumadas: es lo que
 * se pidió —"una OT cada semana, por sector"— y lo que hace que el papel se
 * pueda leer como trabajo y no como una lista de días.
 *
 * **Los renglones sin sector quedan afuera y se devuelven aparte.** No se los
 * manda a un sector parecido ni a uno genérico: un enlace equivocado pone las
 * horas en el centro de costo que no es y eso no se nota nunca. Quedan para
 * que alguien los enganche, y la próxima corrida los toma.
 */
export function agruparEnOrdenes(
  renglones: readonly RenglonParaAgrupar[]
): Agrupacion {
  const porClave = new Map<string, GrupoDeOT>();
  const sinSector: RenglonParaAgrupar[] = [];

  for (const r of renglones) {
    if (!r.sector_id) { sinSector.push(r); continue; }

    const semana = lunesDeLaSemana(r.fecha);
    const actividad = r.actividad.trim();
    const clave = `${semana}|${normalizarLugar(actividad)}|${r.sector_id}`;

    const grupo = porClave.get(clave);
    if (!grupo) {
      porClave.set(clave, {
        clave,
        semana,
        actividad,
        sector_id: r.sector_id,
        equipo_id: r.equipo_id,
        horas: r.horas,
        fecha_cierre: r.fecha,
        renglon_ids: [r.id],
        detalle: [{
          parte_numero: r.parte_numero, fecha: r.fecha,
          lugar_raw: r.lugar_raw, horas: r.horas,
        }],
      });
      continue;
    }

    grupo.horas = redondearHoras(grupo.horas + r.horas);
    // Dos equipos distintos en el mismo grupo dejan la OT sin equipo. No se
    // queda con el primero: el primero no es más dueño de esas horas que el
    // segundo, y el que quedara se llevaría las dos al MTBF.
    if (grupo.equipo_id !== r.equipo_id) grupo.equipo_id = null;
    if (r.fecha > grupo.fecha_cierre) grupo.fecha_cierre = r.fecha;
    grupo.renglon_ids.push(r.id);
    grupo.detalle.push({
      parte_numero: r.parte_numero, fecha: r.fecha,
      lugar_raw: r.lugar_raw, horas: r.horas,
    });
  }

  // Ordenados por semana y después por actividad: es como se van a crear y
  // como se leen en la pantalla antes de confirmarlas.
  const grupos = [...porClave.values()].sort((a, b) =>
    a.semana.localeCompare(b.semana) || a.actividad.localeCompare(b.actividad)
  );

  for (const g of grupos) {
    g.detalle.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.parte_numero - b.parte_numero);
  }

  return { grupos, sinSector };
}

/**
 * Qué va a decir la OT.
 *
 * Lleva **los textos originales de Candia con su número de parte**, que es lo
 * único que permite volver del sistema al papel, y deja dicho que las horas
 * salen de un reparto. Eso último no es decoración: en seis meses alguien va a
 * leer "4 h" y va a creer que alguien las contó.
 */
export function descripcionDeLaOT(grupo: GrupoDeOT, contratista: string): string {
  const dias = grupo.detalle
    .map((d) => `${d.lugar_raw.trim()} (parte ${d.parte_numero}, ${fechaCorta(d.fecha)}, ${d.horas} h)`)
    .join("; ");

  return (
    `${grupo.actividad} — ${contratista}. Semana del ${fechaCorta(grupo.semana)}. ` +
    `${grupo.horas} h en total. Según los partes diarios: ${dias}. ` +
    `Las horas de cada parte se reparten en partes iguales entre sus renglones, ` +
    `así que son una convención y no una medición por frente de trabajo.`
  );
}

/** "2026-10-01" → "1/10". El día y el mes, que es como se nombra una fecha acá. */
function fechaCorta(fecha: string): string {
  const [, mes, dia] = fecha.split("-");
  return mes && dia ? `${Number(dia)}/${Number(mes)}` : fecha;
}
