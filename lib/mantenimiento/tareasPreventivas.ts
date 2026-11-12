/**
 * El catálogo de tareas preventivas, sacado de lo que ya se hace.
 *
 * ── EL PROBLEMA, MEDIDO EL 12/11/2026 ──────────────────────────────────────
 *
 * El motor de planes periódicos existe desde el 29/10/2026 y tiene **un solo
 * plan cargado**. Mientras tanto, de las 2.428 OT del último año **1.455 son
 * PROGRAMADO (59,9 %)**: el preventivo se hace, y en volumen, pero se escribe
 * una orden por vez en lugar de generarse.
 *
 * Y no se puede deducir el plan del historial tal como está: de 1.344
 * programadas con equipo hay **1.222 descripciones distintas**, y sólo 17
 * grupos repiten tres veces o más. El texto libre las parte — «regulacion de
 * pendulos» 18 veces y «se regulan pendulos» otras 5 son el mismo trabajo.
 *
 * ── LO QUE SÍ HAY DEBAJO ───────────────────────────────────────────────────
 *
 * Una tarea es **una acción sobre un componente**, y con eso el texto se
 * ordena solo. Medido sobre las 1.344: se le reconoce la acción al **76 %**, y
 * acción + componente al **43 %**. Los pares son **100 distintos**, y la curva
 * es la de un catálogo de verdad y no la de un texto libre:
 *
 *    13 pares cubren el 51 % · 35 cubren el 76 % · 60 cubren el 90 %
 *
 * Arriba de todo: rotación de martillos 74 veces, regulación de péndulos 31,
 * cambio de martillos 25, cambio de grillas 24.
 *
 * ── POR QUÉ EL COMPONENTE NO ES UN VOCABULARIO NUEVO ───────────────────────
 *
 * Porque ya existe: `equipos_componentes` tiene **398 filas con 43 nombres**
 * curados —«Martillos», «Tensor de cinta», «Cangilones», «Banda / cadena
 * elevadora»— y cada una colgada de su equipo. Inventar una segunda lista de
 * objetos sería la forma exacta en que se separan dos catálogos del mismo
 * dominio. Lo único que este archivo agrega es **la acción**, que no estaba en
 * ninguna parte.
 *
 * Esos nombres traen sinónimos separados por barra, y eso es a propósito en el
 * catálogo: «Raspador / limpiador cinta» se busca por las dos puntas.
 *
 * ── LO QUE ESTO NO HACE ────────────────────────────────────────────────────
 *
 * **No crea planes y no escribe nada.** Propone un catálogo a partir del
 * historial para que una persona lo confirme; cada propuesta viaja con cuántas
 * veces se hizo, en qué equipos y cada cuántos días, que es lo que hace falta
 * para decidir el período de un plan. Quién tiene que hacer qué y cada cuánto
 * es conocimiento de planta, y de un promedio no sale.
 *
 * **No clasifica de nuevo las OT.** Una orden cargada como PROGRAMADO que en
 * realidad fue una reparación sigue siendo PROGRAMADO; lo único que se hace es
 * no contarla como preventiva —ver `ACCIONES_CORRECTIVAS`—.
 */

/** Una entrada de vocabulario, con la misma forma que las de `fallas.ts`. */
export interface Accion {
  clave: string;
  etiqueta: string;
  /** Cómo se nombra adentro de una frase: "rotación de martillos". */
  corta: string;
  /** Las formas en que la planilla la escribe. */
  reconoce: RegExp;
}

/**
 * Las acciones que son mantenimiento preventivo.
 *
 * Salen de las 1.344 programadas y no de una norma: son las seis formas en que
 * esta planta escribe que fue a atender una máquina **antes** de que se
 * rompiera. El orden importa, porque la primera que reconoce gana: `ROTACION`
 * va antes que `CAMBIO` porque «se rotan y se cambian martillos» es una
 * rotación, y `LUBRICACION` antes que `CAMBIO` porque «cambio de aceite» es
 * lubricar y no reemplazar una pieza.
 */
