import { z } from "zod";

/**
 * Lo que se le pide al modelo que lea de la foto del cuaderno de PIPARO, y
 * cómo lo que contesta se vuelve un renglón del sistema.
 *
 * Este archivo es el contrato y la traducción, y es puro: no llama a ningún
 * modelo. La ruta lo usa con `generateObject` (esquema + prompt) y le pasa a
 * `normalizarRenglones` lo que vuelve.
 *
 * POR QUÉ `valor` + `unidad` Y NO `horas` + `costo`
 *
 * El papel escribe **un solo número** a la derecha del renglón —«= 8 Hs»,
 * «= 920000», «= 4»— y lo que cambia de uno a otro es la unidad, que a veces
 * ni está. Pedirle al modelo dos campos lo invita a llenar el que no vio: ante
 * un «= 4» sin unidad tendría que elegir entre `horas: 4` y `costo: 4`, y
 * elegiría sin avisar. Con un valor y una unidad que puede ser `null`, el
 * hueco del papel es un hueco en la respuesta, y es el código —no el modelo—
 * el que decide qué hacer con él (horas, y dudoso).
 *
 * EL LÍMITE QUE QUEDA, Y QUE NINGÚN TEST PUEDE CUBRIR
 *
 * Si el papel trajera horas **y** precio en el mismo renglón, el modelo
 * elegiría uno de los dos y el sistema no tiene cómo enterarse: con un solo
 * número por renglón, el otro se pierde antes de llegar acá. No hay test
 * posible porque no hay entrada que lo represente. En las diez hojas medidas
 * ese renglón no existe —los de precio nunca traen horas—, pero si aparece, es
 * por acá que se pierde. Pedir `horas` y `costo` sueltos no lo arregla:
 * `generateObject` descarta con zod las claves que el esquema no declara, así
 * que no llegarían a `normalizarRenglones` por el camino real.
 *
 * NADA SE TIRA EN SILENCIO
 *
 * Un renglón que no se entiende entra marcado `dudoso` con su motivo, y lo que
 * no puede entrar queda dicho en `problemas`. Y cuando el modelo devuelve algo
 * que no valida, `problemas` lleva **lo que dijo zod y lo que dijo el modelo,
 * sin traducir ni resumir**: es la regla de las escrituras a Sheets aplicada
 * acá, porque un diagnóstico que no se distingue de otro no es un diagnóstico.
 */

/** Un renglón tal como se lo pedimos al modelo. */
const renglonPedido = z.object({
  fecha: z.string().nullish().describe(
    "Día de la hoja al que pertenece el renglón, en formato AAAA-MM-DD. null si no se puede leer."
  ),
  tarea: z.string().describe("La tarea, tal como está escrita. Si el renglón trae comillas, ya completada con el renglón de arriba."),
  lugar: z.string().nullish().describe(
    "El lugar tal como está escrito en el papel («P/Trit N°3», «Molino cal», «D6»), sin traducir ni interpretar. Vacío si no dice."
  ),
  valor: z.number().nullish().describe("El número de la derecha del renglón, tal cual. null si no hay."),
  unidad: z.enum(["horas", "pesos"]).nullish().describe(
    "Qué es ese número: «horas» si dice Hs o H, «pesos» si es un importe. null si el papel no lo dice."
  ),
  linea: z.number().nullish().describe("Número de línea del renglón en la hoja, contando desde 1 de arriba abajo."),
  heredado: z.boolean().nullish().describe("true si el renglón traía comillas y se completó con el de arriba."),
  en_llave: z.boolean().nullish().describe("true si el renglón está dentro de una llave que junta varios con un solo total."),
  dudoso: z.boolean().nullish().describe("true si no estás seguro de haberlo leído bien."),
  motivo_dudoso: z.string().nullish().describe("Por qué dudás, en pocas palabras."),
});

/** Lo que se le pide al modelo: la lista de renglones de la foto. */
export const esquemaDeLaLectura = z.object({
  renglones: z.array(renglonPedido).describe("Todos los renglones de la hoja, en el orden en que están escritos."),
});

