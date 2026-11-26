/**
 * Junta lo que ya está en Drive con lo que trae un origen que NO acumula.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE
 *
 * Todo el subidor se apoya en una propiedad del origen: **los archivos sólo
 * crecen**. El zip de un PC Robot es una foto completa desde febrero, así que
 * el de hoy contiene al de ayer, y de ahí salen dos cosas: que el subidor
 * pueda ser tonto (sin cola, sin reintentos, sin estado) y que un día perdido
 * se cure solo. De esa misma propiedad sale el freno de encogimiento: si el
 * archivo de hoy pesa menos que el que está en Drive, el origen se rompió.
 *
 * La balanza de Portería no cumple esa propiedad, y tardó tres meses en
 * mostrarlo. Sus `DAT000000NN.CSV` son una **ventana corrida**: el software de
 * la balanza los purga cada tanto y vuelve a empezar. Medido el 25/11/2026,
 * con las dos puntas en la mano:
 *
 * - En Drive, `DAT00000010.CSV` iba del 31/8 al 18/11 (353 filas, 21.295 b).
 * - En el servidor, el mismo archivo iba del 20/11 al 24/11 (11 filas, 676 b).
 * - Las filas en común entre los dos: **cero**. Las dos mitades no se pisan,
 *   se continúan. Lo mismo en `DAT00000014.CSV` (110 filas contra 12, cero en
 *   común).
 *
 * O sea que las dos decisiones posibles sin esto eran malas: reemplazar
 * pierde de agosto a noviembre, y no reemplazar —que es lo que el freno venía
 * haciendo bien desde el 19/11— pierde de ahí en adelante. El freno hizo su
 * trabajo: sin él, 21 KB de historia se habrían ido abajo de 676 bytes sin
 * que nadie se enterara. Lo que faltaba no era sacarlo sino darle una salida.
 *
 * Acá está esa salida: Drive guarda la historia completa aunque el origen la
 * tire. Con eso el archivo de Drive vuelve a **sólo crecer**, que es lo que el
 * resto del subidor ya sabía manejar, y el freno sigue cubriendo a los zips.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * LAS TRES COSAS QUE DECIDE, Y POR QUÉ ASÍ
 *
 * 1. **Lo que ya está en Drive se copia tal cual, byte por byte, adelante.**
 *    No se reordena, no se reescribe, no se normaliza. Es deliberado: si esta
 *    función tuviera un error partiendo líneas, el daño quedaría acotado a lo
 *    que se agrega. Lo que ya estaba no se puede perder por un bug de acá.
 *
 * 2. **Se agrega la fila que no está, comparando la línea entera** (sin los
 *    espacios de las puntas), y no por fecha y hora. Comparar por timestamp
 *    sería más barato pero pierde la fila que el origen agregue atrasada, y
 *    acá la fila es una pesada: vale más repetir una que perder una.
 *
 *    El riesgo que esto deja, dicho: dos pesadas idénticas de verdad —mismo
 *    día, mismo minuto, mismo bruto y misma tara al kilo, misma balanza— se
 *    cuentan como una sola y la segunda se pierde. Medido el 25/11/2026 sobre
 *    los dos archivos que había: 463 filas, **0 repetidas**. Por eso la
 *    función devuelve `repetidas`, para que el log lo diga el día que pase en
 *    vez de que se note en un total que no cierra.
 *
 * 3. **El corte de línea es CRLF**, que es el que usan las dos puntas (medido:
 *    0 LF sueltos en los cuatro archivos). No se adivina del contenido para
 *    que un archivo vacío o de una línea no cambie de formato según el día.
 *
 * Las líneas en blanco se ignoran al comparar y no se agregan. El origen pone
 * una después de cada fila en unos archivos y no en otros, y eso no es dato.
 */

const CORTE = "\r\n";

/** Lo que cuenta como la misma fila: la línea sin los espacios de las puntas. */
const clave = (linea) => linea.trim();

/**
 * @param {string} viejo  lo que hoy está en Drive ("" si no está)
 * @param {string} nuevo  lo que trae el origen
 * @returns {{texto: string, agregadas: number, repetidas: number, sinCambios: boolean}}
 */
export function fusionarLineas(viejo, nuevo) {
  const deNuevo = String(nuevo ?? "")
    .split(/\r?\n/)
    .map(clave)
    .filter((l) => l !== "");

  if (!viejo) {
    // Nada en Drive todavía: el origen es la única fuente y se sube entero,
    // tal cual vino. No se reformatea un archivo que nadie tocó.
    return {
      texto: String(nuevo ?? ""),
      agregadas: deNuevo.length,
      repetidas: 0,
      sinCambios: false,
    };
  }

  const yaEstan = new Set(
    viejo
      .split(/\r?\n/)
      .map(clave)
      .filter((l) => l !== "")
  );

  const agregar = [];
  let repetidas = 0;
  for (const linea of deNuevo) {
    if (yaEstan.has(linea)) {
      repetidas++;
      continue;
    }
    yaEstan.add(linea); // el origen podría repetirla dentro del mismo archivo
    agregar.push(linea);
  }

  if (agregar.length === 0) {
    return { texto: viejo, agregadas: 0, repetidas, sinCambios: true };
  }

  const base = viejo.endsWith("\n") ? viejo : viejo + CORTE;
  return {
    texto: base + agregar.join(CORTE) + CORTE,
    agregadas: agregar.length,
    repetidas,
    sinCambios: false,
  };
}
