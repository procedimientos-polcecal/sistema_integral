// ¿Los cuatro espejos están bien configurados? **No borra nada.**
//
// POR QUÉ EXISTE
//
// `borrarLoQueLaPlanillaNoTrajo` recibe los nombres de las columnas en texto,
// porque la tabla es distinta en cada sincronización. Eso significa que un
// nombre mal escrito **no lo atrapa el compilador**: aparece recién cuando
// alguien aprieta el botón, en una corrida que además borra.
//
// Esto los ejercita contra la base de verdad con un sello que no coincide con
// ninguna fila. Así toda la tabla queda como candidata, el freno salta y no se
// borra nada — pero en el camino se resuelven el `select`, la paginación, el
// conteo y las cinco columnas de cada espejo. Si una está mal escrita, acá se
// ve.
//
// Uso:
//   npx tsx scripts/ensayo-borrado-espejos.mts
import { readFileSync } from "node:fs";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf-8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const { createAdminClient } = await import("../lib/supabase/admin.ts");
import type { EspejoBorrable } from "../lib/core/borradoDeEspejo.ts";
const { borrarLoQueLaPlanillaNoTrajo } = await import("../lib/core/borradoDeEspejo.ts");

/*
 * Los mismos cuatro que usan las sincronizaciones. Se repiten acá a propósito:
 * si alguien cambia uno allá y no acá, este ensayo deja de probar lo que se
 * usa y es mejor que se note como una diferencia que leer que "pasó".
 */
const ESPEJOS: EspejoBorrable[] = [
  {
    tabla: "ordenes_trabajo", numero: "ot_number", sincronizado: "synced_at",
    creada: "created_at_app", fila: "sheets_row",
    deLaApp: { columna: "app_created", valor: true },
    modulo: "mantenimiento", entidad: "orden_trabajo",
  },
  {
    tabla: "avisos", numero: "oa_number", sincronizado: "synced_at",
    creada: "created_at", fila: "sheets_row",
    deLaApp: { columna: "app_created", valor: true },
    modulo: "mantenimiento", entidad: "aviso",
  },
  {
    tabla: "ordenes_servicio", numero: "os_number", sincronizado: "synced_at",
    creada: "created_at", fila: "sheets_row",
    deLaApp: { columna: "app_created", valor: true },
    modulo: "mantenimiento", entidad: "orden_servicio",
  },
  {
    tabla: "compras_requerimientos", numero: "nro_ri", sincronizado: "sheets_sincronizado_en",
    creada: "created_at", fila: "sheets_fila",
    deLaApp: { columna: "origen", valor: "app" },
    editada: "editado_en_app",
    modulo: "compras", entidad: "requerimiento",
  },
];

const sb = createAdminClient();
// Un sello que no tiene ninguna fila: todas quedan como candidatas.
const NINGUNA = "1970-01-01T00:00:00.000Z";

let malas = 0;
for (const espejo of ESPEJOS) {
  const antes = (await sb.from(espejo.tabla).select("id", { count: "exact", head: true })).count ?? 0;

  const r = await borrarLoQueLaPlanillaNoTrajo(sb, espejo, {
    cuando: NINGUNA,
    inicio: new Date().toISOString(),
  });

  const despues = (await sb.from(espejo.tabla).select("id", { count: "exact", head: true })).count ?? 0;

  const intacta = antes === despues && r.borradas === 0;
  const freno = (r.aviso ?? "").startsWith("No se borró nada");
  const bien = intacta && freno;
  if (!bien) malas++;

  console.log(`${bien ? "OK  " : "MAL "} ${espejo.tabla}: ${antes} filas antes, ${despues} después`);
  console.log(`      ${r.aviso ?? "(sin aviso)"}`);
}

console.log(malas === 0
  ? "\nLos cuatro espejos resuelven sus columnas y el freno los detuvo a los cuatro."
  : `\n${malas} espejo(s) no se comportaron como debían.`);
process.exit(malas === 0 ? 0 : 1);
