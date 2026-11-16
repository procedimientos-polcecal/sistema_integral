// Comprueba que el CRM de Ventas quedó bien aplicado, contra la base real.
//
// POR QUÉ EXISTE
//
// Las dos migraciones del CRM las corre una persona a mano en el editor SQL de
// Supabase, y el editor dice «Success» igual cuando algo quedó a medias: un
// `create table if not exists` sobre una tabla que ya estaba no agrega las
// columnas nuevas, y una policy que se escribió sin envolver su función no
// rompe nada y no avisa. Lo que hay que poder contestar después de correrlas no
// es «¿dio error?» sino «¿quedó lo que la migración dice?».
//
// Las pantallas están detrás del login, así que no se pueden abrir desde acá.
// Lo que sí se puede es ejercitar el esquema, que es donde están las reglas que
// el código da por ciertas.
//
// Uso:
//   npx tsx scripts/probar-el-crm.mts              # sólo lee
//   npx tsx scripts/probar-el-crm.mts --escribir   # además hace un ida y vuelta
//
// SIN `--escribir` NO TOCA NADA. Con la bandera crea un cliente de prueba con
// una razón social marcada, ejercita los `check`, el trigger y la cascada, y
// **borra todo lo que creó** — incluso si algo falla en el medio. Nunca toca una
// fila que no haya creado él: se guarda los ids y borra por id.
//
// Necesita las claves de Supabase en `.env.local`.
import { readFileSync, existsSync } from "node:fs";

