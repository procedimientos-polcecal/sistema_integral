/**
 * El alta de una OT, escrita en la hoja de respuestas del formulario.
 *
 * ── POR QUÉ ACÁ Y NO EN EL MASTER ───────────────────────────────────────────
 *
 * Hasta el 14/10/2026 la app agregaba la fila en la pestaña `OT` de `ORDEN DE
 * TRABAJO`, y eso no podía funcionar: **las columnas A a J y S de esa pestaña
 * son el derrame de cuatro `QUERY(IMPORTRANGE(...))` del formulario.** Medido
 * celda por celda, de las 2.161 de la columna A **ninguna es un literal**. Un
 * `PUT` ahí sólo puede hacer dos cosas, y las dos son malas: bloquear el
 * derrame —`#REF!`, y se borra la importación entera— o ser pisado cuando el
 * derrame recalcula. Las tres OT que se habían "creado desde la app" estaban en
 * la planilla porque alguien las había cargado **también** por el formulario.
 *
 * Así que el alta va donde el derrame nace: la hoja de respuestas. Es la misma
 * decisión que tomó Compras —ver `lib/compras/formulario.ts`—, con una
 * diferencia: allá las altas viven en una pestaña aparte porque su master no
 * ordenaba; acá conviven en `Respuestas de formulario` con las respuestas del
 * formulario, y lo que las mantiene en su lugar es el `ORDER BY` del master.
 *
 * ── LA PRECONDICIÓN, QUE EL CÓDIGO COMPRUEBA ────────────────────────────────
 *
 * La columna del N° de OT tenía una fórmula por fila:
 * `=IF(B{n}:B<>"",A{n-1}+1,"")`, o sea "el número de arriba más uno". Eso no
 * puede convivir con un segundo escritor: el sistema numera por `max + 1` y la
 * fórmula numera por posición, y **Google Forms inserta** su fila justo después
 * de su propia última respuesta, no al final. La fórmula gana en la fila que
 * Forms inserte encima y los dos quedan con el mismo número.
 *
 * Compras lo vivió el 09/09/2026: dos RI 1954, la sincronización hace `upsert`
 * por número, colapsó los dos en uno y el pedido del formulario desapareció.
 * Acá `ot_number` también es único y la sincronización ya falló una vez por dos
 * filas con el mismo número.
 *
 * Por eso `laSerieEstaCongelada` **no es una sugerencia del documento sino una
 * guarda**: si la columna todavía tiene fórmulas, no se escribe. Una
 * precondición que depende de que alguien se acuerde no es una precondición.
 */

import { serialDelDia, serialDelInstante } from "@/lib/core/fechaDeSheets";
import {
  escribirCeldas, filaSiguienteSegunLaColumna, leerFormulas,
} from "@/lib/core/sheets";

/** La pestaña donde caen las respuestas del formulario. */
export const HOJA_DE_RESPUESTAS = "Respuestas de formulario";

/**
 * La pestaña donde el sistema escribe sus altas, y **sólo él**.
 *
 * Existe desde el 16/10/2026 porque **Google Forms inserta sus respuestas
 * dentro de su propio rango y empuja hacia abajo cualquier fila ajena**. Con
 * las dos conviviendo en `Respuestas de formulario`, la OT 2796 del sistema se
 * corrió dos lugares y su registro —"Realizado, 1 h, dos operarios"— quedó
 * pegado a la 2798, que es de otro: el derrame de los `IMPORTRANGE` del master
 * se movió con ella y las columnas literales no.
 *
 * Acá Forms no entra. Y para que el orden del master no dependa de la posición
 * física, sus cuatro importaciones apilan las dos pestañas con `ORDER BY` por
 * N° de OT — ver el spec `2026-10-16-mantenimiento-altas-del-sistema-design.md`.
 */
export const HOJA_DE_ALTAS = "Altas del sistema";

/**
 * Cómo puede llamarse cada columna que el alta llena.
 *
 * Se busca **por el nombre del encabezado y no por posición**: el formulario
 * puede ganar preguntas, y una pregunta nueva corre todo lo que está a su
 * derecha sin avisar. Es lo mismo que hace el parser del kardex y por lo mismo.
 *
 * `equipo` tiene catorce columnas con el mismo nombre —una por sector— de las
 * que cada respuesta llena exactamente una. Se escribe en **la primera**: al
 * master llegan aplanadas, así que cuál de las catorce sea no cambia nada.
 */
