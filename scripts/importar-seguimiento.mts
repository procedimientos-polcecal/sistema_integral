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

// El estado actual de cada RI, para no forzarlo. PostgREST corta en 1000 filas
// sin avisar y son ~1.968 requerimientos, así que se pagina a mano: `traerTodo`
// de `lib/core/paginado.ts` no se puede usar desde un script suelto.
const estadoPorRi = new Map<number, string | null>();
for (let desde = 0; ; desde += 1000) {
  const { data, error } = await supabase
    .from("compras_requerimientos")
    .select("nro_ri, estado_compra")
    .range(desde, desde + 999);
  if (error) throw new Error(error.message);
  for (const fila of data ?? []) estadoPorRi.set(fila.nro_ri, fila.estado_compra);
  if ((data ?? []).length < 1000) break;
}

let listas = 0, sinRi = 0;
const sucias: string[] = [];
const discrepantes: string[] = [];

for (let i = 0; i < filas.length; i++) {
  const r = filaDelHistorico(filas[i]);
  if (!r) { sinRi++; continue; }

  for (const s of r.sucias) sucias.push(`fila ${i + 2} (RI ${r.nro_ri}): ${s}`);

  const estadoActual = estadoPorRi.get(r.nro_ri) ?? null;
  // Sólo se da por recibido lo que el sistema ya sabía comprado. Un RI que
  // figura recibido en la planilla pero acá está en SIN_INICIAR o en
  // comparativa es una discrepancia para mirar, no algo que el importador
  // arregle solo saltándose el circuito: pasarlo a RECIBIDO borraría la
  // pregunta de por qué nunca se marcó como pedido. Se importan sus datos de
  // recepción igual —y su `seguimiento_fila`, así el exportador los sigue
  // manteniendo— y se los informa al final.
  const yaEstabaComprado = estadoActual === "PEDIDO" || estadoActual === "RECIBIDO";
  if (r.fecha_recepcion && !yaEstabaComprado) {
    discrepantes.push(`RI ${r.nro_ri}: estado actual ${estadoActual}, recibido ${r.fecha_recepcion} según la planilla`);
  }

  const cambios = {
    cantidad_comprada: r.cantidad_comprada,
    cantidad_recibida: r.cantidad_recibida,
    fecha_estimada_recepcion: r.fecha_estimada_recepcion,
    fecha_recepcion: r.fecha_recepcion,
    cumplio_compras: r.cumplio_compras,
    cumplio_proveedor: r.cumplio_proveedor,
    // La fila real de la planilla: la 2 del rango leído es la 2 de la hoja.
    seguimiento_fila: i + 2,
    ...(r.fecha_recepcion && yaEstabaComprado ? { estado_compra: "RECIBIDO" } : {}),
  };

  if (ESCRIBE) await supabase.from("compras_requerimientos").update(cambios).eq("nro_ri", r.nro_ri);
  listas++;
}

console.log(`filas con RI: ${listas} | restos de fórmula salteados: ${sinRi}`);
console.log(`celdas que no se pudieron leer y quedan en null: ${sucias.length}`);
sucias.slice(0, 20).forEach((s) => console.log("  " + s));
console.log(`\nRI que la planilla da por recibidos pero el sistema no tenía comprados: ${discrepantes.length}`);
discrepantes.forEach((d) => console.log("  " + d));
console.log("Se importaron sus datos y NO se les cambió el estado: hay que mirarlos a mano.");
console.log(ESCRIBE ? "ESCRITO" : "ensayo: no se escribió nada. Correr con --escribir");
