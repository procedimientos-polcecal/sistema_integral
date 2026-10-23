/**
 * Sube a Drive el zip más nuevo de cada molino, una vez por día.
 *
 * Corre en una PC de la red —no en Vercel ni en el CI— porque los zips que
 * deja el PCRobot viven en un recurso compartido al que sólo se llega desde
 * adentro. Es el único eslabón del SdG que necesita una máquina propia.
 *
 * NO TIENE DEPENDENCIAS. Es un archivo suelto que corre con `node` a secas, a
 * propósito: en la PC donde va a vivir no queremos un checkout del repo ni un
 * `npm install` que se rompa en seis meses. Firma el JWT con el `crypto` que
 * viene en Node y habla con Drive por `fetch`. Node 18 o posterior.
 *
 * Uso:
 *   node subir-zips.mjs                      usa ./subir-zips.config.json
 *   node subir-zips.mjs otra-config.json     usa otra
 *   node subir-zips.mjs --seco               dice qué haría, no sube nada
 *   node subir-zips.mjs --diario 09:30       no termina: sube ahora y después
 *                                            todos los días a esa hora local
 *
 * El `--diario` existe para correr dentro de un contenedor, que es la forma
 * recomendada: así el planificador va adentro y la máquina de afuera no
 * necesita Node ni una tarea programada. Para la instalación suelta con el
 * Programador de tareas de Windows se usa sin él, una corrida por invocación.
 *
 * Cómo se instala, de las dos maneras, en docs/PRODUCCION-FILLERS-SUBIDA.md.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * TRES COSAS QUE SE PAGAN CARO SI NO SE SABEN
 *
 * 1. La carpeta de destino tiene que estar en una UNIDAD COMPARTIDA. Una
 *    cuenta de servicio no tiene cuota de Drive: subir a "Mi unidad" de una
 *    persona falla con "Service Accounts do not have storage quota" aunque la
 *    carpeta esté compartida como editor. Es el mismo pozo que ya documenta
 *    scripts/backup/subir-a-drive.mts, y el error de Google no dice qué hacer.
 *    Acá se traduce.
 *
 * 2. El zip del robot es ACUMULATIVO: cada uno trae la carpeta entera desde
 *    febrero de 2026, no las novedades del día. Por eso este script puede ser
 *    tonto —sin cola, sin reintentos, sin estado— y un día que falle no pierde
 *    nada: el del día siguiente trae todo igual. No le agregues memoria; es la
 *    propiedad que lo hace confiable.
 *
 * 3. Todo lo ejecutable vive adentro de `principal()` y nada corre al cargar
 *    el módulo. No es estilo: `salir()` se usa mientras se lee la
 *    configuración, y si el `class Corte` o el `let archivoLog` que necesita
 *    quedan declarados más abajo, el primer error de una instalación nueva
 *    —la ruta mal, el JSON mal— sale como un `ReferenceError` del script en
 *    lugar del motivo real. Ya pasó dos veces escribiendo esto. El error que
 *    más importa que se entienda es justamente el de la primera corrida.
 */

import { createSign } from "node:crypto";
import { readFileSync, readdirSync, statSync, appendFileSync } from "node:fs";
import { join, basename, resolve } from "node:path";

const SCOPE = "https://www.googleapis.com/auth/drive";

/** Dónde se está escribiendo el log, si la configuración ya pudo leerse. */
let archivoLog = null;

/**
 * Corta con código 1 y un motivo legible.
 *
 * No usa `process.exit()`: matar el proceso con un socket de `fetch` todavía
 * abierto hace que Node aborte con `Assertion failed: !(handle->flags &
 * UV_HANDLE_CLOSING)` y devuelva **127**. El Programador de tareas de Windows
 * muestra ese número como "último resultado", así que el diagnóstico que
 * escribimos con cuidado quedaba tapado por un código que no significa nada.
 * Se lanza una excepción y se deja que Node termine solo.
 */
class Corte extends Error {}

/**
 * Cada línea va a la consola y, si hay log configurado, al archivo. Una tarea
 * programada no tiene a nadie mirando la consola: sin archivo, un fallo de
 * hace tres semanas no se puede reconstruir.
 */