const ALIAS = {
  nro: ["N° OT", "Nº OT", "N OT"],
  marca: ["Marca temporal"],
  email: ["Dirección de correo electrónico", "Direccion de correo electronico"],
  nombre: ["NOMBRE"],
  apellido: ["APELLIDO"],
  sector: ["SECTOR QUE SOLICITA"],
  equipo: ["EQUIPO QUE SOLICITA"],
  especialidad: ["ESPECIALIDAD"],
  tipo: ["TIPO DE TRABAJO"],
  quien: ["QUIÉN LO REALIZA", "QUIEN LO REALIZA"],
  descripcion: ["DESCRIPCIÓN DEL TRABAJO", "DESCRIPCION DEL TRABAJO"],
  repuesto: ["REPUESTO UTILIZADO"],
  fecha: ["FECHA COMPROMETIDA"],
  prioridad: ["PRIORIDAD"],
} as const;

export type Clave = keyof typeof ALIAS;

/**
 * Sin estas la fila no sirve de nada, así que se prefiere no escribir.
 *
 * El N° y la marca temporal porque son lo que la identifica —y la marca es lo
 * que hace que la fila cuente como respuesta—; la descripción porque una OT sin
 * ella no se puede leer en la planilla.
 */
const IMPRESCINDIBLES: readonly Clave[] = ["nro", "marca", "descripcion"];

/** En qué columna está cada cosa. `-1` es que el encabezado no la trae. */
export function indiceDeColumnas(encabezado: readonly string[]): Record<Clave, number> {
  const limpio = encabezado.map((h) => String(h ?? "").trim());
  const idx = {} as Record<Clave, number>;

  for (const [clave, alias] of Object.entries(ALIAS) as [Clave, readonly string[]][]) {
    idx[clave] = -1;
    for (const a of alias) {
      const i = limpio.indexOf(a);
      if (i >= 0) { idx[clave] = i; break; }
    }
  }
  return idx;
}

/**
 * Si la serie dejó de calcularse con una fórmula por fila.
 *
 * Se mira la columna entera tal como vuelve con `valueRenderOption=FORMULA`:
 * una celda que empieza con `=` es una fórmula. Alcanza con que quede una para
 * que escribir sea peligroso, porque la cadena es relativa — cada fila apunta a
 * la de arriba, así que una sola fórmula viva renumera todo lo que tenga debajo
 * en cuanto Forms inserte algo en el medio.
 */
export function laSerieEstaCongelada(columna: readonly (readonly unknown[])[]): boolean {
  for (const fila of columna) {
    if (String(fila?.[0] ?? "").trim().startsWith("=")) return false;
  }
  return true;
}

/**
 * El próximo número de la serie y en qué fila va, de **una sola lectura**.
 *
 * EL INCIDENTE DEL 16/10/2026, que es de donde sale esta función. La OT 2796 se
 * creó desde el sistema y no llegó a la planilla: la guarda se negó a escribir
 * —bien— pero el número ya estaba tomado, porque **salía de una lectura y la
 * fila de otra**, con una escritura en el medio que podía no pasar. Pedir las
 * dos juntas es lo que hace que una negativa no cueste nada.
 *
 * **La serie está repartida entre dos pestañas** desde ese mismo día: el
 * formulario escribe en la suya y el sistema en `Altas del sistema`, para que
 * Forms no pueda empujar las filas del sistema hacia abajo. Por eso el máximo
 * se cuenta sobre las dos: contar una sola es repartir un número que la otra ya
 * usó, que es exactamente lo que se está evitando.
 *
 * La **fila** es la de las altas, que es donde se escribe. La guarda de las
 * fórmulas, en cambio, mira **sólo el formulario**: ahí vive la cadena
 * relativa, y la hoja de altas la escribe el sistema con literales.
 *
 * Es pura para poder probarla: lo que habla con Google es `altaEnLaPlanilla`.
 */
export type LoQueSigue =
  | { ok: true; ot_number: number; fila: number }
  | { ok: false; error: string };

export function loQueSigueEnLaSerie(
  serieDelFormulario: readonly (readonly unknown[])[],
  serieDeLasAltas: readonly (readonly unknown[])[]
): LoQueSigue {
  if (!laSerieEstaCongelada(serieDelFormulario)) {
    return {
      ok: false,
      error:
        `La columna ${COLUMNA_SERIE} de «${HOJA_DE_RESPUESTAS}» todavía numera con una ` +
        `fórmula por fila. Mientras siga así, una OT escrita por el sistema y una ` +
        `respuesta del formulario pueden quedar con el mismo número, así que no se ` +
        `escribe ni se toma número. Hay que pegar esa columna como sólo valores — ver ` +
        `docs/mantenimiento-formulario-apps-script.gs.`,
    };
  }

  return {
    ok: true,
    ot_number: Math.max(
      maximoDeLaSerie(serieDelFormulario),
      maximoDeLaSerie(serieDeLasAltas)
    ) + 1,
    fila: filaSiguienteSegunLaColumna(serieDeLasAltas),
  };
}

