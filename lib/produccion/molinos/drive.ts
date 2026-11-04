/**
 * Los zips del PC Robot que viven en la unidad compartida `PC Robot` de Drive.
 *
 * Una tarea programada sube todos los días, a las 09:30 de Argentina, un zip por
 * molino: `Filler 1 2026-10-29.zip`, `Filler 2 2026-10-29.zip`. El prefijo es el
 * `prefijo_archivo` del catálogo `produccion_molinos`, y la fecha del nombre no
 * se lee: manda `modifiedTime`, que no se puede escribir mal.
 *
 * **Sólo se lee Drive; nunca se escribe.** La cuenta de servicio es Lector de
 * la unidad y alcanza con eso.
 *
 * Lo que hay que saber antes de tocar las llamadas: la carpeta está en una
 * **unidad compartida**, así que toda llamada va con `supportsAllDrives=true`
 * (y el listado además con `includeItemsFromAllDrives=true`). Sin eso Drive
 * contesta 404 sobre un archivo que existe, y no explica por qué.
 */

import JSZip from "jszip";
import {
  obtenerToken, mensajeDeGoogle, cuentaDeServicio, SCOPE_DRIVE_LECTURA,
} from "@/lib/core/google";

export interface ArchivoDeMolino {
  molinoClave: string;
  nombre: string;
  id: string;
  /** `modifiedTime` de Drive, ISO 8601. */
  modificado: string;
}

/** Un zip más viejo que esto es señal de que la tarea del robot dejó de subir. */
const HORAS_HASTA_OBSOLETO = 24;

/**
 * Si el nombre del archivo es de este molino.
 *
 * No alcanza con `startsWith("Filler 1")`: `Filler 10 2026-10-29.zip` también
 * empieza así y es de otro molino. Después del prefijo tiene que venir algo que
 * no sea una letra ni un dígito —el espacio, un guion, el punto de la
 * extensión—.
 */
function esDelPrefijo(nombre: string, prefijo: string): boolean {
  const n = nombre.toLowerCase();
  const p = prefijo.trim().toLowerCase();
  if (!p || !n.startsWith(p)) return false;
  const siguiente = n.charAt(p.length);
  return siguiente === "" || !/[a-z0-9áéíóúñ]/i.test(siguiente);
}

const msDe = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? -Infinity : t;
};

/**
 * Asigna cada zip a su molino por el prefijo del nombre, y no adivina: un
 * archivo que no es de ningún molino va a `sinMolino` para que alguien lo vea,
 * en vez de importarse al que más se le parece.
 *
 * Si hay varios zips del mismo molino se queda con el más nuevo por
 * `modificado`; los viejos se ignoran sin avisar, porque que queden los de
 * días anteriores en la carpeta es lo normal. Si dos prefijos compiten por el
 * mismo nombre gana el más largo (`Filler 1 Calera` antes que `Filler 1`).
 *
 * **Pura y exportada**: es la decisión, y Drive no hace falta para probarla.
 */
export function emparejar(
  archivos: { nombre: string; id?: string; modificado?: string }[],
  molinos: { clave: string; prefijo_archivo: string }[],
): { archivos: ArchivoDeMolino[]; sinMolino: string[] } {
  const porLargo = [...molinos].sort((a, b) => b.prefijo_archivo.length - a.prefijo_archivo.length);
  const elegidos = new Map<string, ArchivoDeMolino>();
  const sinMolino: string[] = [];

  for (const a of archivos) {
    const molino = a.nombre.toLowerCase().endsWith(".zip")
      ? porLargo.find((m) => esDelPrefijo(a.nombre, m.prefijo_archivo))
      : undefined;
    if (!molino) {
      sinMolino.push(a.nombre);
      continue;
    }
    const candidato: ArchivoDeMolino = {
      molinoClave: molino.clave,
      nombre: a.nombre,
      id: a.id ?? "",
      modificado: a.modificado ?? "",
    };
    const actual = elegidos.get(molino.clave);
    // Estrictamente mayor: ante un empate queda el primero, que es el que Drive
    // ya ordenó primero.
    if (!actual || msDe(candidato.modificado) > msDe(actual.modificado)) {
      elegidos.set(molino.clave, candidato);
    }
  }

  // En el orden de los molinos y no en el de llegada, para que el informe sea
  // estable de un día al otro.
  const orden = molinos.map((m) => m.clave);
  return {
    archivos: [...elegidos.values()].sort((a, b) => orden.indexOf(a.molinoClave) - orden.indexOf(b.molinoClave)),
    sinMolino,
  };
}