function decir(texto) {
  const linea = `${new Date().toISOString()} ${texto}`;
  console.log(linea);
  if (archivoLog) {
    try {
      appendFileSync(resolve(archivoLog), linea + "\n");
    } catch {
      /* que no falle la subida por no poder escribir el log */
    }
  }
}

function salir(motivo) {
  decir(`ERROR ${motivo}`);
  throw new Corte(motivo);
}

function b64url(x) {
  return Buffer.from(typeof x === "string" ? x : JSON.stringify(x)).toString("base64url");
}

/**
 * El zip más nuevo de una carpeta, por fecha de modificación y no por nombre:
 * el robot a veces exporta fuera de horario y el nombre lleva la hora con
 * punto y coma, que no ordena como uno espera.
 */
function zipMasNuevo(carpeta) {
  let archivos;
  try {
    archivos = readdirSync(carpeta);
  } catch (e) {
    return { error: `no se pudo leer ${carpeta}: ${e.message}` };
  }
  const zips = archivos
    .filter((n) => n.toLowerCase().endsWith(".zip"))
    .map((n) => {
      const ruta = join(carpeta, n);
      const s = statSync(ruta);
      return { ruta, nombre: n, mtime: s.mtime, tamano: s.size };
    })
    .sort((a, b) => b.mtime - a.mtime);
  if (zips.length === 0) return { error: `no hay ningún .zip en ${carpeta}` };
  return { zip: zips[0] };
}

/**
 * `FILLER 1 2026-10-20 09;00;13.zip` → `Filler 1 2026-10-20.zip`.
 *
 * Se le saca la hora por dos razones: así dos exportaciones del mismo día no
 * dejan dos archivos —la segunda pisa a la primera, y como el zip es
 * acumulativo la segunda es la buena—, y así el nombre ordena bien. Y el
 * destino lleva el nombre del molino **de la configuración**, no el del
 * archivo: si alguien renombra la carpeta del robot, acá no cambia nada.
 */
function nombreDestino(molino, mtime) {
  const f = new Date(mtime);
  const dia =
    `${f.getFullYear()}-` +
    `${String(f.getMonth() + 1).padStart(2, "0")}-` +
    `${String(f.getDate()).padStart(2, "0")}`;
  return `${molino} ${dia}.zip`;
}

/**
 * Los argumentos, una sola vez y bien.
 *
 * Se parsea acá y no con `indexOf` suelto por dos cosas que ya mordieron:
 *
 * - El valor de `--diario` es un argumento suelto más. Buscar "el primero que
 *   no empieza con guiones" para la ruta de configuración tomaba `09:30` como
 *   el nombre del archivo.
 * - `--diario` **sin** hora dejaba la variable en `undefined`, que es falso,
 *   así que caía en el modo de una sola pasada en silencio. Adentro de un
 *   contenedor eso es peor que un error: el proceso termina, `restart:
 *   unless-stopped` lo vuelve a levantar, y queda reiniciándose para siempre
 *   pareciendo que trabaja.
 */
function leerArgumentos(argv) {
  const sueltos = [];
  let seco = false;
  let diario; // undefined = no se pidió; "" = se pidió sin valor
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--seco" || a === "--dry-run") seco = true;
    else if (a === "--diario") diario = argv[++i] ?? "";
    else if (a.startsWith("--")) sueltos.push(a); // desconocido: que falle al abrirlo
    else sueltos.push(a);
  }
  return { seco, diario, rutaConfig: sueltos[0] ?? "subir-zips.config.json" };
}

const opciones = leerArgumentos(process.argv.slice(2));