/** El número más alto de la serie, que es de donde sale el siguiente. */
export function maximoDeLaSerie(columna: readonly (readonly unknown[])[]): number {
  let maximo = 0;
  for (const fila of columna) {
    const n = Number(String(fila?.[0] ?? "").trim());
    if (Number.isFinite(n) && n > maximo) maximo = n;
  }
  return maximo;
}

/** Lo que el alta necesita saber de la orden. */
export interface DatosDelAlta {
  ot_number: number;
  /** Cuándo se creó. Va como serial, nunca como texto. */
  creado: Date;
  /**
   * Quién la pidió, de su usuario del sistema.
   *
   * Estas tres columnas quedaban vacías a propósito, con esta razón: "poner
   * algo en el mail o el nombre sería decir que alguien contestó el
   * formulario". **Esa razón se murió el 18/10/2026**, cuando el alta se mudó a
   * `Altas del sistema`: una fila ahí no dice que nadie contestó nada, dice que
   * la creó el sistema — y entonces saber quién fue es información y no una
   * mentira. Es lo que le faltaba a quien mira la planilla para saber a quién
   * preguntarle.
   */
  email: string | null;
  nombre: string | null;
  apellido: string | null;
  sector: string | null;
  equipo: string | null;
  especialidad: string | null;
  tipo: string | null;
  quien: string | null;
  descripcion: string;
  repuesto: string | null;
  /** "YYYY-MM-DD". Es la fecha de ejecución comprometida. */
  fecha_ejecucion: string | null;
  prioridad: string | null;
}

export interface Celda { columna: number; valor: string | number }

export type ResultadoCeldas =
  | { ok: true; celdas: Celda[] }
  | { ok: false; motivos: string[] };

/**
 * Qué celdas hay que escribir para que la fila sea una OT.
 *
 * Devuelve **sólo las columnas que el alta llena**. Las demás —el mail de quien
 * responde, el nombre, el apellido, la puntuación— quedan vacías a propósito:
 * no son nuestras y poner algo sería decir que alguien contestó el formulario
 * cuando no lo contestó.
 *
 * Se niega con los motivos juntos y no de a uno: quien lo lee quiere saber qué
 * hay que arreglar en la planilla, no descubrirlo de a una corrida por vez.
 */
export function celdasDelAlta(
  encabezado: readonly string[],
  datos: DatosDelAlta
): ResultadoCeldas {
  const idx = indiceDeColumnas(encabezado);

  const faltan = IMPRESCINDIBLES.filter((c) => idx[c] < 0).map(
    (c) => `${c} (${ALIAS[c].join(" o ")})`
  );
  if (faltan.length > 0) {
    return {
      ok: false,
      motivos: [`el encabezado de «${HOJA_DE_RESPUESTAS}» no tiene: ${faltan.join(", ")}`],
    };
  }

  // `serialDelInstante` no valida —lo dice su propio docstring—: una fecha
  // inválida da NaN, que escrito es "NaN" y deja una marca temporal basura en
  // una fila que ya no se puede distinguir de una respuesta de verdad.
  const texto = (v: string | null | undefined): string => String(v ?? "").trim();

  const marca = serialDelInstante(datos.creado);
  if (!Number.isFinite(marca)) {
    return { ok: false, motivos: [`la fecha de creación no es válida: ${String(datos.creado)}`] };
  }

  const valores: Partial<Record<Clave, string | number>> = {
    nro: datos.ot_number,
    marca,
    email: texto(datos.email),
    nombre: texto(datos.nombre),
    apellido: texto(datos.apellido),
    sector: texto(datos.sector),
    equipo: texto(datos.equipo),
    especialidad: texto(datos.especialidad),
    tipo: texto(datos.tipo),
    quien: texto(datos.quien),
    descripcion: texto(datos.descripcion),
    repuesto: texto(datos.repuesto),
    prioridad: texto(datos.prioridad),
  };

  // La fecha va como serial o no va. Un "14/10/2026" lo interpreta la planilla
  // según su locale, que es la trampa que dio vuelta 885 fechas en Compras.
  const serial = datos.fecha_ejecucion ? serialDelDia(datos.fecha_ejecucion) : null;
  if (serial !== null) valores.fecha = serial;

  const celdas: Celda[] = [];
  for (const [clave, valor] of Object.entries(valores) as [Clave, string | number][]) {
    const columna = idx[clave];
    // Una columna que el encabezado no trae y que no es imprescindible
    // simplemente no se escribe: el formulario puede no tener esa pregunta.
    if (columna < 0) continue;
    if (valor === "") continue;
    celdas.push({ columna, valor });
  }

  return { ok: true, celdas };
}