/**
 * Si el archivo es demasiado viejo para ser el de hoy: 24 horas o más.
 *
 * Una fecha que no se puede leer cuenta como obsoleta. Lo contrario sería
 * declarar al día un archivo del que no se sabe nada.
 */
export function estaObsoleto(modificado: string, ahora: Date): boolean {
  const t = Date.parse(modificado);
  if (Number.isNaN(t)) return true;
  return ahora.getTime() - t >= HORAS_HASTA_OBSOLETO * 3_600_000;
}

function idDeLaCarpeta(): string {
  const id = (process.env.GOOGLE_DRIVE_PCROBOT_FOLDER_ID ?? "").trim();
  if (!id) throw new Error("GOOGLE_DRIVE_PCROBOT_FOLDER_ID no configurado");
  return id;
}

/** Los zips de la carpeta, uno por molino, y los nombres que no son de ninguno. */
export async function listarArchivos(
  molinos: { clave: string; prefijo_archivo: string }[],
): Promise<{ archivos: ArchivoDeMolino[]; sinMolino: string[] }> {
  const token = await obtenerToken([SCOPE_DRIVE_LECTURA]);
  const carpeta = idDeLaCarpeta();

  const todos: { nombre: string; id: string; modificado: string }[] = [];
  let pagina: string | undefined;
  do {
    const parametros = new URLSearchParams({
      q: `'${carpeta}' in parents and trashed = false`,
      fields: "nextPageToken, files(id, name, modifiedTime)",
      orderBy: "modifiedTime desc",
      pageSize: "200",
      // Sin estas dos Drive contesta 404 sobre una unidad compartida.
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    if (pagina) parametros.set("pageToken", pagina);

    const res = await fetch(`https://www.googleapis.com/drive/v3/files?${parametros}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(mensajeDeGoogle(res.status, await res.text(), cuentaDeServicio()));

    const json = await res.json();
    for (const f of (json.files ?? []) as { id: string; name: string; modifiedTime: string }[]) {
      todos.push({ id: f.id, nombre: f.name, modificado: f.modifiedTime });
    }
    pagina = json.nextPageToken;
  } while (pagina);

  return emparejar(todos, molinos);
}

/** Cota de lo que se descomprime de un solo archivo: un CSV de estos pesa unos cientos de KB. */
const MAX_BYTES_POR_CSV = 20 * 1024 * 1024;

/**
 * Baja el zip y devuelve cada CSV por su nombre, **ya decodificado**.
 *
 * Los CSV vienen en cp1252, no en UTF-8: leerlos como UTF-8 rompe cualquier
 * acento del archivo. Por eso se decodifican acá y `csv.ts` recibe texto.
 * Sólo se devuelven los `.csv`; los `DATADAT*` y los `.txt` sueltos que trae el
 * zip son restos de febrero y no se leen. La clave es el nombre sin carpeta.
 */
export async function bajarYDescomprimir(id: string): Promise<Record<string, string>> {
  const token = await obtenerToken([SCOPE_DRIVE_LECTURA]);
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(mensajeDeGoogle(res.status, await res.text(), cuentaDeServicio()));

  const zip = await JSZip.loadAsync(await res.arrayBuffer());
  const decodificador = new TextDecoder("windows-1252");
  const salida: Record<string, string> = {};

  for (const [ruta, entrada] of Object.entries(zip.files)) {
    if (entrada.dir) continue;
    const nombre = ruta.split("/").pop() ?? ruta;
    if (!nombre.toLowerCase().endsWith(".csv")) continue;
    const bytes = await entrada.async("uint8array");
    if (bytes.length > MAX_BYTES_POR_CSV) {
      throw new Error(`${nombre} pesa ${bytes.length} bytes y se esperaba un CSV de unos cientos de KB`);
    }
    salida[nombre] = decodificador.decode(bytes);
  }
  return salida;
}
