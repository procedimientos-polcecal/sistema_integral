/**
 * Traer del Drive la foto de un aviso, para servirla desde el SdG.
 *
 * ── POR QUÉ EXISTE ────────────────────────────────────────────────────────
 *
 * El formulario de Google deja la foto en el Drive de quien recibe las
 * respuestas y escribe en la planilla un `drive.google.com/open?id=…`. Ese
 * link **no se puede dibujar en un `<img>`**: hasta el 19/11/2026, medido, las
 * tres formas que suelen servir —`thumbnail?id=`, `uc?export=view` y
 * `lh3.googleusercontent.com/d/`— devolvían el login de Google, y la cuenta de
 * servicio contestaba 404 sobre el archivo. La pantalla mostraba un enlace y
 * nada más: la abría únicamente el dueño de la carpeta.
 *
 * **Ese mismo día se compartió la carpeta con la cuenta de servicio** y el
 * 404 pasó a 200 (`IMG-20261117-WA0015 - Martin Sandoval.jpg`, 185 KB,
 * `image/jpeg`). Con eso el SdG puede hacer de intermediario: trae el archivo
 * con su propia credencial y lo sirve a quien tenga sesión, que es lo que hace
 * que la foto se vea de verdad dentro del sistema.
 *
 * ── LO QUE NO SE PUEDE AFLOJAR ────────────────────────────────────────────
 *
 * Esta función tiene la credencial de una cuenta que ve **todas** las
 * planillas y carpetas del grupo. Por eso **el id no puede venir de quien
 * llama**: lo saca la ruta de `avisos.reference_photos`, o sea de una fila que
 * ya está en la base. Si el id llegara por la URL, cualquiera con sesión
 * podría leerse la contabilidad pidiéndola por id.
 *
 * Y por lo mismo acá se corta todo lo que no sea una imagen: la columna K de
 * la planilla es texto libre, y alguien podría pegar ahí el link de un
 * documento. Un aviso tiene fotos; cualquier otra cosa no se sirve.
 */

import {
  obtenerToken, mensajeDeGoogle, cuentaDeServicio, SCOPE_DRIVE_LECTURA,
} from "@/lib/core/google";

/** Diez megas, el mismo tope que `POST /api/mantenimiento/fotos`. */
const MAXIMO = 10 * 1024 * 1024;

export interface FotoTraida {
  bytes: ArrayBuffer;
  tipo: string;
  /** El nombre en Drive, para que la descarga no se llame `foto`. */
  nombre: string;
}

export type ProblemaDeLaFoto =
  | { codigo: 404; error: string }
  | { codigo: 415; error: string }
  | { codigo: 502; error: string };

/**
 * El id de Drive que hay adentro de un link, o `null` si no es uno.
 *
 * Son cuatro formas porque la planilla acumuló las cuatro: la que escribe el
 * formulario (`open?id=`), la que se copia desde el botón de compartir
 * (`/file/d/<id>/view`), la de descarga directa y la del visor de imágenes.
 */
export function idDeDrive(link: string | null | undefined): string | null {
  const texto = (link ?? "").trim();
  if (!texto) return null;

  let url: URL;
  try {
    url = new URL(texto);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  // El `(^|\.)` de cada alternativa es lo que separa `lh3.googleusercontent.com`
  // de un `evilgoogleusercontent.com`: sin él, el `$` solo mira el final del
  // texto y cualquiera puede registrar un dominio que termine igual.
  if (!/(^|\.)((drive|docs)\.google|googleusercontent)\.com$/i.test(url.hostname)) return null;

  const enLaQuery = url.searchParams.get("id");
  if (enLaQuery && esId(enLaQuery)) return enLaQuery;

  // `/file/d/<id>/view`, `/document/d/<id>/edit`, `/d/<id>` del visor.
  const enElCamino = url.pathname.match(/\/d\/([^/]+)/);
  if (enElCamino && esId(enElCamino[1])) return enElCamino[1];

  return null;
}

/**
 * Los ids de Drive son base64url. Se comprueba la forma y no el largo: Google
 * no promete cuántos caracteres tiene, y un id que no existe igual da 404.
 * Lo que sí importa es que no entre una barra ni un `..`, porque termina
 * pegado a una URL de la API.
 */
const esId = (texto: string) => /^[A-Za-z0-9_-]{10,200}$/.test(texto);

/** Trae el archivo de Drive, o dice por qué no se puede servir. */
export async function traerFotoDeDrive(id: string): Promise<FotoTraida | ProblemaDeLaFoto> {
  if (!esId(id)) return { codigo: 404, error: "Ese no es un archivo de Drive." };

  const token = await obtenerToken([SCOPE_DRIVE_LECTURA]);
  const cabeceras = { Authorization: `Bearer ${token}` };
  // `supportsAllDrives` va siempre: sin eso Drive contesta 404 sobre un
  // archivo que existe cuando está en una unidad compartida, y no dice por qué.
  const comun = "supportsAllDrives=true";

  const meta = await fetch(
    `https://www.googleapis.com/drive/v3/files/${id}?fields=name,mimeType,size&${comun}`,
    { headers: cabeceras }
  );
  if (!meta.ok) {
    // El 404 de Drive es el mismo para "no existe" y para "no lo compartieron
    // conmigo", así que se dice lo segundo: es lo que hay que ir a arreglar.
    const dijo = mensajeDeGoogle(meta.status, await meta.text(), cuentaDeServicio(), "leer");
    return meta.status === 404
      ? { codigo: 404, error: `La foto no está en Drive o la carpeta no está compartida con el sistema. ${dijo}` }
      : { codigo: 502, error: `Drive no la quiso dar: ${dijo}` };
  }

  const datos = (await meta.json()) as { name?: string; mimeType?: string; size?: string };
  const tipo = datos.mimeType ?? "";
  if (!tipo.startsWith("image/")) {
    return { codigo: 415, error: `Eso no es una foto, es ${tipo || "un archivo sin tipo"}.` };
  }
  if (Number(datos.size ?? 0) > MAXIMO) {
    return { codigo: 415, error: "La foto pesa más de 10 MB y no se sirve desde acá." };
  }

  const archivo = await fetch(
    `https://www.googleapis.com/drive/v3/files/${id}?alt=media&${comun}`,
    { headers: cabeceras }
  );
  if (!archivo.ok) {
    const dijo = mensajeDeGoogle(archivo.status, await archivo.text(), cuentaDeServicio(), "leer");
    return { codigo: 502, error: `Drive no la quiso dar: ${dijo}` };
  }

  return { bytes: await archivo.arrayBuffer(), tipo, nombre: datos.name ?? "foto" };
}

export const esProblema = (r: FotoTraida | ProblemaDeLaFoto): r is ProblemaDeLaFoto =>
  "codigo" in r;