/**
 * Si en esa fila no hay nada todavía.
 *
 * Es la guarda de concurrencia del alta: dos altas al mismo tiempo leen la
 * misma columna y calculan la misma fila libre, y sin esto la segunda pisa a la
 * primera — una OT que desaparece sin dejar rastro en ningún lado.
 */
export function laFilaEstaLibre(celda: readonly (readonly unknown[])[]): boolean {
  return String(celda[0]?.[0] ?? "").trim() === "";
}


// ── Lo que habla con Google ───────────────────────────────────

const PLANILLA = () => process.env.GOOGLE_SHEETS_MANTENIMIENTO_FORMULARIO_ID ?? "";

/** La columna del N° de OT, que es la que dice si una fila tiene datos. */
const COLUMNA_SERIE = "A";

/**
 * La columna de la serie, **sin calcular**.
 *
 * Con `FORMULA` una celda vuelve como el literal que tiene o como el texto de
 * su fórmula, y las dos preguntas que hay que hacerle —¿es una fórmula? ¿qué
 * número es?— se contestan de la misma lectura. Con los valores ya calculados
 * la primera no se puede contestar: una fórmula que devuelve 2785 se lee igual
 * que un 2785 escrito.
 */
const serieDeLaPestana = (planilla: string, pestana: string): Promise<string[][]> =>
  leerFormulas(planilla, `${pestana}!${COLUMNA_SERIE}:${COLUMNA_SERIE}`);

export type ResultadoDelAlta =
  | {
      ok: true;
      /** El número que la serie le dio, y que ya está escrito en la planilla. */
      ot_number: number;
      /** En qué fila de «Altas del sistema» quedó. Sólo para informar. */
      fila: number;
    }
  /** Qué pasó, sin traducir. Un diagnóstico que no se distingue no sirve. */
  | { ok: false; error: string };

/**
 * El número más alto de la serie, leído de las **dos** pestañas donde vive.
 *
 * **De la planilla de respuestas y no del master.** El master la recibe por
 * `IMPORTRANGE`, que llega con retraso: dos OT creadas con pocos minutos de
 * diferencia leerían el mismo máximo y tomarían el mismo número. Acá se lee la
 * fuente, que es lo que el Apps Script del formulario también cuenta.
 *
 * Devuelve `null` si no se puede leer, para que quien llame decida — no es lo
 * mismo "la serie va por 2785" que "no sé por dónde va", y un 0 confundiría las
 * dos cosas.
 */
export async function maximoDeLaSerieEnLaPlanilla(): Promise<number | null> {
  const planilla = PLANILLA();
  if (!planilla) return null;

  try {
    const [form, altas] = await Promise.all([
      serieDeLaPestana(planilla, HOJA_DE_RESPUESTAS),
      serieDeLaPestana(planilla, HOJA_DE_ALTAS),
    ]);
    return Math.max(maximoDeLaSerie(form), maximoDeLaSerie(altas));
  } catch {
    return null;
  }
}

/**
 * Da de alta la orden en «Altas del sistema» y devuelve el número que le tocó.
 *
 * **Se llama antes de crear la OT en la base, y ése es el punto.** La planilla
 * manda en Mantenimiento: una orden existe cuando tiene su fila. Si esto falla,
 * no se creó nada en ningún lado y no se consumió ningún número — que es
 * exactamente lo que el 16/10/2026 no pasó y dejó a la 2796 esperando que el
 * formulario repartiera su número otra vez.
 *
 * Al revés tampoco es gratis, y conviene saberlo: si la fila se escribe y
 * después falla el insert en la base, la OT queda **sólo en la planilla**. Eso
 * no es un estado roto sino el estado normal de cualquier orden cargada por el
 * formulario, y la próxima sincronización la trae. Al derecho, en cambio, la
 * pérdida era silenciosa.
 *
 * **Escribe en `Altas del sistema` y no en la pestaña del formulario**, que es
 * de donde salió todo esto: Forms inserta dentro de su rango y empuja las filas
 * ajenas hacia abajo, y el registro de una OT corrida queda pegado a otra.
 *
 * No lanza: devuelve qué pasó, sin traducir, para que la pantalla lo muestre.
 *
 * Se lee con `leerFormulas` y no con los valores a propósito: hacen falta las
 * dos cosas de la misma lectura —si la celda es una fórmula y qué número
 * tiene—, y con los valores calculados la primera no se puede contestar.
 */
