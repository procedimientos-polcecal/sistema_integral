/**
 * Cuándo sospechar que alguien cambió los martillos sin avisarle al ciclo.
 *
 * ── LA ÚNICA PARTE QUE MIRA EL TEXTO, Y POR QUÉ SE PUEDE ───────────────────
 *
 * Todo el mecanismo de los ciclos encadenados se enlaza por **id** y nunca por
 * la descripción: eso es lo que permite que «se puso juego nuevo» no pueda
 * romper nada. Acá se mira el texto, y la diferencia es que **el texto no
 * decide: pregunta**.
 *
 * Un falso positivo cuesta una pregunta. Uno que no detecta deja todo como
 * estaba. Ninguno de los dos reinicia un ciclo ni crea una orden. Es la regla
 * de la casa —enlazar al que se le parece es peor que dejar en null— aplicada
 * por el lado en que sí se puede: avisar.
 *
 * Existe porque el botón «Se cambiaron los martillos» depende de que alguien se
 * acuerde de apretarlo, y el día que no se acuerde el ciclo manda a rotar a 3ª
 * cara un juego que está en la 1ª.
 *
 * ── EL CORTE POR `desde` NO ES RENDIMIENTO: ES LO QUE LO APAGA ─────────────
 *
 * Sólo se mira lo cerrado **después** del último trabajo conocido del ciclo.
 * Sin ese corte este aviso contaría un hecho histórico que nunca cambia, y en
 * este sistema eso termina de una de dos formas y las dos son malas:
 * `filtrarDescartadas` sólo vuelve a mostrar un aviso cuando su cantidad
 * **crece**, así que un conteo que nunca baja es un globo permanente, y
 * descartarlo una vez lo silencia para siempre.
 *
 * Medido el 12/11/2026 sobre los cuatro equipos del ciclo: las 250 OT de
 * martillos están todas en REALIZADO y un regex deliberadamente angosto toca
 * **56**. O sea que sin corte el día uno este aviso sale con 56, por la campana
 * y por el push, para todo el que vea Mantenimiento.
 *
 * Con el corte: un ciclo sin arrancar no sospecha nada, y cada vez que el ciclo
 * avanza —su madre que se cierra, o el botón— `desde` se mueve y lo viejo cae
 * solo. El conteo real queda en 0 ó 1.
 */

const sinAcentos = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Los verbos con los que esta planta escribe que puso piezas nuevas. */
const PONER = "(cambi\\w*|reemplaz\\w*|recambi\\w*|coloca\\w*|pone\\w*|instal\\w*)";
/** Y los que escribe cuando sólo las giró. */
const ROTAR = "(rota\\w*|rotacion|gira\\w*|giro|voltea\\w*)";

/**
 * Si el texto dice que **a este componente** lo cambiaron.
 *
 * Primero descarta las rotaciones de ese mismo componente, y eso es lo que
 * separa esta función de un `includes("cambio")`: la forma más común del
 * historial es «Rotación de martillos **y cambio de grillas**», que habla de un
 * cambio y de los martillos y no es un cambio de martillos. De las 248 OT
 * medidas, ésa y sus variantes son 71.
 */
export function pareceUnCambio(descripcion: unknown, componente: string): boolean {
  const t = sinAcentos(String(descripcion ?? ""));
  if (!t) return false;

  const pieza = sinAcentos(componente).replace(/s$/, "");
  const cerca = `${pieza}s?`;

  // «se rotan martillos», «rotación de martillos», «martillos a 2da cara».
  const esRotacion =
    new RegExp(`${ROTAR}\\s+(de\\s+|los\\s+|las\\s+)*${cerca}`).test(t) ||
    new RegExp(`${cerca}\\s+a\\s+\\d*\\s*(ra|da|ta|va|ma)?\\s*cara`).test(t);
  if (esRotacion) return false;

  const pegadoAlVerbo =
    new RegExp(`${PONER}\\s+(de\\s+|los\\s+|las\\s+|\\d+\\s+)*${cerca}`).test(t);

  // ── La coordinación, que la calibración encontró ──────────────────────────
  //
  // «Cambio de brazos **y martillos**» y «Cambio de grillas **y martillos**
  // recuperados» son cambios de martillos, y el patrón de arriba no los ve
  // porque entre el verbo y la pieza hay otra pieza. Son 2 de los 67 cambios
  // reales medidos el 12/11/2026 sobre las 250 OT de los cuatro equipos.
  //
  // Se pide la `y` **pegada al componente** y no un hueco de n palabras, y ahí
  // está todo el cuidado: «Cambio de correas a rompedora **de** martillos» no
  // es un cambio de martillos sino el nombre de la máquina, y con un hueco
  // suelto entraría. La `y` separa una enumeración de piezas; la `de` arma el
  // nombre del equipo.
  const enUnaEnumeracion =
    new RegExp(PONER).test(t) && new RegExp(`\\sy\\s+(los\\s+|las\\s+)*${cerca}\\b`).test(t);

  return pegadoAlVerbo || enUnaEnumeracion || new RegExp(`${cerca}\\s+nuevos?`).test(t);
}

