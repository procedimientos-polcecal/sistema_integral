// Qué movería la tanda de «pasar a comparativa», contra la base real. SÓLO LEE.
//
// POR QUÉ EXISTE
//
// La pantalla y la ruta están detrás del login, y la acción **escribe en
// producción**: no se puede probar apretando el botón. Lo que sí se puede es
// correr la decisión —`motivoPorElQueNoPasa()`, el único lugar donde está
// escrita— contra los pedidos de verdad, y ver a cuántos alcanza y por qué
// deja afuera a los demás.
//
// Imprime además las dos cuentas que hacen falta para entender la tanda antes
// de dispararla: cuántos pedidos quedan sin la marca de `editado_en_app` —o
// sea, a cuántos los saca de la mano de la planilla— y cuántas filas de
// historial sin autor tienen esos pedidos, que es lo que explica por qué el
// `update` del historial pide tres condiciones y no una.
//
// Uso:
//   npx tsx scripts/probar-pase-a-comparativa.mts
//
// Necesita las claves de Supabase en `.env.local`. No escribe nada.
import { readFileSync, existsSync } from "node:fs";

const env = new URL("../.env.local", import.meta.url);
if (existsSync(env)) {
  for (const line of readFileSync(env, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const { createAdminClient } = await import("../lib/supabase/admin.ts");
const { repartirSegunPuedenPasar } = await import("../lib/compras/pasarAComparativa.ts");

const db = createAdminClient();
const titulo = (t: string) => console.log(`\n── ${t} ${"─".repeat(Math.max(0, 66 - t.length))}`);

async function todo<T>(tabla: string, select: string): Promise<T[]> {
  const filas: T[] = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await db.from(tabla).select(select).range(desde, desde + 999);
    if (error) {
      console.error(`No se pudo leer ${tabla}:`, error.message);
      process.exit(1);
    }
    filas.push(...(data as T[]));
    if (data.length < 1000) return filas;
  }
}

type Ri = {
  id: string;
  nro_ri: number | null;
  estado_compra: string;
  estado_aprobacion: string;
  editado_en_app: boolean | null;
  fecha: string | null;
  descripcion: string | null;
};

const pedidos = await todo<Ri>(
  "compras_requerimientos",
  "id, nro_ri, estado_compra, estado_aprobacion, editado_en_app, fecha, descripcion"
);

titulo("a quiénes alcanza");
const { pasan, noPasan } = repartirSegunPuedenPasar(pedidos);
console.log(`  ${pasan.length} de ${pedidos.length} pedidos pueden pasar a comparativa`);

const motivos: Record<string, number> = {};
for (const n of noPasan) motivos[n.motivo] = (motivos[n.motivo] ?? 0) + 1;
console.log("  los demás, por qué no:");
for (const [motivo, cuantos] of Object.entries(motivos).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${String(cuantos).padStart(5)}  ${motivo}`);
}

titulo("los cinco que más esperan");
for (const r of [...pasan].sort((a, b) => (a.nro_ri ?? 0) - (b.nro_ri ?? 0)).slice(0, 5)) {
  const completo = pedidos.find((p) => p.id === r.id)!;
  console.log(
    `  RI ${String(r.nro_ri).padStart(4)}  ${String(completo.fecha).slice(0, 10)}  ` +
      `${(completo.descripcion ?? "").slice(0, 46)}`
  );
}

// Lo que la tanda le hace a la planilla. El trigger marca `editado_en_app` al
// cambiar `estado_compra`, y desde ahí la importación deja de pisar el pedido:
// cuántos todavía no lo tienen es cuántos cambian de dueño de una sola vez.
titulo("cuántos salen de la mano de la planilla");
const sinMarcar = pasan.filter((r) => !pedidos.find((p) => p.id === r.id)!.editado_en_app);
console.log(`  ${sinMarcar.length} de ${pasan.length} todavía no tienen editado_en_app`);

// Por qué el update del historial pide tres condiciones. Un `.in()` con sólo
// `usuario_id is null` alcanzaría a todas estas filas viejas.
titulo("el historial que un `in` + `is null` pisaría");
type Hist = { requerimiento_id: string; campo: string; usuario_id: string | null };
const historial = await todo<Hist>("compras_historial", "requerimiento_id, campo, usuario_id");
const objetivo = new Set(pasan.map((r) => r.id));
const expuestas = historial.filter((h) => objetivo.has(h.requerimiento_id) && !h.usuario_id);
console.log(
  `  ${historial.filter((h) => !h.usuario_id).length} de ${historial.length} filas del historial no tienen autor`
);
console.log(`  de esos pedidos, ${expuestas.length} filas viejas quedarían firmadas por error`);
const porCampo: Record<string, number> = {};
for (const h of expuestas) porCampo[h.campo] = (porCampo[h.campo] ?? 0) + 1;
console.log("  y son de estos campos:", JSON.stringify(porCampo));
