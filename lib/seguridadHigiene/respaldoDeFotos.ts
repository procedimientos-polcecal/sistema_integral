import { mensajeDeGoogle } from "@/lib/core/google";

/**
 * Las decisiones del respaldo de fotos a Drive, sin tocar Drive ni la base.
 *
 * ── POR QUÉ EXISTE EL RESPALDO ──────────────────────────────────────────────
 *
 * Las 52 fotos de la planilla de la que sale este módulo eran hipervínculos al
 * disco de una sola computadora, y por eso no se pueden recuperar. Las de ahora
 * viven en el bucket privado `syh-fotos` y esto les saca una copia **fuera del
 * sistema**.
 *
 * **Es respaldo y no es la fuente.** La app lee siempre de Storage; a nadie se
 * le muestra un link de Drive. Si Drive falla, se anota y se reintenta al otro
 * día: `respaldada_en_drive_el` en null es un estado válido y es el de partida.
 *
 * Lo que habla con Drive y con la base está en `respaldoEnDrive.ts`, que no se
 * puede probar sin ellos. Acá queda lo que sí: qué foto va, cómo se llama el
 * archivo y cómo se cuenta un fallo.
 */

/**
 * Cuántas fotos como máximo entran en una corrida.
 *
 * Una corrida baja cada foto de Storage y la sube a Drive, una por una —son
 * dos viajes de red por foto, más uno de comprobación—, y la función de Vercel
 * tiene tope de tiempo. Cuarenta fotos de hasta 4 MB (el techo de la app, ver
 * `MAXIMO_POR_PEDIDO`) entran con holgura en el tiempo de la ruta, y el
 * atraso se come solo: la corrida es diaria y los que cargan son una planta,
 * no un banco. Si una noche entran cien, el resto sale en las dos siguientes.
 */
export const MAXIMO_POR_CORRIDA = 40;

/**
 * Cuántos días puede esperar una foto sin copia antes de que se avise.
 *
 * Tres, y es lo que separa «todavía no corrió el cron» de «esto está atascado»:
 * el cron es diario y toma 40 por corrida, así que una foto sana tarda una
 * noche, dos si hubo un atraso. Pasados tres días sin copia, algo falla —la
 * variable, la carpeta, la foto— y alguien tiene que mirar. Sin este margen el
 * aviso sonaría (también por push) todas las mañanas con las fotos de ayer.
 */
export const DIAS_ANTES_DE_AVISAR = 3;

/**
 * El instante a partir del cual una foto sin respaldar cuenta como atascada: lo
 * que se compara con `subida_el` (`subida_el < corte`). Devuelve ISO UTC.
 */
export function corteDeFotosAtascadas(ahora: Date): string {
  return new Date(ahora.getTime() - DIAS_ANTES_DE_AVISAR * 86_400_000).toISOString();
}

export interface FotoParaRespaldar {
  id: string;
  subida_el: string;
  respaldada_en_drive_el: string | null;
}

/**
 * Las fotos que toca respaldar en esta corrida: las que **nunca** se
 * respaldaron, **las más viejas primero**, y no más que `maximo`.
 *
 * Las más viejas primero porque son las que llevan más tiempo expuestas a que
 * se pierda lo único que tienen. El orden entre dos fotos del mismo instante lo
 * desempata el id, para que dos corridas seguidas no discutan cuál va antes.
 *
 * No modifica lo que recibe.
 */