export interface CicloVigilado {
  id: string;
  equipment_id: string;
  /** El código del equipo, para que el aviso pueda nombrarlo. */
  equipo: string;
  desde: string | null;
  componente: string;
}

export interface CerradaParaMirar {
  ot_number: number;
  equipment_id: string | null;
  descripcion: string | null;
  fecha_cierre: string | null;
  /** Si es del propio ciclo, no es sospechosa: la generó él. */
  ciclo_id: string | null;
}

export interface Sospecha {
  ciclo_id: string;
  equipment_id: string;
  equipo: string;
  /** Para que el aviso pueda nombrarla: este mecanismo no es sólo de martillos. */
  componente: string;
  ot: number[];
}

/** Un elemento por ciclo con al menos una sospecha. Los demás no aparecen. */
export function sospechasDeCambio(
  ciclos: readonly CicloVigilado[],
  cerradas: readonly CerradaParaMirar[]
): Sospecha[] {
  const sospechas: Sospecha[] = [];

  for (const ciclo of ciclos) {
    if (!ciclo.desde) continue;

    const ot = cerradas
      .filter(
        (c) =>
          c.equipment_id === ciclo.equipment_id &&
          c.ciclo_id === null &&
          !!c.fecha_cierre &&
          c.fecha_cierre > ciclo.desde! &&
          pareceUnCambio(c.descripcion, ciclo.componente)
      )
      .map((c) => c.ot_number)
      .sort((a, b) => a - b);

    if (ot.length > 0) {
      sospechas.push({
        ciclo_id: ciclo.id,
        equipment_id: ciclo.equipment_id,
        equipo: ciclo.equipo,
        componente: ciclo.componente,
        ot,
      });
    }
  }

  return sospechas;
}

export interface CicloSinArrancar {
  id: string;
  equipment_id: string;
  componente: string;
  /** El día desde el cual mirar. Nada anterior cuenta. */
  desdeCuandoMirar: string;
}

/**
 * Con qué cambio arranca un ciclo que todavía no arrancó.
 *
 * ── POR QUÉ ESTO EXISTE, Y POR QUÉ EL TEXTO ACÁ SÍ DECIDE ──────────────────
 *
 * El punto de arranque de un ciclo —desde cuándo son nuevas las piezas— es el
 * único dato del mecanismo que no sale de otro dato. La primera versión lo
 * pedía tipeado, equipo por equipo, y eso tiene un problema conocido: **lo que
 * depende de que alguien se acuerde, no pasa**. Es la misma lección del
 * preventivo —pantalla, botón y cero OT generadas en toda la historia— y un
 * ciclo sin arrancar es invisible: no genera órdenes, así que nada se atrasa y
 * `mant-atrasadas` no puede verlo.
 *
 * Así que acá el texto sí decide, al revés que en todo el resto del mecanismo.
 * Lo que lo vuelve aceptable son tres cosas, y conviene tenerlas juntas:
 *
 *   1. **Decide cuándo arrancar, no qué existe.** El ciclo ya fue configurado
 *      por una persona; esto sólo contesta «¿ya pasó el cambio?».
 *   2. **La orden que nace lo dice**: «Rotación de martillos — a 2ª cara (1 de
 *      3). Martillos cambiados el 20/11/2026». Si esa fecha está mal, quien la
 *      abre lo ve sin tener que confiar en nada.
 *   3. **El botón de la ficha lo corrige** en un clic, y la medición respalda
 *      al matcher: sobre las 250 OT reales de estos equipos marcó 70, todas
 *      cambios de verdad, y lo que no marcó son todas rotaciones.
 *
 * ── Y MIRA HACIA ADELANTE, NUNCA HACIA ATRÁS ──────────────────────────────
 *
 * `desdeCuandoMirar` es la fecha en que se configuró el ciclo, y lo anterior no
 * cuenta. Medido el 13/11/2026: arrancando del último cambio histórico de cada
 * equipo, los cuatro ciclos nacían con su primera rotación **atrasada 7, 21, 21
 * y 3 días**, y Filler 2 —que está en 4ª cara— recibiría una orden de rotar a
 * la 2ª. O sea que mirar hacia atrás produce exactamente lo que este diseño
 * entero existe para evitar.
 */
export function elArranqueDeUnCambio(
  ciclo: CicloSinArrancar,
  cerradas: readonly CerradaParaMirar[]
): { desde: string; ot_number: number } | null {
  const candidatos = cerradas
    .filter(
      (c) =>
        c.equipment_id === ciclo.equipment_id &&
        !!c.fecha_cierre &&
        c.fecha_cierre >= ciclo.desdeCuandoMirar &&
        pareceUnCambio(c.descripcion, ciclo.componente)
    )
    .sort((a, b) => String(a.fecha_cierre).localeCompare(String(b.fecha_cierre)));

  // El más reciente: si hubo dos cambios, el estado de la máquina es el último.
  const ultimo = candidatos.at(-1);
  return ultimo ? { desde: ultimo.fecha_cierre!, ot_number: ultimo.ot_number } : null;
}
