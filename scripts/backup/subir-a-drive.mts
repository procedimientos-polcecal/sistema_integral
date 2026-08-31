/**
 * Sube un archivo a una carpeta de Drive y borra los backups viejos.
 *
 * Lo llama el workflow .github/workflows/backup.yml después de hacer el dump.
 * Reutiliza la misma cuenta de servicio que Compras y Mantenimiento, así que no
 * hay credenciales nuevas que administrar.
 *
 * IMPORTANTE: la carpeta tiene que estar en una UNIDAD COMPARTIDA. Una cuenta de
 * servicio no tiene cuota de Drive: subir a "Mi unidad" de una persona falla con
 * "Service Accounts do not have storage quota" aunque la carpeta esté compartida
 * como editor. En una unidad compartida los archivos son de la unidad, no de
 * quien los sube, y ahí sí entra.
 *
 * Uso:
 *   GOOGLE_SERVICE_ACCOUNT_JSON=... GOOGLE_DRIVE_BACKUPS_FOLDER_ID=... \
 *     npx tsx scripts/backup/subir-a-drive.mts <archivo> [--retener 30]
 */
import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { obtenerToken, SCOPE_DRIVE, mensajeDeGoogle, cuentaDeServicio } from "../../lib/core/google.ts";

const archivo = process.argv[2];
if (!archivo) {
  console.error("Falta el archivo a subir");
  process.exit(1);
}

const iRetener = process.argv.indexOf("--retener");
const retenerDias = iRetener > -1 ? Number(process.argv[iRetener + 1]) : 30;

const carpeta = process.env.GOOGLE_DRIVE_BACKUPS_FOLDER_ID;
if (!carpeta) {
  console.error("Falta GOOGLE_DRIVE_BACKUPS_FOLDER_ID");
  process.exit(1);
}

const PREFIJO = "sdg-backup-";

/**
 * Traduce el error de cuota, que es el que va a aparecer si la carpeta no está
 * en una unidad compartida. El mensaje de Google no dice qué hacer.
 */
function explicar(estado: number, cuerpo: string): string {
  if (cuerpo.includes("storageQuotaExceeded") || cuerpo.includes("do not have storage quota")) {
    return (
      "La cuenta de servicio no tiene cuota de Drive: la carpeta de destino está en " +
      '"Mi unidad" de alguien, no en una unidad compartida. Hay que crear una unidad ' +
      `compartida, poner la carpeta ahí y agregar a ${cuentaDeServicio() ?? "la cuenta de servicio"} ` +
      "como Administrador de contenido o Colaborador."
    );
  }
  return mensajeDeGoogle(estado, cuerpo, cuentaDeServicio());
}

const token = await obtenerToken([SCOPE_DRIVE]);
const nombre = basename(archivo);
const tamano = statSync(archivo).size;

// ── Subir ────────────────────────────────────────────────────
// Multipart: los metadatos y el contenido en un solo request. Alcanza hasta
// 5 MB; más arriba conviene el upload reanudable, y el dump de esta base está
// en el orden de los cientos de KB comprimido.
const LIMITE_MULTIPART = 5 * 1024 * 1024;
if (tamano > LIMITE_MULTIPART) {
  console.error(
    `El archivo pesa ${(tamano / 1024 / 1024).toFixed(1)} MB y este script sube hasta 5 MB ` +
      "en un request. Hay que pasar a upload reanudable."
  );
  process.exit(1);
}

const limite = "-------sdg-backup-limite";
const cuerpo = Buffer.concat([
  Buffer.from(
    `--${limite}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify({ name: nombre, parents: [carpeta] }) +
      `\r\n--${limite}\r\nContent-Type: application/octet-stream\r\n\r\n`
  ),
  readFileSync(archivo),
  Buffer.from(`\r\n--${limite}--`),
]);

const subida = await fetch(
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,size",
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${limite}`,
    },
    body: cuerpo,
  }
);

if (!subida.ok) {
  console.error(explicar(subida.status, await subida.text()));
  process.exit(1);
}
const subido = await subida.json();
console.log(`Subido: ${subido.name} (${(tamano / 1024).toFixed(0)} KB, id ${subido.id})`);

// ── Retención ────────────────────────────────────────────────
// Se borran los backups más viejos que `retenerDias`. Sólo los que llevan el
// prefijo, para no tocar nada que alguien haya puesto en la misma carpeta.
if (!Number.isFinite(retenerDias) || retenerDias <= 0) {
  console.log("Sin retención configurada: no se borra nada.");
  process.exit(0);
}

const corte = new Date(Date.now() - retenerDias * 86_400_000).toISOString();
const params = new URLSearchParams({
  q: `'${carpeta}' in parents and trashed = false and name contains '${PREFIJO}' and createdTime < '${corte}'`,
  fields: "files(id, name, createdTime)",
  supportsAllDrives: "true",
  includeItemsFromAllDrives: "true",
  pageSize: "100",
});

const listado = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
  headers: { Authorization: `Bearer ${token}` },
});
if (!listado.ok) {
  // No es fatal: el backup ya está arriba, que es lo que importa.
  console.warn(`No se pudo listar para limpiar: ${explicar(listado.status, await listado.text())}`);
  process.exit(0);
}

const viejos = (await listado.json()).files ?? [];
console.log(`Backups con más de ${retenerDias} días: ${viejos.length}`);
for (const f of viejos as { id: string; name: string }[]) {
  const del = await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}?supportsAllDrives=true`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  console.log(del.ok ? `  borrado ${f.name}` : `  NO se pudo borrar ${f.name}`);
}
