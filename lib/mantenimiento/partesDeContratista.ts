/**
 * Los partes diarios del contratista, y las OT que salen de ellos.
 *
 * Candia entrega **quince partes diarios en papel cada quince días**. Cada
 * hoja es un día de dos o tres personas repartido entre cinco frentes de
 * trabajo, con el total de horas escrito a mano en una casilla:
 *
 *     HORAS NORMALES   2 P. x 8H + 1 P. x 2H        HORAS  18H
 *
 * **Las horas de cada renglón las escribe quien carga el parte** (22/10/2026).
 * Hasta entonces salían de leer esa expresión y repartir el primer término en
 * partes iguales entre los renglones que no eran riego; el reparto parejo
 * sigue existiendo, pero como **propuesta** —`repartoParejo`— y no como regla.
 * El motivo: repartir parejo supone que todos los frentes llevaron lo mismo, y
 * quien tiene la hoja delante sabe que a veces no.
 *
 * Lo que no cambió es el control: **la suma de los renglones tiene que dar el
 * total escrito a mano**, que es lo que permite controlar la factura. Sin eso
 * esto sería sólo transcribir.
 *
 * Acá vive todo lo que se puede probar sin hablar con nadie: proponer el
 * reparto, controlar que cierre, y agrupar los renglones de una semana en las
 * OT que les corresponden. Lo que habla con la base y con la planilla está en
 * las rutas.
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

// ── Las horas de cada renglón ───────────────────────────────

export interface RenglonConHoras {
  actividad: string;
  lugar_raw: string;
  /** Las que escribió quien carga el parte, mirando la hoja. */
  horas: number;
}

export type Control =
  | { ok: true; total: number }
  | { ok: false; problemas: string[] };

/**
 * Dos decimales: centésimas de hora, que son treinta y seis segundos.
 *
 * **No se redondea a la media hora ni a la hora**, que sería lo cómodo de
 * leer: 16 h entre 5 renglones dan 3,2 y redondear a 3 o a 3,5 rompe que la
 * quincena cierre contra la factura, que es para lo que existe todo esto.
 */
function redondearHoras(h: number): number {
  return Math.round(h * 100) / 100;
}

/**
 * El reparto parejo: lo que la pantalla **propone** al empezar.
 *
 * Es el punto de partida y no la regla. Hasta el 22/10/2026 esto era la
 * verdad —las horas salían de dividir y nadie podía corregirlas—, y eso
 * suponía que todos los frentes llevaron lo mismo: una limpieza de horno que
 * se llevó la mañana entera contaba igual que un bajo cintas de una hora.
 * Ahora las escribe quien tiene la hoja delante, y esto sólo le ahorra
 * tipearlas cuando el reparto sí fue parejo, que es la mayoría de las veces.
 *
 * **Lo que no divide justo lo carga el último renglón.** No es cosmética: el
 * control exige que los renglones den el total escrito, así que una propuesta
 * que arranca a centésimas de cerrar obligaría a corregir a mano algo que
 * nadie midió mal. 16 h entre 3 dan 5,33 + 5,33 + 5,34.
 */
export function repartoParejo(total: number, cantidad: number): number[] {
  if (!Number.isFinite(total) || total <= 0) return [];
  if (!Number.isInteger(cantidad) || cantidad <= 0) return [];
  if (cantidad === 1) return [redondearHoras(total)];

  const cada = redondearHoras(total / cantidad);
  const partes = Array.from({ length: cantidad - 1 }, () => cada);
  partes.push(redondearHoras(total - cada * (cantidad - 1)));
  return partes;
}

/**
 * Las horas que tiene que mostrar el formulario después de un cambio.
 *
 * `aMano` es si alguien ya corrigió alguna hora. **Mientras está en false la
 * propuesta se vuelve a aplicar sola** —al tipear el total, al agregar o al
 * quitar un renglón—, que es lo que ahorra tipear cinco veces 3,6. **Apenas
 * se corrige una, no vuelve a pisar nada**: un renglón agregado después entra
 * en blanco y lo acomoda quien carga.
 *
 * Vive acá y no en la pantalla porque una pantalla no se puede probar, y ésta
 * es exactamente la regla que falla en silencio: un reparto que pisa una
 * corrección no avisa de nada — la hora queda cambiada, el parte cierra igual
 * contra el total del papel, y las horas se van al sector equivocado.
 *
 * Las horas van y vuelven como texto porque el campo puede estar a medio
 * escribir, y un "" no es un 0.
 */
