/**
 * Compara, día por día, lo que el servidor tiene contra lo que está en Drive.
 *
 *   node historial.mjs                    el resumen
 *   node historial.mjs --detalle          además, cada día que falta
 *   node historial.mjs otra-config.json   usa otra configuración
 *
 * Lee la misma configuración que `subir-zips.mjs`, así que mira exactamente
 * los mismos orígenes. **No sube ni borra nada.**
 *
 * ──────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE, Y POR QUÉ SU RESPUESTA NO ES "FALTAN N ARCHIVOS"
 *
 * El log del subidor dice qué pasó en cada corrida, y eso no alcanza: una
 * corrida que no ocurrió no deja línea. Entre el 07 y el 10/11/2026 la
 * notebook estuvo dos días apagada y dos días sin ver el recurso compartido,
 * y lo único que había para enterarse era leer el archivo entero a ojo.
 *
 * Pero el número que este script imprime **no se lee como "falta subir eso"**,
 * y confundirlo lleva a subir 73 MB para no agregar un solo dato. Los cinco
 * orígenes de zips ACUMULAN: el archivo de hoy contiene lo de los días que
 * faltan. Medido el 11/11/2026, y por eso se escribe acá en vez de medirlo:
 *
 * - Filler 1, el zip del 15/09 (que no está en Drive) y el del 11/11 (que sí)
 *   arrancan los dos en la misma fila —`26/2/2026;15:21;1201`— y el segundo
 *   tiene 5.390 líneas contra 4.129. El primero está adentro del segundo.
 * - Hornos, su planilla de noviembre pasó de 58.713 a 63.746 bytes a lo largo
 *   de veinte zips, sin bajar nunca.
 * - Portería, `PLANILLA PESAJES.xlsx` de 130.872 a 130.909, igual.
 *
 * **El sexto origen, la balanza, NO acumula**, y eso se supo recién el
 * 25/11/2026: sus CSV son una ventana corrida que el software purga cada
 * tanto. Para ese origen un día perdido SÍ cuesta el dato, y por eso su
 * entrada lleva `fusionar: true` y la historia la guarda Drive (ver
 * fusionar.mjs). Lo de abajo vale para los cinco de zips, no para él.
 *
 * Así que lo que un día faltante cuesta **no es el dato, es la foto**: no se
 * puede saber cómo se veía una planilla el 07/11. El subidor nunca prometió
 * eso. Lo que sí hay que mirar de este informe es otra cosa: un origen cuyo
 * archivo MÁS NUEVO no esté en Drive, que es el único caso en que el dato de
 * verdad no llegó, y la racha de días seguidos, que dice si la máquina que
 * sube se está quedando sin red.
 */
import { createSign } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { fusionarLineas } from "./fusionar.mjs";

const args = process.argv.slice(2);
const detalle = args.includes("--detalle");
const rutaConfig = resolve(args.find((a) => !a.startsWith("--")) ?? "subir-zips.config.json");

const config = JSON.parse(readFileSync(rutaConfig, "utf8").replace(/^\uFEFF/, ""));
// El BOM se saca de los dos, y no sólo de la configuración: la credencial es
// justo el archivo que alguien copia a mano a una máquina nueva y abre con el
// Bloc de notas, que se lo agrega al guardar. Mismo motivo que en subir-zips.
const cuenta = JSON.parse(readFileSync(resolve(config.credencial), "utf8").replace(/^\uFEFF/, ""));

const b64url = (x) => Buffer.from(typeof x === "string" ? x : JSON.stringify(x)).toString("base64url");

async function token() {
  const ahora = Math.floor(Date.now() / 1000);
  const cab = b64url({ alg: "RS256", typ: "JWT" });
  const rec = b64url({
    iss: cuenta.client_email,
    scope: "https://www.googleapis.com/auth/drive",
    aud: "https://oauth2.googleapis.com/token",
    exp: ahora + 3600,
    iat: ahora,
  });
  const firma = createSign("RSA-SHA256").update(`${cab}.${rec}`).sign(cuenta.private_key).toString("base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${cab}.${rec}.${firma}`,
    }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error(`no se pudo autenticar: ${JSON.stringify(j)}`);
  return j.access_token;
}