export const ACCIONES_PREVENTIVAS: readonly Accion[] = [
  {
    clave: "LUBRICACION", etiqueta: "Lubricación / engrase", corta: "lubricación de",
    reconoce: /\b(lubric\w*|engras\w*|aceita\w*|grasa|aceite)\b/,
  },
  {
    clave: "ROTACION", etiqueta: "Rotación de piezas", corta: "rotación de",
    reconoce: /\b(rotacion|rotar|rota[rn]?|rotada?s?)\b/,
  },
  {
    clave: "REGULACION", etiqueta: "Regulación / ajuste", corta: "regulación de",
    reconoce: /\b(regulacion|regular|regula[rn]?|ajust\w*|calibr\w*|alinea\w*|tensa\w*|estirar?)\b/,
  },
  {
    clave: "REVISION", etiqueta: "Revisión / inspección", corta: "revisión de",
    reconoce: /\b(revision|revisar|revisa[rn]?|chequ\w*|control\w*|inspec\w*|verific\w*|relev\w*)\b/,
  },
  {
    clave: "LIMPIEZA", etiqueta: "Limpieza", corta: "limpieza de",
    reconoce: /\b(limpieza|limpiar|limpia[rn]?|aspir\w*|barrid\w*|destap\w*)\b/,
  },
  {
    clave: "CAMBIO", etiqueta: "Cambio de pieza de desgaste", corta: "cambio de",
    reconoce: /\b(cambio|cambiar|cambia[rn]?|cambiada?s?|reemplaz\w*|sustitu\w*|renov\w*)\b/,
  },
] as const;

/**
 * Las que aparecen en el mismo campo y **no** son preventivas.
 *
 * Están nombradas y no simplemente ausentes, porque son la mitad de lo que
 * este archivo tiene para decir: medido el 12/11/2026, de las 1.025
 * programadas a las que se les reconoce una acción, **270 son éstas**
 * —reparación 115, montaje o construcción 141, soldadura 14—. Es trabajo
 * correctivo y de mejora cargado como PROGRAMADO.
 *
 * Reconocerlas sirve para dos cosas, y ninguna es reclasificar la orden: que
 * no contaminen el catálogo, y que se pueda decir cuántas son. Un «76 % tiene
 * acción reconocida» sin esta distinción haría creer que hay 1.025 tareas
 * preventivas donde hay 755.
 */
export const ACCIONES_CORRECTIVAS: readonly Accion[] = [
  {
    clave: "SOLDADURA", etiqueta: "Soldadura / recargue", corta: "soldadura de",
    reconoce: /\b(suelda|soldar|soldadu\w*|soldada?s?|recarg\w*)\b/,
  },
  {
    clave: "REPARACION", etiqueta: "Reparación", corta: "reparación de",
    reconoce: /\b(reparacion|reparar|repara[rn]?|reparada?s?|arregl\w*)\b/,
  },
  {
    clave: "MONTAJE", etiqueta: "Montaje / obra nueva", corta: "montaje de",
    reconoce: /\b(coloca\w*|instal\w*|montaje|montar|arma[rn]?|armado|fabric\w*|construc\w*|construir)\b/,
  },
] as const;

/**
 * El texto de una descripción, comparable.
 *
 * Sin acentos y sin puntuación, por lo mismo que en el resto del módulo: la
 * planilla la tipean doce personas distintas. La ñ **no** necesita el cuidado
 * que sí necesita `normalizarLugar` en los partes de contratista, porque acá
 * se descompone y se tira el diacrítico igual que en cualquier vocal: no hay
 * ninguna palabra del vocabulario que dependa de ella.
 */