export function cualesRespaldar<T extends FotoParaRespaldar>(fotos: T[], maximo: number): T[] {
  if (!(maximo > 0)) return [];

  return fotos
    .filter((f) => f.respaldada_en_drive_el == null)
    .sort((a, b) => {
      const porFecha = Date.parse(a.subida_el) - Date.parse(b.subida_el);
      if (porFecha !== 0 && !Number.isNaN(porFecha)) return porFecha;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .slice(0, Math.floor(maximo));
}

/**
 * Cómo se llama el archivo en Drive: `condicion-0042_2026-10-29_<id de la foto>.jpg`.
 *
 * Lleva el **número de la condición** porque es lo que alguien va a buscar el
 * día que haga falta recuperar una foto, y el **id de la foto entero** porque
 * es lo que hace único el nombre: la corrida lo usa para saber si una foto ya
 * subió y no repetirla (si la subida salió y el marcado en la base falló, la
 * próxima corrida la encuentra por el nombre en vez de duplicarla).
 *
 * Sin número —una condición que no se pudo leer— queda `condicion-sin-numero`.
 */
export function nombreEnDrive(
  foto: { id: string; ruta: string; subida_el: string },
  numeroDeCondicion: number | null | undefined
): string {
  const numero =
    numeroDeCondicion == null ? "sin-numero" : String(numeroDeCondicion).padStart(4, "0");
  const dia = /^\d{4}-\d{2}-\d{2}/.exec(foto.subida_el)?.[0] ?? "sin-fecha";
  const extension = /\.([A-Za-z0-9]{1,5})$/.exec(foto.ruta)?.[1]?.toLowerCase() ?? "jpg";
  const id = foto.id.replace(/[^A-Za-z0-9-]/g, "");
  return `condicion-${numero}_${dia}_${id}.${extension}`;
}

/** El tipo del archivo según la extensión de su ruta en el bucket. */
export function tipoDeLaFoto(ruta: string): string {
  const extension = /\.([A-Za-z0-9]+)$/.exec(ruta)?.[1]?.toLowerCase();
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  if (extension === "heic") return "image/heic";
  return "image/jpeg";
}

/**
 * ¿Este fallo de Drive es de la carpeta y no de la foto?
 *
 * Importa porque cambia qué hace la corrida: si es de la foto (un 500 pasajero,
 * un archivo que no está), se sigue con la siguiente; si es de la carpeta —sin
 * permiso, que no existe, está en «Mi unidad» y no hay cuota, o Google pide
 * frenar— **todas las que siguen van a fallar igual**, y insistir cuarenta
 * veces sólo llena el registro con el mismo renglón y gasta el tiempo.
 */
export function fallaEsDeLaCarpeta(estado: number, cuerpo: string): boolean {
  if (cuerpo.includes("storageQuotaExceeded") || cuerpo.includes("do not have storage quota")) {
    return true;
  }
  return estado === 401 || estado === 403 || estado === 404 || estado === 429;
}

const LARGO_MAXIMO_DEL_CRUDO = 500;

/**
 * Lo que se guarda cuando Drive dice que no: **primero lo que dijo Google, sin
 * traducir**, y después —separado— qué hay que tocar.
 *
 * El orden es el punto. Un diagnóstico que no se distingue de otro no es un
 * diagnóstico, y el texto traducido pierde justo lo que distingue: el código y
 * la razón. La traducción va al lado, nunca en lugar.
 *
 * La del error de cuota se escribe acá porque es el que va a aparecer si la
 * carpeta se creó en «Mi unidad» de alguien (ver `scripts/backup/subir-a-drive.mts`),
 * y el mensaje de Google no dice qué hacer.
 */
export function diagnosticoDeDrive(estado: number, cuerpo: string, cuenta?: string): string {
  const crudo = cuerpo.length > LARGO_MAXIMO_DEL_CRUDO ? `${cuerpo.slice(0, LARGO_MAXIMO_DEL_CRUDO)}…` : cuerpo;

  const esDeCuota =
    cuerpo.includes("storageQuotaExceeded") || cuerpo.includes("do not have storage quota");
  const queHacer = esDeCuota
    ? "La cuenta de servicio no tiene cuota de Drive: la carpeta está en «Mi unidad» de alguien y no en una " +
      `unidad compartida. Hay que crear la carpeta dentro de una unidad compartida y agregar a ${cuenta ?? "la cuenta de servicio"} ` +
      "como Colaborador o Administrador de contenido."
    : mensajeDeGoogle(estado, cuerpo, cuenta);

  return `Drive respondió ${estado}: ${crudo} · Qué hacer: ${queHacer}`;
}
