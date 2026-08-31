/**
 * Revisa la cadena de conexión ANTES de intentar el dump.
 *
 * `supabase db dump --db-url` pide la cadena percent-encoded, y cuando no lo
 * está falla con un error de conexión que no menciona el encoding. Si la
 * contraseña tiene un `@`, un `#`, un `?` o una barra —y las que genera
 * Supabase a veces los tienen— la URL se parte en el lugar equivocado y lo que
 * se ve es "could not translate host name" o un fallo de autenticación,
 * ninguno de los dos apuntando al problema real.
 *
 * Imprime host, puerto, usuario y base para poder confirmar a ojo que es la
 * cadena correcta. La contraseña NUNCA se imprime: sólo se dice si tiene
 * caracteres que hay que codificar, y cuáles.
 */

const url = process.env.DB_URL ?? "";
if (!url) {
  console.log("::error::DB_URL vacía");
  process.exit(1);
}

// El separador es el ÚLTIMO `@`: la contraseña puede contener uno.
const iEsquema = url.indexOf("://");
if (iEsquema === -1) {
  console.log("::error::La cadena no arranca con postgresql:// o postgres://");
  process.exit(1);
}
const esquema = url.slice(0, iEsquema);
const resto = url.slice(iEsquema + 3);
const iArroba = resto.lastIndexOf("@");
if (iArroba === -1) {
  console.log("::error::La cadena no tiene la parte usuario:contraseña@host");
  process.exit(1);
}

const credenciales = resto.slice(0, iArroba);
const destino = resto.slice(iArroba + 1);
const iDosPuntos = credenciales.indexOf(":");
const usuario = iDosPuntos === -1 ? credenciales : credenciales.slice(0, iDosPuntos);
const password = iDosPuntos === -1 ? "" : credenciales.slice(iDosPuntos + 1);

const [hostPuerto, ...camino] = destino.split("/");
const [host, puerto] = hostPuerto.split(":");
const base = camino.join("/").split("?")[0];

console.log("Cadena de conexión:");
console.log(`  esquema:    ${esquema}`);
console.log(`  usuario:    ${usuario}`);
console.log(`  host:       ${host}`);
console.log(`  puerto:     ${puerto || "(sin puerto)"}`);
console.log(`  base:       ${base || "(sin base)"}`);
console.log(`  contraseña: ${password ? `${password.length} caracteres` : "VACÍA"}`);

let hayError = false;

if (!password) {
  console.log("::error::La cadena no trae contraseña. Si quedó el literal [YOUR-PASSWORD], hay que reemplazarlo por la contraseña real de la base.");
  hayError = true;
}
if (password.includes("[") || password.includes("]")) {
  console.log("::error::La contraseña tiene corchetes: quedó el placeholder [YOUR-PASSWORD] sin reemplazar.");
  hayError = true;
}

// Los que rompen una URL si van sin codificar. El `%` va aparte: si ya está
// codificada, aparece, y no es un problema.
const problematicos = [...new Set([...password].filter((ch) => "@/:?#[]& ".includes(ch)))];
if (problematicos.length > 0) {
  const comoCodificar: Record<string, string> = {
    "@": "%40", "/": "%2F", ":": "%3A", "?": "%3F", "#": "%23",
    "[": "%5B", "]": "%5D", "&": "%26", " ": "%20",
  };
  console.log(
    `::error::La contraseña tiene caracteres que hay que codificar en la URL: ${problematicos
      .map((c) => `${c} → ${comoCodificar[c]}`)
      .join(", ")}. supabase db dump --db-url exige la cadena percent-encoded; sin eso la URL se parte en el lugar equivocado y el error no lo dice. Reemplazalos en la contraseña dentro de la cadena, o cambiá la contraseña de la base por una alfanumérica.`
  );
  hayError = true;
}

if (host.startsWith("db.") && host.endsWith(".supabase.co")) {
  console.log("::error::Es la conexión DIRECTA, que resuelve sólo en IPv6 y no funciona desde GitHub Actions. Va la del Session pooler.");
  hayError = true;
}
if (puerto === "6543") {
  console.log("::error::Es el pooler de TRANSACCIÓN (6543), que no soporta prepared statements. Va el Session pooler, puerto 5432.");
  hayError = true;
}
if (host.includes("pooler.supabase.com") && !usuario.includes(".")) {
  console.log(`::error::Con el pooler el usuario es postgres.<ref>, no "${usuario}". Copiá la cadena completa de la pestaña Session pooler.`);
  hayError = true;
}

process.exit(hayError ? 1 : 0);