export function horasTrasUnCambio(
  horasActuales: readonly string[],
  total: string | number,
  aMano: boolean
): string[] {
  if (aMano) return [...horasActuales];
  const partes = repartoParejo(Number(total), horasActuales.length);
  if (partes.length !== horasActuales.length) return horasActuales.map(() => "");
  return partes.map(String);
}

/**
 * Que las horas escritas a mano cierren contra el total del papel.
 *
 * **Éste es el control de la factura**, que es para lo que existe todo esto:
 * lo que el sistema suma tiene que dar lo que Candia escribió en la casilla
 * "HORAS". Si no da, el parte no se guarda — sin esta comprobación esto sería
 * sólo transcribir.
 *
 * **Todo renglón lleva horas.** Un renglón en cero aparecería en el parte sin
 * generar horas ni OT; se pidió que no exista. Si el frente se trabajó lleva
 * horas, y si no se trabajó no es un renglón del parte.
 *
 * **Se niega con todos los problemas juntos**, que es la vara de `validar()`
 * del núcleo: quien tiene el papel delante quiere saber todo lo que no cierra
 * de una sola vez, no descubrirlo de a uno.
 */
export function controlarHoras(
  renglones: readonly RenglonConHoras[],
  horasDeclaradas: number
): Control {
  const problemas: string[] = [];

  if (!Number.isFinite(horasDeclaradas) || horasDeclaradas <= 0) {
    problemas.push(
      "Falta el total de horas que dice el papel: es contra ese número que tiene que cerrar el parte."
    );
  }

  if (renglones.length === 0) {
    problemas.push("El detalle del trabajo está vacío: un parte sin renglones no dice qué se hizo.");
  }

  for (const [i, r] of renglones.entries()) {
    if (!Number.isFinite(r.horas) || r.horas <= 0) {
      const lugar = String(r.lugar_raw ?? "").trim();
      problemas.push(
        `El renglón ${i + 1}${lugar ? ` («${lugar}»)` : ""} no tiene horas. ` +
        `Todo renglón del parte lleva las suyas.`
      );
    }
  }

  // Las horas que no son un número cuentan como cero y no como NaN: lo que
  // tiene que leer quien carga es «faltan 18 h», no «faltan NaN h». El renglón
  // ya quedó denunciado arriba, y los dos mensajes se muestran juntos.
  const suma = redondearHoras(
    renglones.reduce((s, r) => s + (Number.isFinite(r.horas) ? r.horas : 0), 0)
  );
  const total = redondearHoras(horasDeclaradas);

  if (Number.isFinite(total) && suma !== total) {
    const diferencia = redondearHoras(Math.abs(total - suma));
    problemas.push(
      `Los renglones suman ${suma} h y el papel dice ${total} h: ` +
      `${suma < total ? "faltan" : "sobran"} ${diferencia} h. ` +
      `Mientras no cierren, el parte no sirve para controlar la factura.`
    );
  }

  if (problemas.length > 0) return { ok: false, problemas };
  return { ok: true, total: suma };
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

/**
 * El domingo de la semana de una fecha.
 *
 * Hace falta para **estirar el rango que se pide a semanas enteras**, que es lo
 * que impide que una semana cargada en dos tandas termine con dos OT para el
 * mismo sector. Ver `agruparEnOrdenes`.
 */
export function domingoDeLaSemana(fecha: string): string {
  const lunes = lunesDeLaSemana(fecha);
  if (!lunes) return "";
  const d = new Date(`${lunes}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
}

/**
 * Qué hace a una OT una OT: la semana, la actividad y el sector.
 *
 * Está en una función y no repetida en dos lados porque **la clave se calcula
 * dos veces**: una sobre los renglones que todavía no se convirtieron y otra
 * sobre los que ya tienen orden, para saber si hay que crear una OT o sumarle
 * horas a la que ya existe. Si las dos cuentas se separaran, una semana
 * cargada en dos tandas volvería a terminar con dos órdenes del mismo sector.
 */
export function claveDeOT(fecha: string, actividad: string, sectorId: string): string {
  return `${lunesDeLaSemana(fecha)}|${normalizarLugar(actividad)}|${sectorId}`;
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
  /**
   * La OT a la que ya fue, si fue.
   *
   * Se agrupan **los convertidos junto con los que no**, que es lo contrario de
   * lo primero que se escribió. Mirando sólo los pendientes, una semana cargada
   * en dos tandas da dos veces la misma clave: el 1301 crea «Limpieza ·
   * Calcinación» de la semana del 28/9, y el 1302 —mismo sector, misma semana—
   * crea otra. El `orden_trabajo_id` impide reconvertir un renglón, no impide
   * una segunda orden con la misma clave.
   *
   * Juntos, el grupo sabe que ya tiene orden y lo que corresponde es **sumarle
   * las horas nuevas**, no crear otra.
   */
  orden_trabajo_id?: string | null;
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
  /** Todos los renglones del grupo, convertidos o no. */
  renglon_ids: string[];
  /** Los que todavía no tienen orden: son los que hay que marcar. */
  renglon_ids_sin_ot: string[];
  /**
   * Las OT que ya tienen los renglones de este grupo.
   *
   * Vacío es «hay que crearla». Una es «hay que sumarle las horas nuevas».
   * **Más de una no debería pasar nunca**, y si pasa no se toca ninguna: se
   * informa. Repartir horas entre dos órdenes que ya existen es inventar.
   */
  ot_existentes: string[];
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
 *
 * **Se le pasan los renglones ya convertidos junto con los pendientes**, y eso
 * no es un detalle: una quincena no se carga de una sentada, así que mirando
 * sólo los pendientes la segunda tanda vuelve a producir la clave que la
 * primera ya convirtió, y se crea una segunda OT para el mismo sector y la
 * misma semana. Juntos, el grupo trae en `ot_existentes` la orden que ya tiene
 * y quien llama sabe que lo que corresponde es sumarle las horas nuevas.
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
    const clave = claveDeOT(r.fecha, actividad, r.sector_id);

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
        renglon_ids_sin_ot: r.orden_trabajo_id ? [] : [r.id],
        ot_existentes: r.orden_trabajo_id ? [r.orden_trabajo_id] : [],
        detalle: [{
          parte_numero: r.parte_numero, fecha: r.fecha,
          lugar_raw: r.lugar_raw, horas: r.horas,
        }],
      });
      continue;
    }

    if (r.orden_trabajo_id) {
      if (!grupo.ot_existentes.includes(r.orden_trabajo_id)) {
        grupo.ot_existentes.push(r.orden_trabajo_id);
      }
    } else {
      grupo.renglon_ids_sin_ot.push(r.id);
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
 * único que permite volver del sistema al papel, y deja dicho **de dónde
 * salen las horas**: las anotó quien cargó el parte, repartiendo el total
 * escrito entre los frentes del día. Eso último no es decoración — en seis
 * meses alguien va a leer "4 h" y va a querer saber quién las contó, y la
 * respuesta no es "las midió un reloj".
 */
export function descripcionDeLaOT(grupo: GrupoDeOT, contratista: string): string {
  const dias = grupo.detalle
    .map((d) => `${d.lugar_raw.trim()} (parte ${d.parte_numero}, ${fechaCorta(d.fecha)}, ${d.horas} h)`)
    .join("; ");

  return (
    `${grupo.actividad} — ${contratista}. Semana del ${fechaCorta(grupo.semana)}. ` +
    `${grupo.horas} h en total. Según los partes diarios: ${dias}. ` +
    `Las horas de cada renglón las anotó quien cargó el parte repartiendo el ` +
    `total escrito en la hoja, así que no son una medición por frente de trabajo.`
  );
}

/** "2026-10-01" → "1/10". El día y el mes, que es como se nombra una fecha acá. */
function fechaCorta(fecha: string): string {
  const [, mes, dia] = fecha.split("-");
  return mes && dia ? `${Number(dia)}/${Number(mes)}` : fecha;
}
