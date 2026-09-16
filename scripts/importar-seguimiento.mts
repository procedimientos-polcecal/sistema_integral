// Importa el histórico del libro SEGUIMIENTO DE COMPRA a
// `compras_requerimientos`. Se corre UNA VEZ.
//
// Uso:
//   npx tsx scripts/importar-seguimiento.mts            # ensayo: lee y cuenta
//   npx tsx scripts/importar-seguimiento.mts --escribir # escribe
//
// NO EXPORTA, a propósito. Esas 1.757 filas ya están en la planilla: es de
// donde salen. Reescribirlas no agregaría nada y correría el riesgo de tocar
// la columna MAIL_ENVIADO, que le mandaría el aviso al área de nuevo.
//
// Medido el 15/09/2026 antes de escribir esto: las 1.757 filas cruzan por NºRI
// contra la base sin un solo huérfano, así que no hay nada que adivinar.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { leerValores } from "../lib/core/sheets.ts";
import { filaDelHistorico } from "../lib/compras/seguimiento.ts";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf-8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const ESCRIBE = process.argv.includes("--escribir");

const filas = await leerValores(process.env.GOOGLE_SHEETS_SEGUIMIENTO_ID!, "COMPRAS CON RI!A2:M");
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

let listas = 0, sinRi = 0;
const sucias: string[] = [];

for (let i = 0; i < filas.length; i++) {
  const r = filaDelHistorico(filas[i]);
  if (!r) { sinRi++; continue; }

  for (const s of r.sucias) sucias.push(`fila ${i + 2} (RI ${r.nro_ri}): ${s}`);

  const cambios = {
    cantidad_comprada: r.cantidad_comprada,
    cantidad_recibida: r.cantidad_recibida,
    fecha_estimada_recepcion: r.fecha_estimada_recepcion,
    fecha_recepcion: r.fecha_recepcion,
    cumplio_compras: r.cumplio_compras,
    cumplio_proveedor: r.cumplio_proveedor,
    // La fila real de la planilla: la 2 del rango leído es la 2 de la hoja.
    seguimiento_fila: i + 2,
    // Con fecha de recepción, el RI está recibido. Sin ella sigue esperando, y
    // su estado queda como está: los 10 que no están en PEDIDO se importan con
    // el suyo. El seguimiento describe lo que pasó, no corrige el circuito.
    ...(r.fecha_recepcion ? { estado_compra: "RECIBIDO" } : {}),
  };

  if (ESCRIBE) await supabase.from("compras_requerimientos").update(cambios).eq("nro_ri", r.nro_ri);
  listas++;
}

console.log(`filas con RI: ${listas} | restos de fórmula salteados: ${sinRi}`);
console.log(`celdas que no se pudieron leer y quedan en null: ${sucias.length}`);
sucias.slice(0, 20).forEach((s) => console.log("  " + s));
console.log(ESCRIBE ? "ESCRITO" : "ensayo: no se escribió nada. Correr con --escribir");
