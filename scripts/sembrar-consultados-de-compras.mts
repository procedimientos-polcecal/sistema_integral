// Dejar la lista de `compras_consultados` con quien contesta hoy: Facundo Ortiz.
//
// POR QUÉ ES UN SCRIPT Y NO UNA MIGRACIÓN
//
// Es DML sobre una tabla del núcleo y depende de un `usuarios.id` que no se puede
// escribir a mano en un archivo de migración sin fijarlo para siempre. Se corre
// una vez, después de aplicar `20261029082249`, y no vuelve a hacer falta: de ahí
// en más la lista se administra en Compras → Configuración, que es la razón por la
// que es una lista y no una persona fija en el código. Una licencia se arregla
// ahí.
//
// **Está escrito y sin correr a propósito.** Medido el 31/10/2026, la migración
// `20261029082249` todavía no estaba aplicada: `compras_consultados` devuelve
// `PGRST205`. Las migraciones las corre una persona en el editor SQL de Supabase
// y un agente no puede correr DDL, así que esto quedó listo para esa persona en
// vez de redactado dos veces.
//
// QUÉ HACE Y QUÉ NO
//
// Busca a `compras@polcecal.com` en `usuarios` y lo pone en la lista. Es
// idempotente por partida doble: no escribe si ya está, y si escribiera dos veces
// el `upsert` sobre la clave primaria `usuario_id` no duplicaría nada.
//
// **No saca a nadie.** Si alguien más ya está en la lista cuando esto corre, es
// porque lo agregaron desde la pantalla, y un script de siembra que deshaga eso es
// peor que no correr. Lo informa y no lo toca.
//
// Comprobado contra la base el 30/10/2026: `compras@polcecal.com` es Facundo
// Ortiz, activo, rol `encargado`, id `a9d3310b-b0d7-4c08-91e1-d3a5545c9277`. El id
// va acá como comprobación y no como dato: lo que se busca es el correo, y si el
// id que vuelve fuera otro el script avisa en vez de seguir — una cuenta rehecha
// con el mismo correo es el caso en el que sembrar a ciegas pone en la lista a
// quien no es.
//
// Uso:
//   npx tsx scripts/sembrar-consultados-de-compras.mts            ← dice qué haría
//   npx tsx scripts/sembrar-consultados-de-compras.mts --aplicar
import { readFileSync } from "node:fs";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf-8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const { createAdminClient } = await import("../lib/supabase/admin.ts");

const CORREO = "compras@polcecal.com";
const ID_ESPERADO = "a9d3310b-b0d7-4c08-91e1-d3a5545c9277";

const aplicar = process.argv.includes("--aplicar");
const admin = createAdminClient();

const { data: persona, error: errorUsuario } = await admin
  .from("usuarios")
  .select("id, nombre, apellido, activo")
  .eq("email", CORREO)
  .maybeSingle();

if (errorUsuario) {
  console.error(`No se pudo leer usuarios: ${errorUsuario.message}`);
  process.exit(1);
}
if (!persona) {
  console.error(`No hay ningún usuario con el correo ${CORREO}.`);
  process.exit(1);
}
if (persona.id !== ID_ESPERADO) {
  console.error(
    `${CORREO} ya no es la cuenta que se midió el 30/10/2026 (id ${ID_ESPERADO}, ` +
    `ahora ${persona.id}). Comprobar de quién es antes de ponerlo en la lista.`
  );
  process.exit(1);
}
if (!persona.activo) {
  console.error(`${CORREO} está dado de baja: no recibiría ningún aviso.`);
  process.exit(1);
}

const quien = `${persona.nombre} ${persona.apellido} <${CORREO}>`;

const { data: lista, error: errorLista } = await admin
  .from("compras_consultados")
  .select("usuario_id");

if (errorLista) {
  // `PGRST205` es la tabla que no está en el esquema: la migración no corrió.
  // Se nombra porque es el único error esperable de este script y confundirlo con
  // un problema de permisos cuesta una tarde.
  const falta = errorLista.code === "PGRST205";
  console.error(
    falta
      ? "La tabla `compras_consultados` no existe todavía: falta aplicar la migración " +
        "20261029082249 en el editor SQL de Supabase. Volvé a correr esto después."
      : `No se pudo leer compras_consultados: ${errorLista.message}`
  );
  process.exit(1);
}

const yaEstan = (lista ?? []).map((f) => f.usuario_id as string);
const otros = yaEstan.filter((id) => id !== persona.id);
if (otros.length > 0) {
  console.log(`Ya hay ${otros.length} persona(s) más en la lista. No se las toca.`);
}

if (yaEstan.includes(persona.id)) {
  console.log(`${quien} ya está en la lista. No hay nada que hacer.`);
  process.exit(0);
}

if (!aplicar) {
  console.log(`Sumaría a ${quien}. Volvé a correrlo con --aplicar.`);
  process.exit(0);
}

const { error } = await admin
  .from("compras_consultados")
  .upsert({ usuario_id: persona.id }, { onConflict: "usuario_id" });

if (error) {
  console.error(`No se pudo sumar a ${quien}: ${error.message}`);
  process.exit(1);
}

console.log(`Listo: ${quien} recibe los avisos de las consultas de repuestos.`);