export function normalizar(texto: string | null | undefined): string {
  return String(texto ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Qué acción nombra una descripción, preventiva o no.
 *
 * Devuelve la **primera** del vocabulario que reconozca, y por eso el orden de
 * las listas es parte del significado. Las preventivas se miran antes que las
 * correctivas: «se cambian y se sueldan grillas» es un cambio de pieza de
 * desgaste al que además hubo que soldarle algo, no una soldadura.
 */
export function accionDe(
  descripcion: string | null | undefined
): { accion: Accion; esPreventiva: boolean } | null {
  const texto = normalizar(descripcion);
  if (!texto) return null;

  const preventiva = ACCIONES_PREVENTIVAS.find((a) => a.reconoce.test(texto));
  if (preventiva) return { accion: preventiva, esPreventiva: true };

  const correctiva = ACCIONES_CORRECTIVAS.find((a) => a.reconoce.test(texto));
  return correctiva ? { accion: correctiva, esPreventiva: false } : null;
}

/**
 * Los nombres por los que se puede reconocer un componente del catálogo.
 *
 * «Raspador / limpiador cinta» son dos nombres y no uno: la barra separa
 * sinónimos a propósito en `equipos_componentes`, y buscar la cadena entera
 * no encontraría nunca una descripción que diga sólo «raspador».
 *
 * Los de **menos de cuatro letras se descartan**: con «eje» o «pin» sueltos,
 * cualquier descripción que los contenga como parte de otra palabra engancha,
 * y un componente mal reconocido es peor que ninguno — es la regla de la casa
 * sobre enlazar al que se le parece.
 */
export function nombresDe(componente: string): string[] {
  return componente
    .split("/")
    .map((parte) => normalizar(parte))
    .filter((parte) => parte.length >= 4);
}

/**
 * Qué componente del catálogo nombra una descripción.
 *
 * Gana **el nombre más largo** que aparezca, no el primero: «banda» y «banda
 * cadena elevadora» pueden reconocer el mismo texto, y el que más dice es el
 * que más information tiene. Con empate gana el que viene antes en el
 * catálogo, que lo vuelve determinista.
 */
export function componenteDe(
  descripcion: string | null | undefined,
  componentes: readonly string[]
): string | null {
  const texto = normalizar(descripcion);
  if (!texto) return null;

  let mejor: string | null = null;
  let largo = 0;

  for (const componente of componentes) {
    for (const nombre of nombresDe(componente)) {
      if (nombre.length > largo && texto.includes(nombre)) {
        mejor = componente;
        largo = nombre.length;
      }
    }
  }

  return mejor;
}

/** Una orden como la necesita el conteo. */
export interface OrdenPreventiva {
  ot_number: number;
  descripcion: string | null;
  equipment_id: string | null;
  fecha_ejecucion: string | null;
}

export interface TareaPropuesta {
  accion: string;
  componente: string;
  /** Cuántas órdenes del historial caen en esta tarea. */
  veces: number;
  /** Los equipos donde se hizo, del que más veces al que menos. */
  equipos: { equipmentId: string; veces: number; intervaloTipico: number | null }[];
}

export interface CatalogoPropuesto {
  tareas: TareaPropuesta[];
  /** Las cuentas que dicen sobre qué parte del historial se construyó. */
  cobertura: {
    ordenes: number;
    conAccionPreventiva: number;
    conAccionCorrectiva: number;
    sinAccion: number;
    /** Preventivas a las que además se les reconoce el componente. */
    enElCatalogo: number;
  };
}

const MS_POR_DIA = 86_400_000;
const numeroDeDia = (fecha: string): number => {
  const [a, m, d] = fecha.split("-").map(Number);
  return Date.UTC(a, m - 1, d) / MS_POR_DIA;
};

/**
 * Cada cuántos días se repite, o null si no alcanza para decirlo.
 *
 * **La mediana y no el promedio**: una tarea que se hizo cuatro veces en
 * marzo y una vez en octubre tiene un promedio que no describe ninguno de los
 * dos ritmos, y el período de un plan sale de lo que pasa habitualmente. Con
 * menos de tres fechas no hay dos intervalos que comparar y no se opina: una
 * sola distancia entre dos fechas puede ser cualquier cosa.
 */
export function intervaloTipico(fechas: readonly string[]): number | null {
  const dias = [...new Set(fechas)].sort().map(numeroDeDia);
  if (dias.length < 3) return null;

  const huecos: number[] = [];
  for (let i = 1; i < dias.length; i++) huecos.push(dias[i] - dias[i - 1]);
  huecos.sort((a, b) => a - b);

  const medio = Math.floor(huecos.length / 2);
  return huecos.length % 2 === 1
    ? huecos[medio]
    : Math.round((huecos[medio - 1] + huecos[medio]) / 2);
}

/**
 * El catálogo que propone el historial.
 *
 * Las tareas salen ordenadas por cuántas veces se hicieron, que es el orden en
 * que conviene confirmarlas: las de arriba son las que más órdenes dejarían de
 * escribirse a mano.
 */
export function catalogoPropuesto(
  ordenes: readonly OrdenPreventiva[],
  componentes: readonly string[]
): CatalogoPropuesto {
  const cobertura = {
    ordenes: ordenes.length,
    conAccionPreventiva: 0,
    conAccionCorrectiva: 0,
    sinAccion: 0,
    enElCatalogo: 0,
  };

  // clave "ACCION|componente" → equipo → lo que se hizo ahí.
  //
  // `veces` y `fechas` van separados y no son lo mismo: una orden sin
  // `fecha_ejecucion` cuenta como una vez que la tarea se hizo —existe— pero no
  // puede aportar a un intervalo. Contarlas juntas haría que un equipo con tres
  // órdenes, dos de ellas sin fecha, apareciera con una sola.
  const porTarea = new Map<string, Map<string, { veces: number; fechas: string[] }>>();

  for (const orden of ordenes) {
    const reconocida = accionDe(orden.descripcion);
    if (reconocida === null) {
      cobertura.sinAccion += 1;
      continue;
    }
    if (!reconocida.esPreventiva) {
      cobertura.conAccionCorrectiva += 1;
      continue;
    }
    cobertura.conAccionPreventiva += 1;

    const componente = componenteDe(orden.descripcion, componentes);
    if (componente === null || orden.equipment_id === null) continue;
    cobertura.enElCatalogo += 1;

    const clave = `${reconocida.accion.clave}|${componente}`;
    const equipos = porTarea.get(clave) ?? new Map<string, { veces: number; fechas: string[] }>();
    const suyo = equipos.get(orden.equipment_id) ?? { veces: 0, fechas: [] };
    suyo.veces += 1;
    if (orden.fecha_ejecucion) suyo.fechas.push(orden.fecha_ejecucion);
    equipos.set(orden.equipment_id, suyo);
    porTarea.set(clave, equipos);
  }

  const tareas: TareaPropuesta[] = [...porTarea.entries()].map(([clave, equipos]) => {
    const [accion, componente] = clave.split("|");
    const deCadaEquipo = [...equipos.entries()]
      .map(([equipmentId, suyo]) => ({
        equipmentId,
        veces: suyo.veces,
        intervaloTipico: intervaloTipico(suyo.fechas),
      }))
      .sort((a, b) => b.veces - a.veces || a.equipmentId.localeCompare(b.equipmentId));

    return {
      accion,
      componente,
      veces: deCadaEquipo.reduce((a, e) => a + e.veces, 0),
      equipos: deCadaEquipo,
    };
  });

  tareas.sort(
    (a, b) =>
      b.veces - a.veces ||
      a.accion.localeCompare(b.accion) ||
      a.componente.localeCompare(b.componente)
  );

  return { tareas, cobertura };
}

/** Cómo se lee una tarea: "rotación de Martillos". */
export function comoSeLee(accion: string, componente: string): string {
  const todas = [...ACCIONES_PREVENTIVAS, ...ACCIONES_CORRECTIVAS];
  const corta = todas.find((a) => a.clave === accion)?.corta ?? accion.toLowerCase();
  return `${corta} ${componente}`;
}

/**
 * Las palabras que piden un componente que el catálogo no tiene.
 *
 * ── POR QUÉ HIZO FALTA ─────────────────────────────────────────────────────
 *
 * El diseño arrancó dando por sentado que el objeto de una tarea ya estaba
 * resuelto: `equipos_componentes` tiene 43 nombres curados, así que alcanzaba
 * con agregarle la acción. **La primera corrida contra los datos lo
 * desmintió**: de 1.465 programadas, sólo **156 (11 %)** llegan a acción +
 * componente, y quedan **634 preventivas reconocidas sin componente**.
 *
 * El motivo es que las dos listas hablan idiomas distintos. El catálogo nombra
 * piezas de relevamiento —«Raspador / limpiador cinta», «Masa excéntrica»,
 * «Membrana / lona porosa»— y las órdenes nombran lo que se toca ese día:
 * péndulos, grillas, rodamientos, correas. Ninguna de esas cuatro existe como
 * componente, y son el segundo, tercero y cuarto objeto más frecuente de todo
 * el preventivo.
 *
 * ── POR QUÉ NO SE RESUELVE INVENTANDO LA LISTA ─────────────────────────────
 *
 * Porque sería exactamente la regla de la casa al revés: un componente que el
 * sistema se inventa no está colgado de ningún equipo, y una tarea enlazada a
 * él aparece en el lugar que no es. Lo que esto hace es **decir qué falta**
 * para que alguien de planta lo agregue al catálogo, que es donde tiene que
 * estar.
 *
 * ── LOS DOS FILTROS, Y POR QUÉ EL SEGUNDO NO ES OBVIO ──────────────────────
 *
 * Se sacan las palabras de las propias acciones —«limpieza» aparece 211 veces
 * y no es un componente, es el verbo— y **las que nombran un equipo**. Esto
 * último es lo que separa una lista útil de una lista de ruido: «rompedora»
 * 36 veces, «molino» 27, «elevador» 30, «cinta» 32 son máquinas, y la máquina
 * ya viaja en `equipment_id`. Una descripción que dice «revisión de elevador»
 * no está nombrando un componente que falta: está repitiendo el equipo.
 */
export function candidatasAComponente(
  ordenes: readonly OrdenPreventiva[],
  componentes: readonly string[],
  nombresDeEquipos: readonly string[]
): { palabra: string; veces: number }[] {
  // Una palabra es "del vocabulario" si alguna acción **la reconoce a ella
  // sola**, y no si aparece en su etiqueta. Es la diferencia entre filtrar
  // «limpieza» y filtrar también «regulan», «rotada» o «chequear»: la planilla
  // escribe las formas conjugadas, no los sustantivos del vocabulario, y una
  // lista de etiquetas las deja pasar a todas.
  const todasLasAcciones = [...ACCIONES_PREVENTIVAS, ...ACCIONES_CORRECTIVAS];
  const esUnaAccion = (palabra: string) => todasLasAcciones.some((a) => a.reconoce.test(palabra));
  const deLosEquipos = new Set<string>();
  for (const nombre of nombresDeEquipos) {
    for (const p of normalizar(nombre).split(" ")) if (p.length >= 4) deLosEquipos.add(p);
  }
  const yaEnElCatalogo = new Set<string>();
  for (const componente of componentes) {
    for (const nombre of nombresDe(componente)) {
      for (const p of nombre.split(" ")) yaEnElCatalogo.add(p);
    }
  }

  const cuenta = new Map<string, number>();
  for (const orden of ordenes) {
    const reconocida = accionDe(orden.descripcion);
    if (reconocida === null || !reconocida.esPreventiva) continue;
    if (componenteDe(orden.descripcion, componentes) !== null) continue;

    // Una palabra por orden: una descripción que repite «rodamiento» tres
    // veces no es tres pedidos de ese componente.
    for (const palabra of new Set(normalizar(orden.descripcion).split(" "))) {
      if (palabra.length < 4) continue;
      if (/^[0-9]+$/.test(palabra)) continue;
      if (VACIAS.has(palabra)) continue;
      if (esUnaAccion(palabra)) continue;
      if (deLosEquipos.has(palabra)) continue;
      if (yaEnElCatalogo.has(palabra)) continue;
      cuenta.set(palabra, (cuenta.get(palabra) ?? 0) + 1);
    }
  }

  return [...cuenta.entries()]
    .map(([palabra, veces]) => ({ palabra, veces }))
    .sort((a, b) => b.veces - a.veces || a.palabra.localeCompare(b.palabra));
}

/**
 * Las palabras que no nombran nada: artículos, preposiciones y los verbos de
 * trámite que aparecen en cualquier descripción.
 *
 * Es una lista corta a propósito. No es un diccionario de español: son las que
 * se vieron de verdad en las 1.465 descripciones, y crece sólo cuando alguien
 * mira la salida y encuentra una que sobra.
 */
const VACIAS = new Set(
  ("de del la el los las en y o se un una por con para que al es son esta este ese " +
   "mas menos no ni dos tres toda todo todos todas parte nuevo nueva general " +
   "planta sector hacer realizar poner dar sobre entre desde hasta donde cuando " +
   "trabajo trabajos orden tarea estado")
    .split(" ")
);