const env = new URL("../.env.local", import.meta.url);
if (existsSync(env)) {
  for (const line of readFileSync(env, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const { createClient } = await import("@supabase/supabase-js");

const URL_SB = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_SB || !SERVICE) {
  console.error("Falta NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local");
  process.exit(1);
}

const db = createClient(URL_SB, SERVICE, { auth: { persistSession: false } });
const escribir = process.argv.includes("--escribir");

/** Lee del catálogo con el mismo RPC que usa `simular-rls.mjs`. */
async function consultar<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const { data, error } = await db.rpc("asistente_consulta", { consulta: sql, tope: 400 }, { get: true });
  if (error) {
    console.error(`No se pudo consultar la base: ${error.message}`);
    process.exit(1);
  }
  return (data ?? []) as T[];
}

const titulo = (t: string) => console.log(`\n── ${t} ${"─".repeat(Math.max(0, 62 - t.length))}`);
let fallas = 0;
const ok = (t: string) => console.log(`  ok     ${t}`);
const mal = (t: string) => {
  console.log(`  FALLA  ${t}`);
  fallas += 1;
};

const TABLAS = [
  "ventas_clientes",
  "ventas_clientes_odoo",
  "ventas_contactos",
  "ventas_oportunidades",
  "ventas_actividades",
];

// ── 1. Las tablas ───────────────────────────────────────────
titulo("Las cinco tablas");
for (const tabla of TABLAS) {
  const { count, error } = await db.from(tabla).select("*", { count: "exact", head: true });
  if (error) mal(`${tabla} — ${error.message}`);
  else ok(`${tabla} · ${count} filas`);
}

// ── 2. El enum ──────────────────────────────────────────────
titulo("El valor 'ventas' del enum `modulo`");
{
  const { error } = await db.from("usuario_modulos").select("id").eq("modulo", "ventas").limit(1);
  if (error) mal(`el enum no acepta 'ventas' — ${error.message}`);
  else ok("el enum lo acepta");
}

// ── 3. Las tres funciones de permiso ────────────────────────
titulo("Las funciones de permiso");
{
  const funciones = await consultar<{ proname: string }>(
    "select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace " +
      "where n.nspname = 'public' and proname in " +
      "('tiene_acceso_ventas', 'puede_editar_ventas', 'es_admin_ventas') order by proname"
  );
  const encontradas = new Set(funciones.map((f) => f.proname));
  for (const f of ["es_admin_ventas", "puede_editar_ventas", "tiene_acceso_ventas"]) {
    if (encontradas.has(f)) ok(`${f}()`);
    else mal(`falta ${f}()`);
  }
}

// ── 4. Las policies, y que llamen envuelta a su función ─────
// Es la comprobación que más vale de todas: escribir `using (tiene_acceso_x())`
// en vez de `using ((select tiene_acceso_x()))` **no rompe nada y no avisa**.
// La tabla simplemente empieza a costar proporcional a sus filas, y se nota
// recién cuando creció. El 14/10/2026 eso tuvo a `calculos_diarios` en timeout.
titulo("Las policies de RLS");
{
  const policies = await consultar<{
    tablename: string;
    policyname: string;
    cmd: string;
    qual: string | null;
    with_check: string | null;
  }>(
    "select tablename, policyname, cmd, qual, with_check from pg_policies " +
      `where schemaname = 'public' and tablename in (${TABLAS.map((t) => `'${t}'`).join(", ")}) ` +
      "order by tablename, policyname"
  );

  for (const tabla of TABLAS) {
    const suyas = policies.filter((p) => p.tablename === tabla);
    if (suyas.length === 0) mal(`${tabla} no tiene ninguna policy`);
    else ok(`${tabla} · ${suyas.length} policies`);
  }

  // SI LAS LLAMADAS ESTÁN ENVUELTAS NO SE COMPRUEBA ACÁ, Y ES A PROPÓSITO.
  //
  // Lo contesta `node scripts/simular-rls.mjs`, que ya lo hace para las 336
  // policies del repo y no sólo para éstas. La primera versión de este script
  // traía su propia expresión regular y **daba las dieciséis mal**: Postgres
  // no guarda el texto como se escribió sino normalizado —`( SELECT
  // tiene_acceso_ventas() AS tiene_acceso_ventas)`, en mayúsculas y con
  // alias—, así que un `(?<!select\s)` en minúsculas no lo reconoce.
  //
  // Es exactamente la clase de error que el repo evita teniendo una sola
  // copia de cada regla: la segunda copia no se prueba contra la base y
  // termina acusando a código que estaba bien.
  console.log("  (si están envueltas lo dice `node scripts/simular-rls.mjs`, que las mira todas)");

  // RLS encendida: una tabla con policies y RLS apagada las ignora.
  const sinRls = await consultar<{ relname: string }>(
    "select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace " +
      `where n.nspname = 'public' and c.relname in (${TABLAS.map((t) => `'${t}'`).join(", ")}) ` +
      "and not c.relrowsecurity"
  );
  if (sinRls.length === 0) ok("las cinco tienen RLS encendida");
  else for (const t of sinRls) mal(`${t.relname} tiene las policies pero RLS APAGADA`);
}

// ── 5. Los triggers de `actualizado_en` ─────────────────────
titulo("Los triggers");
{
  const triggers = await consultar<{ relname: string }>(
    "select c.relname from pg_trigger t join pg_class c on c.oid = t.tgrelid " +
      "join pg_namespace n on n.oid = c.relnamespace " +
      "where n.nspname = 'public' and not t.tgisinternal " +
      `and c.relname in (${TABLAS.map((x) => `'${x}'`).join(", ")}) order by c.relname`
  );
  const conTrigger = new Set(triggers.map((t) => t.relname));
  for (const tabla of TABLAS) {
    if (conTrigger.has(tabla)) ok(`${tabla} tiene su trigger`);
    else mal(`${tabla} se quedó sin trigger de actualizado_en`);
  }
}

// ── 6. Quién tiene el módulo ────────────────────────────────
titulo("Quién tiene Ventas concedido");
{
  const { data } = await db
    .from("usuario_modulos")
    .select("nivel, usuarios(nombre, apellido)")
    .eq("modulo", "ventas");
  if (!data || data.length === 0) {
    console.log("  NADIE todavía: las cuatro pantallas redirigen a la portada.");
  } else {
    for (const g of data) {
      const u = g.usuarios as unknown as { nombre: string; apellido: string } | null;
      console.log(`  ${u ? `${u.nombre} ${u.apellido}` : "?"} · ${g.nivel}`);
    }
  }
}

// ── 7. El importador de Excel, de punta a punta ─────────────
// No escribe nada: la previsualización nunca inserta, así que esto corre
// siempre. Arma un .xlsx **en memoria** con las tres situaciones que importan
// —una fila buena, una repetida y una sin razón social—, lo lee con el mismo
// `leerPrimeraHoja` que usa la ruta y le pide el plan contra el padrón real.
//
// Los tests de `importarClientes.test.ts` ya cubren el plan, pero le pasan las
// filas ya parseadas: lo que esto agrega es el tramo que ningún test puede
// ejercitar, que es `exceljs` leyendo un archivo de verdad.
titulo("El importador de Excel (sólo lee)");
{
  const { libroXlsx, leerPrimeraHoja } = await import("../lib/core/excel.ts");
  const { planDeImportacion, encabezadosDeLaPlantilla, normalizarEncabezado } = await import(
    "../lib/ventas/crm/importarClientes.ts"
  );

  const encabezados = encabezadosDeLaPlantilla();
  const fila = (valores: Record<string, string>) => encabezados.map((e) => valores[e] ?? "");

  const libro = await libroXlsx([
    {
      nombre: "Clientes",
      filas: [
        encabezados,
        fila({ "Razón social": "Prueba Uno SRL", CUIT: "30-71044963-1", Estado: "Activo" }),
        fila({ "Razón social": "Prueba Uno bis", CUIT: "30710449631" }),
        fila({ CUIT: "27-23456789-4" }),
      ],
    },
  ]);

  const { filas, encabezados: leidos } = await leerPrimeraHoja(libro);
  if (filas.length === 3) ok(`exceljs leyó las 3 filas y ${leidos.length} encabezados`);
  else mal(`exceljs leyó ${filas.length} filas y esperaba 3`);

  // El padrón real, igual que lo arma la ruta.
  const { data: padron } = await db.from("ventas_clientes").select("cuit, razon_social");
  const plan = planDeImportacion(filas, leidos, {
    cuitsExistentes: new Set(
      (padron ?? []).map((c) => (c.cuit ?? "").replace(/\D/g, "")).filter((c) => c.length === 11)
    ),
    razonesExistentes: new Set((padron ?? []).map((c) => normalizarEncabezado(c.razon_social))),
    usuariosPorNombre: new Map(),
  });

  const estados = plan.filas.map((f) => f.estado).join(", ");
  if (estados === "nueva, repetida, con_problema") {
    ok("el plan dice: nueva, repetida (mismo CUIT) y con_problema (sin razón social)");
  } else {
    mal(`el plan dice «${estados}» y esperaba «nueva, repetida, con_problema»`);
  }
  if (plan.columnas.faltan.length === 0) ok("reconoció las trece columnas de la plantilla");
  else mal(`no reconoció: ${plan.columnas.faltan.join(", ")}`);
}

// ── 8. El ida y vuelta ──────────────────────────────────────
if (!escribir) {
  console.log(
    `\n${fallas === 0 ? "Todo lo que se puede ver sin escribir está bien." : `${fallas} comprobaciones fallaron.`}`
  );
  console.log("Para ejercitar los check, el trigger y la cascada: --escribir\n");
  process.exit(fallas === 0 ? 0 : 1);
}

titulo("Ida y vuelta con datos de prueba");
const MARCA = `ZZZ PRUEBA DEL CRM ${new Date().toISOString()}`;
let clienteId: string | null = null;

try {
  // 7.1 Crear el cliente.
  const { data: cliente, error: errorAlta } = await db
    .from("ventas_clientes")
    .insert({ razon_social: MARCA, cuit: "30710449631", estado: "prospecto" })
    .select("id, numero, creado_en, actualizado_en")
    .single();
  if (errorAlta || !cliente) throw new Error(`no se pudo crear el cliente: ${errorAlta?.message}`);
  clienteId = cliente.id as string;
  ok(`se creó el cliente N° ${cliente.numero}`);

  // 7.2 `actualizado_en` nace en null y lo escribe el trigger, no la ruta.
  if (cliente.actualizado_en === null) ok("actualizado_en nace en null");
  else mal("actualizado_en no nació en null");

  const { data: tocado } = await db
    .from("ventas_clientes")
    .update({ localidad: "Olavarría" })
    .eq("id", clienteId)
    .select("actualizado_en")
    .single();
  if (tocado?.actualizado_en) ok("el trigger escribió actualizado_en al corregir");
  else mal("el trigger NO escribió actualizado_en: la fila miente sobre cuándo se tocó");

  // 7.3 El `unique` del CUIT.
  const { error: choque } = await db
    .from("ventas_clientes")
    .insert({ razon_social: `${MARCA} bis`, cuit: "30710449631" });
  if (choque?.code === "23505") ok("el CUIT repetido rebota con 23505");
  else mal(`el CUIT repetido NO rebotó (${choque?.code ?? "entró"})`);

  // 7.4 Los check de la oportunidad.
  const { error: etapaMala } = await db
    .from("ventas_oportunidades")
    .insert({ cliente_id: clienteId, titulo: "x", etapa: "inventada" });
  if (etapaMala?.code === "23514") ok("una etapa que no existe rebota con 23514");
  else mal(`la etapa inventada NO rebotó (${etapaMala?.code ?? "entró"})`);

  const { error: monedaMala } = await db
    .from("ventas_oportunidades")
    .insert({ cliente_id: clienteId, titulo: "x", moneda: "EUR" });
  if (monedaMala?.code === "23514") ok("una moneda que no es ARS/USD rebota");
  else mal(`la moneda inventada NO rebotó (${monedaMala?.code ?? "entró"})`);

  const { data: oportunidad, error: errorOportunidad } = await db
    .from("ventas_oportunidades")
    .insert({
      cliente_id: clienteId,
      titulo: "Oportunidad de prueba",
      etapa: "cotizada",
      monto_estimado: 100000,
      moneda: "ARS",
    })
    .select("id, numero")
    .single();
  if (errorOportunidad || !oportunidad) throw new Error(`oportunidad: ${errorOportunidad?.message}`);
  ok(`se creó la oportunidad N° ${oportunidad.numero}`);

  // 7.5 El contacto.
  const { data: contacto, error: errorContacto } = await db
    .from("ventas_contactos")
    .insert({ cliente_id: clienteId, nombre: "Contacto de prueba" })
    .select("id")
    .single();
  if (errorContacto || !contacto) throw new Error(`contacto: ${errorContacto?.message}`);
  ok("se creó el contacto");

  // 7.6 El check del próximo paso: los dos juntos o ninguno.
  const { error: pasoAMedias } = await db.from("ventas_actividades").insert({
    cliente_id: clienteId,
    tipo: "llamado",
    resumen: "x",
    proximo_paso: "llamar",
  });
  if (pasoAMedias?.code === "23514") ok("un próximo paso sin fecha rebota con 23514");
  else mal(`el próximo paso a medias NO rebotó (${pasoAMedias?.code ?? "entró"})`);

  const { data: actividad, error: errorActividad } = await db
    .from("ventas_actividades")
    .insert({
      cliente_id: clienteId,
      oportunidad_id: oportunidad.id,
      contacto_id: contacto.id,
      tipo: "visita",
      resumen: "Actividad de prueba",
      proximo_paso: "Volver a llamar",
      proximo_paso_el: new Date().toISOString().slice(0, 10),
    })
    .select("id")
    .single();
  if (errorActividad || !actividad) throw new Error(`actividad: ${errorActividad?.message}`);
  ok("se creó la actividad con su próximo paso");

  // 7.7 Borrar la oportunidad deja la actividad viva, con el enlace en null.
  await db.from("ventas_oportunidades").delete().eq("id", oportunidad.id);
  const { data: huerfana } = await db
    .from("ventas_actividades")
    .select("id, oportunidad_id")
    .eq("id", actividad.id)
    .maybeSingle();
  if (huerfana && huerfana.oportunidad_id === null) {
    ok("al borrar la oportunidad, la actividad queda y su enlace va a null");
  } else if (!huerfana) {
    mal("al borrar la oportunidad se llevó la actividad: debería ser `on delete set null`");
  } else {
    mal("la actividad quedó apuntando a una oportunidad que no existe");
  }

  // 7.8 La cascada del cliente se lleva contactos y actividades.
  await db.from("ventas_clientes").delete().eq("id", clienteId);
  const quedan = await Promise.all([
    db.from("ventas_contactos").select("id", { count: "exact", head: true }).eq("cliente_id", clienteId),
    db.from("ventas_actividades").select("id", { count: "exact", head: true }).eq("cliente_id", clienteId),
  ]);
  if ((quedan[0].count ?? 0) === 0 && (quedan[1].count ?? 0) === 0) {
    ok("borrar el cliente se llevó en cascada su contacto y su actividad");
  } else {
    mal(`la cascada dejó huérfanos: ${quedan[0].count} contactos, ${quedan[1].count} actividades`);
  }
  clienteId = null;
} catch (e) {
  mal((e as Error).message);
} finally {
  // Pase lo que pase, no queda nada. Borra **por id** y sólo lo suyo.
  if (clienteId) {
    const { error } = await db.from("ventas_clientes").delete().eq("id", clienteId);
    console.log(
      error
        ? `  ATENCIÓN: quedó el cliente de prueba ${clienteId} — borralo a mano (${error.message})`
        : "  (se limpió el cliente de prueba que había quedado)"
    );
  }
  // Y el del choque de CUIT, que nunca llegó a entrar pero por las dudas.
  await db.from("ventas_clientes").delete().like("razon_social", "ZZZ PRUEBA DEL CRM%");
}

console.log(`\n${fallas === 0 ? "El CRM quedó bien aplicado." : `${fallas} comprobaciones fallaron.`}\n`);
process.exit(fallas === 0 ? 0 : 1);