export async function altaEnLaPlanilla(
  datos: Omit<DatosDelAlta, "ot_number">
): Promise<ResultadoDelAlta> {
  const planilla = PLANILLA();
  if (!planilla) {
    return {
      ok: false,
      error:
        "Falta configurar GOOGLE_SHEETS_MANTENIMIENTO_FORMULARIO_ID, así que no hay " +
        "dónde escribir la orden ni de dónde sacarle el número.",
    };
  }

  try {
    // Las dos columnas A. El número sale del máximo de las dos y la fila de la
    // de altas, que es donde se escribe.
    const [form, altas] = await Promise.all([
      serieDeLaPestana(planilla, HOJA_DE_RESPUESTAS),
      serieDeLaPestana(planilla, HOJA_DE_ALTAS),
    ]);

    const sigue = loQueSigueEnLaSerie(form, altas);
    if (!sigue.ok) return sigue;

    // El encabezado de **las altas**: es la pestaña donde se va a escribir, y
    // la crea una persona a mano. Si quedó sin encabezado, `celdasDelAlta` se
    // niega diciendo qué columnas faltan en vez de escribir una fila con los
    // datos en cualquier lado.
    const encabezado =
      (await leerFormulas(planilla, `${HOJA_DE_ALTAS}!1:1`))[0] ?? [];

    const armado = celdasDelAlta(encabezado, { ...datos, ot_number: sigue.ot_number });
    if (!armado.ok) {
      return {
        ok: false,
        error: `La pestaña «${HOJA_DE_ALTAS}» no sirve para escribir: ${armado.motivos.join("; ")}`,
      };
    }

    // Releer justo esa celda antes de escribir. Entre la lectura de arriba y
    // esta línea puede haber entrado otra alta, y las dos calcularon la misma
    // fila libre: sin esto, la segunda pisa a la primera y la OT perdida no
    // deja rastro en ningún lado.
    const destino = await leerFormulas(
      planilla, `${HOJA_DE_ALTAS}!${COLUMNA_SERIE}${sigue.fila}`
    );
    if (!laFilaEstaLibre(destino)) {
      return {
        ok: false,
        error:
          `La fila ${sigue.fila} de «${HOJA_DE_ALTAS}» se ocupó mientras se preparaba ` +
          `el alta. No se escribió nada: volvé a intentar.`,
      };
    }

    await escribirCeldas(
      planilla,
      armado.celdas.map((c) => ({
        pestana: HOJA_DE_ALTAS,
        columna: c.columna,
        fila: sigue.fila,
        valor: c.valor,
      }))
    );

    // Y releer lo escrito. No es ceremonia: es lo único que distingue "quedó
    // con su número" de "quedó con el de otro", y es lo que Compras aprendió
    // perdiendo un pedido el 09/09/2026.
    const quedo = await leerFormulas(
      planilla, `${HOJA_DE_ALTAS}!${COLUMNA_SERIE}${sigue.fila}`
    );
    const escrito = Number(String(quedo[0]?.[0] ?? "").trim());
    if (escrito !== sigue.ot_number) {
      return {
        ok: false,
        error:
          `Se escribió la fila ${sigue.fila} de «${HOJA_DE_ALTAS}» pero quedó con el N° ` +
          `${JSON.stringify(quedo[0]?.[0] ?? "")} en vez de ${sigue.ot_number}. ` +
          `Revisá esa fila antes de volver a cargarla.`,
      };
    }

    return { ok: true, ot_number: sigue.ot_number, fila: sigue.fila };
  } catch (e) {
    const porque = e instanceof Error ? e.message : String(e);
    // Con el nombre de la pestaña adelante: el 400 de Google por una pestaña
    // que todavía no existe dice "Unable to parse range", que no le sirve a
    // nadie si no se sabe qué rango se pidió.
    return { ok: false, error: `No se pudo escribir en «${HOJA_DE_ALTAS}»: ${porque}` };
  }
}