async function principal() {
  // ── Configuración ───────────────────────────────────────────────────────
  const { seco } = opciones;
  const rutaConfig = resolve(opciones.rutaConfig);

  let config;
  try {
    config = JSON.parse(readFileSync(rutaConfig, "utf8"));
  } catch (e) {
    salir(`No se pudo leer la configuración en ${rutaConfig}: ${e.message}`);
  }

  const { credencial, carpetaDrive, origenes, log } = config;
  archivoLog = log ?? null;

  if (!credencial) salir('Falta "credencial": la ruta al JSON de la cuenta de servicio.');
  if (!carpetaDrive) salir('Falta "carpetaDrive": el id de la carpeta de destino, dentro de una unidad compartida.');
  if (!Array.isArray(origenes) || origenes.length === 0) salir('Falta "origenes": al menos un { nombre, carpeta }.');

  let cuenta;
  try {
    cuenta = JSON.parse(readFileSync(resolve(credencial), "utf8"));
  } catch (e) {
    salir(`No se pudo leer la credencial en ${credencial}: ${e.message}`);
  }
  if (!cuenta.client_email || !cuenta.private_key) {
    salir(`${credencial} no parece una cuenta de servicio: le falta client_email o private_key.`);
  }

  /** Traduce los dos errores de Drive que no se entienden leyéndolos. */
  const explicar = (estado, cuerpo) => {
    if (cuerpo.includes("storageQuotaExceeded") || cuerpo.includes("do not have storage quota")) {
      return (
        "La cuenta de servicio no tiene cuota de Drive: la carpeta de destino está en " +
        '"Mi unidad" de alguien y no en una unidad compartida. Hay que crear la carpeta ' +
        `dentro de una unidad compartida y agregar a ${cuenta.client_email} como ` +
        "Colaborador o Administrador de contenido."
      );
    }
    if (estado === 404) {
      return (
        `Drive contestó 404 para la carpeta ${carpetaDrive}. O el id está mal, o ` +
        `${cuenta.client_email} no es miembro de esa unidad compartida — para una ` +
        "cuenta de servicio, lo que no puede ver no existe."
      );
    }
    return `Drive contestó ${estado}: ${cuerpo.slice(0, 400)}`;
  };

  // ── Token ───────────────────────────────────────────────────────────────
  const ahora = Math.floor(Date.now() / 1000);
  const cabecera = b64url({ alg: "RS256", typ: "JWT" });
  const reclamo = b64url({
    iss: cuenta.client_email,
    scope: SCOPE,
    aud: "https://oauth2.googleapis.com/token",
    exp: ahora + 3600,
    iat: ahora,
  });
  const firma = createSign("RSA-SHA256")
    .update(`${cabecera}.${reclamo}`)
    .sign(cuenta.private_key)
    .toString("base64url");

  const resToken = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${cabecera}.${reclamo}.${firma}`,
    }),
  });
  const json = await resToken.json().catch(() => ({}));
  if (!json.access_token) {
    salir(
      `No se pudo autenticar con Google: ${JSON.stringify(json)}. ` +
        "Si dice invalid_grant, lo más probable es que el reloj de esta PC esté corrido."
    );
  }
  const token = json.access_token;

  // ── Drive ───────────────────────────────────────────────────────────────

  /** El archivo con ese nombre que ya esté en la carpeta, o null. */
  const buscar = async (nombre) => {
    const q = new URLSearchParams({
      q: `'${carpetaDrive}' in parents and name = '${nombre.replace(/'/g, "\\'")}' and trashed = false`,
      fields: "files(id,name,size)",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      pageSize: "1",
    });
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?${q}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const texto = await res.text();
    if (!res.ok) salir(explicar(res.status, texto));
    return JSON.parse(texto).files?.[0] ?? null;
  };

  /**
   * Multipart: metadatos y contenido en un solo request. Los zips pesan
   * decenas de kilobytes, así que no hace falta subida resumible.
   *
   * Con `id` reemplaza el contenido del archivo que ya está (PATCH) en vez de
   * crear otro. Hace falta porque la cuenta de servicio es **Colaboradora** en
   * la unidad compartida y no puede borrar: sin esto, dos exportaciones del
   * mismo día dejarían dos archivos con el mismo nombre y nadie podría sacar
   * el viejo.
   */
  const subir = async (nombre, ruta, id) => {
    const LIMITE = "limite-" + Math.random().toString(36).slice(2);
    const metadatos = JSON.stringify(id ? { name: nombre } : { name: nombre, parents: [carpetaDrive] });
    const cuerpo = Buffer.concat([
      Buffer.from(
        `--${LIMITE}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadatos}\r\n` +
          `--${LIMITE}\r\nContent-Type: application/zip\r\n\r\n`
      ),
      readFileSync(ruta),
      Buffer.from(`\r\n--${LIMITE}--\r\n`),
    ]);

    const url =
      "https://www.googleapis.com/upload/drive/v3/files" +
      (id ? `/${id}` : "") +
      "?uploadType=multipart&supportsAllDrives=true&fields=id,name,size";

    const res = await fetch(url, {
      method: id ? "PATCH" : "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${LIMITE}` },
      body: cuerpo,
    });
    const texto = await res.text();
    if (!res.ok) salir(explicar(res.status, texto));
    return JSON.parse(texto);
  };

  // ── Lo que hace ─────────────────────────────────────────────────────────
  decir(`Cuenta ${cuenta.client_email} · carpeta ${carpetaDrive}${seco ? " · MODO SECO, no sube nada" : ""}`);

  let fallaron = 0;
  for (const origen of origenes) {
    const etiqueta = origen.nombre ?? basename(origen.carpeta ?? "?");
    if (!origen.carpeta) {
      decir(`ERROR ${etiqueta}: falta "carpeta" en la configuración`);
      fallaron++;
      continue;
    }

    const { zip, error } = zipMasNuevo(origen.carpeta);
    if (error) {
      decir(`ERROR ${etiqueta}: ${error}`);
      fallaron++;
      continue;
    }

    const dias = Math.floor((Date.now() - zip.mtime.getTime()) / 86_400_000);
    const aviso = dias >= 2 ? `  (OJO: el robot no exporta hace ${dias} días)` : "";
    const destino = nombreDestino(etiqueta, zip.mtime);

    const yaEsta = await buscar(destino);
    if (yaEsta && Number(yaEsta.size) === zip.tamano) {
      decir(`= ${etiqueta}: ${destino} ya está en Drive con el mismo tamaño, no se sube${aviso}`);
      continue;
    }

    if (seco) {
      const que = yaEsta ? "reemplazaría" : "subiría";
      decir(`~ ${etiqueta}: ${que} ${zip.nombre} (${zip.tamano} bytes) como ${destino}${aviso}`);
      continue;
    }

    const subido = await subir(destino, zip.ruta, yaEsta?.id);
    const que = yaEsta ? "reemplazado" : "subido";
    decir(`+ ${etiqueta}: ${destino} ${que}, ${subido.size} bytes, id ${subido.id}${aviso}`);
  }

  if (fallaron) decir(`Terminó con ${fallaron} origen(es) con problemas.`);
  else decir("Listo.");
  return fallaron;
}