/** Un renglón del cuaderno ya traducido a lo que guarda el sistema. */
export type RenglonLeido = {
  fecha: string | null;
  tarea: string;
  /** El lugar como está escrito en el papel. El enganche a sector y equipo es de otro paso. */
  lugar_raw: string;
  horas: number | null;
  costo: number | null;
  /** Número de línea en la hoja, para poder volver del renglón a la foto. */
  linea: number | null;
  heredado: boolean;
  en_llave: boolean;
  dudoso: boolean;
  motivo_dudoso: string | null;
};

/** Tope de lo que se transcribe de la respuesta del modelo en un problema. */
const TOPE_DE_LO_QUE_DIJO = 2000;

/** Lo que dijo el modelo, para citarlo tal cual. */
function loQueDijo(crudo: unknown): string {
  let texto: string;
  if (typeof crudo === "string") texto = crudo;
  else {
    try { texto = JSON.stringify(crudo) ?? String(crudo); } catch { texto = String(crudo); }
  }
  return texto.length > TOPE_DE_LO_QUE_DIJO
    ? `${texto.slice(0, TOPE_DE_LO_QUE_DIJO)}… (se cortó, eran ${texto.length} caracteres)`
    : texto;
}

/** Lo que dijo zod, sin traducir: ruta y mensaje de cada problema. */
function loQueDijoZod(error: z.ZodError): string {
  return error.issues
    .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
    .join("; ");
}

// ─── La fecha ────────────────────────────────────────────────────────────────

function esDiaReal(a: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  // `Date.UTC` rueda los días que sobran al mes siguiente: si el día no vuelve
  // igual, no existía.
  const f = new Date(Date.UTC(a, m - 1, d));
  return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d;
}

const dos = (n: number) => String(n).padStart(2, "0");

/**
 * Un día real en AAAA-MM-DD, o null. Entiende lo que el modelo devuelve cuando
 * no obedece —«21-09-26», «21/09/2026»— además del ISO que se le pidió. En el
 * papel el año es de dos dígitos, y se completa con el siglo del mes de la
 * carga: el cuaderno es de ese mes, así que ahí está la única pista que hay.
 */
function resolverFecha(texto: string | null | undefined, mes: string): string | null {
  if (!texto) return null;
  const t = texto.trim();
  const siglo = /^(\d{2})\d{2}-\d{2}$/.exec(mes)?.[1];
  const base = siglo ? Number(siglo) * 100 : 2000;

  let a: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  const latina = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(t);
  if (iso) {
    a = Number(iso[1]); m = Number(iso[2]); d = Number(iso[3]);
  } else if (latina) {
    d = Number(latina[1]); m = Number(latina[2]);
    a = latina[3].length === 2 ? base + Number(latina[3]) : Number(latina[3]);
  } else {
    return null;
  }
  return esDiaReal(a, m, d) ? `${a}-${dos(m)}-${dos(d)}` : null;
}

// ─── De la respuesta del modelo a los renglones ──────────────────────────────

const soloLaLista = z.object({ renglones: z.array(z.unknown()) });

/**
 * Traduce lo que contestó el modelo a renglones del sistema.
 *
 * - Si la respuesta no es la lista esperada, **se denuncia entera**: ningún
 *   renglón y un problema con lo que dijo. Es lo que deja esa foto en «falló»
 *   sin frenar las demás.
 * - Si un renglón suelto no valida pero tiene tarea, **entra dudoso** con lo
 *   que dijo el esquema; si no tiene tarea no hay qué guardar, y queda dicho.
 */