/** Todo lo que hay en la carpeta de Drive, por nombre. */
async function leerDrive(tok) {
  const salida = new Map();
  let pagina;
  do {
    const p = new URLSearchParams({
      q: `'${config.carpetaDrive}' in parents and trashed = false`,
      fields: "nextPageToken, files(id, name, size, modifiedTime)",
      pageSize: "200",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    if (pagina) p.set("pageToken", pagina);
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?${p}`, {
      headers: { Authorization: `Bearer ${tok}` },
    });
    if (!res.ok) throw new Error(`Drive ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const j = await res.json();
    for (const f of j.files ?? [])
      salida.set(f.name, { id: f.id, tamano: Number(f.size ?? 0), mod: f.modifiedTime });
    pagina = j.nextPageToken;
  } while (pagina);
  return salida;
}

/** El contenido de un archivo de Drive. latin1 por lo mismo que en subir-zips. */
async function bajarTexto(tok, id) {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${tok}` },
  });
  if (!res.ok) throw new Error(`Drive ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return Buffer.from(await res.arrayBuffer()).toString("latin1");
}

const dia = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** La racha más larga de días seguidos dentro de una lista de fechas ISO. */
function rachaMasLarga(dias) {
  const orden = [...dias].sort();
  let mejor = { largo: 0, desde: null, hasta: null };
  let largo = 0;
  let desde = null;
  for (let i = 0; i < orden.length; i++) {
    const previo = i > 0 ? new Date(`${orden[i - 1]}T00:00:00Z`) : null;
    const hoy = new Date(`${orden[i]}T00:00:00Z`);
    const seguido = previo && hoy - previo === 86_400_000;
    if (!seguido) {
      largo = 1;
      desde = orden[i];
    } else largo++;
    if (largo > mejor.largo) mejor = { largo, desde, hasta: orden[i] };
  }
  return mejor;
}

const tok = await token();
const enDrive = await leerDrive(tok);
console.log(`En Drive hay ${enDrive.size} archivos.\n`);

let problemas = 0;

for (const origen of config.origenes) {
  const etiqueta = origen.nombre;
  let archivos;
  try {
    archivos = readdirSync(origen.carpeta)
      .map((n) => {
        const ruta = join(origen.carpeta, n);
        const s = statSync(ruta);
        return s.isFile() ? { nombre: n, ruta, mtime: s.mtime, tamano: s.size } : null;
      })
      .filter(Boolean);
  } catch (e) {
    console.log(`## ${etiqueta}\n   ROMPE  no se pudo leer la carpeta: ${e.message}\n`);
    problemas++;
    continue;
  }

  if (origen.carpetaEntera) {
    // Comparar por tamaño sólo vale si el archivo de Drive es una copia del
    // del servidor. Con `fusionar` no lo es —Drive guarda además lo que el
    // origen ya purgó, así que es legítimamente MÁS GRANDE— y la pregunta
    // honesta pasa a ser otra: ¿queda alguna fila del servidor sin subir?
    // Se contesta con la MISMA función que usa el subidor para decidirlo, a
    // propósito: dos definiciones de "ya está" darían dos respuestas.
    const faltan = [];
    for (const a of archivos) {
      const d = enDrive.get(`${etiqueta} ${a.nombre}`);
      if (!d) {
        faltan.push(a);
        continue;
      }
      if (!origen.fusionar) {
        if (d.tamano !== a.tamano) faltan.push(a);
        continue;
      }
      const { agregadas } = fusionarLineas(await bajarTexto(tok, d.id), readFileSync(a.ruta, "latin1"));
      if (agregadas) faltan.push({ ...a, detalle: `${agregadas} fila(s) sin subir` });
    }
    console.log(`## ${etiqueta}  ·  ${archivos.length} archivos en el servidor`);
    if (faltan.length === 0) console.log("   OK   los que están en el servidor están en Drive\n");
    else {
      console.log(
        `   ROMPE  ${faltan.length} ${origen.fusionar ? "tienen filas que no llegaron a Drive" : "no están en Drive o difieren en tamaño"}`,
      );
      problemas++;
      if (detalle)
        for (const a of faltan) console.log(`          ${a.nombre} (${a.detalle ?? `${a.tamano} bytes`})`);
      console.log("");
    }
    continue;
  }

  // Un archivo de Drive por día. Sólo se mira contra los días que el servidor
  // TODAVÍA tiene: de uno cuyo zip ya se borró de allá no se puede decir nada,
  // y decirlo sería inventar.
  // El mismo `ignorar` que usa el subidor, por la misma razón: si acá no se
  // aplicara, un día en que el robot de Planta 02 dejó sólo su zip basura
  // saldría como ROMPE —"el más nuevo no está en Drive"— cuando lo correcto
  // es que ese archivo no se sube. Dos filtros distintos sobre los mismos
  // archivos son dos respuestas distintas a la misma pregunta.
  const descartar = origen.ignorar ? new RegExp(origen.ignorar, "i") : null;
  const porDia = new Map();
  for (const a of archivos.filter(
    (x) => x.nombre.toLowerCase().endsWith(".zip") && !descartar?.test(x.nombre),
  )) {
    const d = dia(a.mtime);
    const actual = porDia.get(d);
    if (!actual || a.mtime > actual.mtime) porDia.set(d, a);
  }
  const dias = [...porDia.keys()].sort();
  if (dias.length === 0) {
    console.log(`## ${etiqueta}\n   ROMPE  no hay ningún zip en el servidor\n`);
    problemas++;
    continue;
  }
  const faltan = dias.filter((d) => !enDrive.has(`${etiqueta} ${d}.zip`));
  const ultimo = dias.at(-1);
  // Lo único que de verdad importa: que el archivo MÁS NUEVO haya llegado.
  const ultimoLlego = enDrive.has(`${etiqueta} ${ultimo}.zip`);

  console.log(`## ${etiqueta}  ·  ${dias.length} días en el servidor, del ${dias[0]} al ${ultimo}`);
  if (ultimoLlego) console.log(`   OK     el más nuevo (${ultimo}) está en Drive, así que el dato está`);
  else {
    console.log(`   ROMPE  el más nuevo (${ultimo}) NO está en Drive: el dato de hoy no llegó`);
    problemas++;
  }
  if (faltan.length) {
    const r = rachaMasLarga(faltan);
    console.log(`   ${faltan.length} día(s) sin foto en Drive — racha más larga: ${r.largo} (${r.desde} a ${r.hasta})`);
    if (detalle) for (const d of faltan) console.log(`          ${etiqueta} ${d}.zip  ←  ${porDia.get(d).nombre}`);
  }
  console.log("");
}

console.log(problemas ? `ROMPE ${problemas}` : "ROMPE 0 — el dato más nuevo de cada origen está en Drive");
process.exitCode = problemas ? 1 : 0;