/** Una pasada que nunca lanza: devuelve cuántas cosas salieron mal. */
async function unaPasada() {
  try {
    return await principal();
  } catch (e) {
    // Un Corte ya dijo lo suyo con `decir()`; cualquier otra cosa es un error
    // nuestro y conviene que salga entera, con stack.
    if (!(e instanceof Corte)) decir(`ERROR inesperado: ${e?.stack ?? e}`);
    return 1;
  }
}

/** Milisegundos hasta la próxima HH:MM **en la hora local del proceso**. */
function faltaHasta(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const ahora = new Date();
  const proxima = new Date(ahora);
  proxima.setHours(h, m, 0, 0);
  if (proxima <= ahora) proxima.setDate(proxima.getDate() + 1);
  return proxima - ahora;
}

const horaDiaria = opciones.diario;

if (horaDiaria === undefined) {
  process.exitCode = (await unaPasada()) ? 1 : 0;
} else if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(horaDiaria)) {
  decir(`ERROR --diario espera una hora HH:MM entre 00:00 y 23:59, y recibió "${horaDiaria}".`);
  process.exitCode = 1;
} else {
  /**
   * El modo diario **arranca subiendo**, antes de esperar a la hora.
   *
   * Es lo que hace que el contenedor se cure solo: si estuvo apagado durante
   * la ventana —se reinició el host, se actualizó la imagen—, al volver sube
   * en vez de esperar veinticuatro horas. Sale gratis porque la subida es
   * idempotente: si el archivo del día ya está con el mismo tamaño, no hace
   * nada.
   *
   * Y un fallo **no termina el proceso**. Un contenedor que se cae por un
   * error de red de un martes queda reiniciándose contra la política del
   * daemon y ensucia el diagnóstico; acá se anota y se espera a mañana, que es
   * exactamente lo que corresponde cuando el archivo de origen es acumulativo.
   */
  decir(`Modo diario a las ${horaDiaria}, hora local del contenedor (TZ=${process.env.TZ ?? "sin definir"}).`);
  for (;;) {
    await unaPasada();
    const falta = faltaHasta(horaDiaria);
    decir(`Próxima corrida en ${Math.round(falta / 60000)} minutos.`);
    await new Promise((r) => setTimeout(r, falta));
  }
}