export function normalizarRenglones(
  crudo: unknown,
  mes: string
): { renglones: RenglonLeido[]; problemas: string[] } {
  const lista = soloLaLista.safeParse(crudo);
  if (!lista.success) {
    return {
      renglones: [],
      problemas: [
        `La respuesta del modelo no es la lista de renglones esperada (${loQueDijoZod(lista.error)}). El modelo dijo: ${loQueDijo(crudo)}`,
      ],
    };
  }

  const renglones: RenglonLeido[] = [];
  const problemas: string[] = [];

  lista.data.renglones.forEach((item, i) => {
    let r = renglonPedido.safeParse(item);
    // Si el renglón no validó pero tiene tarea, entra con lo que sí se pudo
    // leer y con lo que dijo el que falló: sin `linea` nadie vuelve al papel.
    let formato: string | null = null;

    if (!r.success) {
      const dicho = loQueDijoZod(r.error);
      const tarea = tareaDe(item);
      const donde = `Renglón ${i + 1} de la respuesta`;
      if (!tarea) {
        problemas.push(`${donde} sin tarea y con un formato inesperado (${dicho}). El modelo dijo: ${loQueDijo(item)}`);
        return;
      }
      formato = `formato inesperado (${dicho}). El modelo dijo: ${loQueDijo(item)}`;
      problemas.push(`${donde} con ${formato}. Entra dudoso con lo que sí se pudo leer.`);
      r = renglonPedido.safeParse(rescatable(item));
      if (!r.success) return; // no pasa: la tarea ya se comprobó como texto
    }

    const x = r.data;
    const tarea = x.tarea.trim();
    if (!tarea) {
      const donde = x.linea != null ? `la línea ${x.linea} de la hoja` : `el renglón ${i + 1} de la respuesta`;
      problemas.push(`Se descartó ${donde}: no trae tarea. El modelo dijo: ${loQueDijo(item)}`);
      return;
    }

    const motivos: string[] = formato ? [`El modelo lo devolvió con ${formato}`] : [];
    const enLlave = x.en_llave === true;

    // El número y su unidad. Un blanco dentro de una llave es lo correcto: el
    // total está en otro renglón y repartirlo sería inventar.
    let horas: number | null = null;
    let costo: number | null = null;
    if (x.valor != null) {
      if (x.valor < 0) {
        motivos.push(`El número es negativo (${x.valor}) y no se tomó`);
      } else if (x.unidad === "pesos") {
        costo = x.valor;
      } else {
        horas = x.valor;
        if (x.unidad == null) motivos.push("El número no trae unidad; se tomó como horas");
      }
    }
    // Si el formato falló, el número pudo venir y haberse descartado: ya está
    // dicho en el motivo, y «no trae número» sería falso.
    if (horas == null && costo == null && x.valor == null && !enLlave && !formato) {
      motivos.push("No trae número");
    }

    // La fecha. Imposible o ilegible → null; fuera del mes → se conserva.
    const fecha = resolverFecha(x.fecha, mes);
    if (fecha == null) {
      motivos.push(x.fecha ? `La fecha «${x.fecha}» no es un día real` : "No se pudo leer la fecha");
    } else if (/^\d{4}-\d{2}$/.test(mes) && !fecha.startsWith(`${mes}-`)) {
      motivos.push(`La fecha ${fecha} cae fuera del mes de la carga (${mes})`);
    }

    // Lo que el modelo mismo dijo que no leyó bien.
    if (x.dudoso === true) motivos.push(x.motivo_dudoso?.trim() || "El modelo no está seguro de este renglón");

    renglones.push({
      fecha,
      tarea,
      lugar_raw: (x.lugar ?? "").trim(),
      horas,
      costo,
      linea: x.linea != null && Number.isInteger(x.linea) && x.linea > 0 ? x.linea : null,
      heredado: x.heredado === true,
      en_llave: enLlave,
      dudoso: motivos.length > 0,
      motivo_dudoso: motivos.length > 0 ? motivos.join("; ") : null,
    });
  });

  return { renglones, problemas };
}

/**
 * De un renglón que no validó, los campos que sí validan por separado. Un
 * `linea` que llegó como «11» no debería llevarse con él una fecha y unas
 * horas bien leídas.
 */
function rescatable(item: unknown): Record<string, unknown> {
  const origen = (item ?? {}) as Record<string, unknown>;
  const salvado: Record<string, unknown> = {};
  for (const [campo, esquema] of Object.entries(renglonPedido.shape)) {
    if (campo in origen && (esquema as z.ZodType).safeParse(origen[campo]).success) {
      salvado[campo] = origen[campo];
    }
  }
  // Un número cuya unidad no se pudo leer no se puede usar: sin ella no se sabe
  // si son horas o pesos, y si se lo deja pasa como horas — un importe de
  // 920000 sería una OT de 920.000 horas si alguien confirma sin mirar.
  if ("unidad" in origen && !("unidad" in salvado)) delete salvado.valor;
  return salvado;
}

/** La tarea de un renglón que no validó, si al menos eso se puede rescatar. */
function tareaDe(item: unknown): string {
  if (item === null || typeof item !== "object") return "";
  const t = (item as Record<string, unknown>).tarea;
  return typeof t === "string" ? t.trim() : "";
}

