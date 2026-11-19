// Comprueba que la migración *_reprogramaciones_de_ot.sql quedó aplicada.
//
// ESCRIBE EN LA BASE DE PRODUCCIÓN, a propósito: inserta una fila de prueba
// sobre una OT real y la borra, porque un trigger sólo se verifica desde
// afuera viéndolo contar para arriba y para abajo. Borra primero y recién
// después relee el contador; si no volvió a donde estaba, imprime el número de
// la OT y sale 1 — una orden real que dijera «Reprog. ×1» sin historial es lo
// que hay que evitar.
//
// Uso: npx tsx scripts/comprobar-reprogramaciones.mts
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const l of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Falta NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

let fallo = false;
const ok = (m: string) => console.log("  OK     " + m);
const mal = (m: string) => {
  console.log("  FALTA  " + m);
  fallo = true;
};

// 1. La tabla responde.
// Sin `head: true`: un HEAD que falla no trae cuerpo y supabase-js lo devuelve
// sin error, o sea que una tabla inexistente pasaría por buena.
const t = await db.from("mant_reprogramaciones_ot").select("id", { count: "exact" }).limit(1);
if (t.error) mal(`la tabla mant_reprogramaciones_ot no responde: ${t.error.message}`);
else ok(`la tabla mant_reprogramaciones_ot responde (${t.count} filas)`);

// 2. La columna existe.
const c = await db.from("ordenes_trabajo").select("id, ot_number, reprogramada_veces").limit(1);
if (c.error) mal(`ordenes_trabajo.reprogramada_veces no existe: ${c.error.message}`);
else ok("ordenes_trabajo.reprogramada_veces existe");

// 3. El trigger cuenta para arriba y para abajo.
if (fallo || !c.data?.length) {
  mal("no se puede probar el trigger sin las dos comprobaciones anteriores");
} else {
  const ot = c.data[0] as { id: string; ot_number: number | string; reprogramada_veces: number };
  const leer = async () =>
    (await db.from("ordenes_trabajo").select("reprogramada_veces").eq("id", ot.id).single()).data
      ?.reprogramada_veces as number | undefined;
  const antes = await leer();
  const ins = await db
    .from("mant_reprogramaciones_ot")
    .insert({
      ot_id: ot.id,
      fecha_anterior: null,
      fecha_nueva: "2000-01-01",
      origen: "sistema",
      justificacion: "prueba de comprobar-reprogramaciones",
    })
    .select("id")
    .single();
  if (ins.error) {
    mal(`no se pudo insertar la fila de prueba: ${ins.error.message}`);
  } else {
    const subio = await leer();
    // Borra primero, y recién después juzga.
    const del = await db.from("mant_reprogramaciones_ot").delete().eq("id", ins.data.id);
    const despues = await leer();
    if (del.error || despues !== antes) {
      console.error(
        `\n  *** LA OT ${ot.ot_number} (id ${ot.id}) PUEDE HABER QUEDADO CON EL CONTADOR TORCIDO ***\n` +
          `  antes=${antes} despues=${despues} borrado=${del.error?.message ?? "ok"}\n` +
          `  Revisarla a mano: select * from mant_reprogramaciones_ot where ot_id = '${ot.id}';\n`,
      );
      fallo = true;
    } else if (subio !== (antes ?? 0) + 1) {
      mal(`el trigger no sumó: antes=${antes}, tras insertar=${subio}`);
    } else {
      ok(`el trigger cuenta: OT ${ot.ot_number} fue ${antes} → ${subio} → ${despues}`);
    }
  }
}

console.log(fallo ? "\nHAY ALGO QUE FALTA." : "\nTodo en su lugar.");
process.exit(fallo ? 1 : 0);