// ─── El prompt ───────────────────────────────────────────────────────────────

/**
 * Lo que se le dice al modelo junto con la foto. Lleva la hoja real del 21 y 22
 * de septiembre de 2026 porque las rarezas del papel se explican mejor con un
 * ejemplo que con una regla, y porque son las que el modelo tiene que saber:
 * ninguna se deduce de mirar una hoja de renglones con importes.
 */
export const PROMPT_DEL_CUADERNO = `Sos quien carga en el sistema el cuaderno manuscrito de PIPARO, un contratista mecánico de una planta de cal y yeso. Te paso la foto de una hoja y devolvés la lista de renglones de trabajo que tiene, uno por cada tarea escrita.

Así se ve una hoja real (transcripta):

Septiembre 26
21-09-26
 - Colocar cartelería P/Trit N°1                     = 8 Hs
 - Reparar rodillos 2/cinta 9 P/Trit N°3             = 6 Hs
 -    "        "     5 P/ "   " 1                    = 6 Hs
 - Trabajos en cinta 1 P/Trit N°1
   probar c/electricistas                            = 14 Hs
 - Tranqueras D6                                     = 2 Hs
 - Limpieza tolva de zaranda P/Trit N°3              = 4 Hs
22-09-26
 - Trabajos en cinta 5 Reparación       ⎫
 - Limpieza P/Trit N°1                  ⎬            = 46 Hs
 - 1 Parche metálico en descarga cono   ⎭
 - 1 Empalme cinta 5 P/Trit N°1                      = 920000
 - Tensar y alinear la misma                         = 4
 - Horno 4 Rastro                                    = 8 Hs

Lo que tenés que saber del papel:

1. Una página trae varios días. El día es un encabezado dentro de la hoja («21-09-26»): todos los renglones que siguen son de ese día hasta el próximo encabezado. Devolvé la fecha de cada renglón como AAAA-MM-DD; el año del papel es de dos dígitos y es del siglo XXI («26» es 2026).

2. El número de la derecha no siempre son horas. «= 920000» son pesos: los empalmes y los parches a veces se cobran por trabajo y no por hora. Devolvelo siempre en dos campos: "valor" con el número tal cual lo escribieron, y "unidad" con "horas" si dice Hs o H, "pesos" si es un importe, o null si el papel no dice qué es («= 4» no dice nada: unidad null). No adivines la unidad: si no está escrita, es null. Y si un renglón no tiene número, valor y unidad van en null.

3. Una llave reúne varios renglones bajo un solo total. En el ejemplo, los tres renglones del 22 comparten «= 46 Hs». Poné el total en el renglón donde lo veas escrito, que puede ser cualquiera de ellos (arriba, en el medio o abajo), dejá valor y unidad en null en los otros, y marcá en_llave en true en todos los de la llave. No repartas el total entre ellos.

4. Las comillas (") repiten lo del renglón de arriba. La línea «"  "  5 P/ " " 1» es «Reparar rodillos 2/cinta 5 P/Trit N°1». Vos ves la hoja entera: completá el renglón y marcá heredado en true para que alguien pueda mirarlo.

5. El lugar va como está escrito, sin traducir ni interpretar: «P/Trit N°3», «Molino cal», «D6». No lo expandas, no lo corrijas, no lo conviertas a ningún código. Si el renglón no nombra un lugar, dejalo vacío; no lo deduzcas de otro renglón salvo que lleve comillas. Del enganche con la planta y el equipo se ocupa otro paso, que tiene el catálogo y vos no.

6. Pedí el número de línea: en "linea" va el número de orden del renglón en la hoja, contando desde 1 de arriba abajo, para poder volver del renglón al papel. Un renglón que ocupa dos líneas de papel («Trabajos en cinta 1 P/Trit N°1 / probar c/electricistas») es uno solo.

Cuando algo no se lee bien —una palabra tachada, un número dudoso— no lo inventes ni lo saltees: devolvé el renglón con lo que sí leíste, poné dudoso en true y en motivo_dudoso decí en pocas palabras qué no se entiende. Los encabezados («Septiembre 26»), los subtotales y los garabatos que no son una tarea no son renglones. Si la foto no es una hoja del cuaderno, devolvé la lista vacía.`;
