/**
 * Pone en RECIBIDO los requerimientos cuya mercadería ya entró al pañol.
 *
 * ## Por qué existe
 *
 * El `estado_compra` pasa a `RECIBIDO` cuando una persona lo marca en
 * `/compras/seguimiento`, y casi nadie lo marca. Medido el 24/11/2026 sobre
 * los 2.352 requerimientos: 1.646 sí lo dicen —la columna se usa— y **161 ya
 * recibieron mercadería sin que su estado lo diga**. Eso deja a doce pedidos
 * dentro del conjunto reclamable del semáforo y hacía que seis ofrecieran el
 * botón «Reclamar» por cosas guardadas desde agosto.
 *
 * Lo corre una persona a pedido. **No es un cron y no tiene que serlo**: si
 * esto corriera solo, cerrar un pedido dejaría de ser una decisión de quien
 * recibe —que es lo que decidió la migración 048— y pasaría a ser un efecto
 * del kardex. Acá la decisión la toma quien ejecuta el script, una vez, y
 * queda asentada.
 *
 * ## Las cuatro cosas que hubo que comprobar antes de escribir una sola fila
 *
 * 1. **El cambio sobrevive a la sincronización.** En Compras manda la
 *    planilla, y su celda de Estado dice «PEDIDO» para estos 161. Lo que los
 *    protege es `editado_en_app`: el trigger de la 027 lo pone en true cuando
 *    un `update` toca `estado_compra` sin tocar `sheets_sincronizado_en`, y la
 *    importación saltea esas filas. No es una deducción: **los 1.646 RI que ya
 *    están en RECIBIDO tienen los 1.646 la marca en true**, y ninguno de ellos
 *    vuelve a mirar la planilla.
 * 2. **La planilla de origen no hay que tocarla.** `ETIQUETA_ESTADO_COMPRA`
 *    manda `RECIBIDO` a `null` a propósito: el sistema **nunca** escribe ese
 *    estado en la celda. Los otros 1.646 conservan allá su «PEDIDO». Esto no
 *    agrega una divergencia: la reproduce, que es lo que el sistema ya hace.
 * 3. **El libro SEGUIMIENTO sí se escribe, y sólo donde ya hay fila.** De los
 *    161, **7 tienen `seguimiento_fila` y 154 no**: los 154 nunca estuvieron
 *    en ese libro porque llegaron a PEDIDO por la sincronización, que no
 *    exporta allá. Reexportar los 7 mantiene al día lo que ya existe; crear
 *    las otras 154 filas sería completar un libro que hoy no las tiene, y eso
 *    es otra decisión y de otra persona. Por eso el script **no** las crea.
 * 4. **Ninguno está denegado.** Los 161 son `APROBADA`. Igual el filtro
 *    descarta `DENEGADA`: marcar como recibido algo que se negó sería escribir
 *    una contradicción que ningún dato puede explicar después.
 *
 * ## La fecha
 *
 * `fecha_recepcion` sale de la **primera entrada del kardex** y no de hoy. La
 * ruta `PATCH /api/compras/requerimientos/[id]` pone `hoyEnArgentina()` porque
 * ahí la está cargando quien acaba de recibir; acá el dato real existe y está
 * a meses de distancia. Una fecha que se sabe no se reemplaza por una cómoda.
 * Los 5 que ya la tenían cargada la conservan.
 *
 * ## Cómo se usa
 *
 *     npx tsx scripts/marcar-recibidos-del-kardex.mts            # sólo mira
 *     npx tsx scripts/marcar-recibidos-del-kardex.mts --aplicar
 *     npx tsx scripts/marcar-recibidos-del-kardex.mts --revertir <archivo.json>
 *
 * El conjunto se **recalcula contra la base en cada corrida**, nunca sale de
 * una lista pegada acá: una lista escrita hoy describe la base de hoy, y la
 * próxima vez que alguien lo corra va a estar escribiéndole a otros RI.
 *
 * Antes de escribir, guarda el estado anterior de cada fila en un `.json` y
 * dice dónde quedó. `--revertir` lee ese archivo y devuelve cada RI a lo que
 * era, sólo si todavía está como lo dejó esta corrida — si alguien lo movió
 * después, se saltea y se informa.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { llegadasPorRequerimiento, elEstadoNoLoDice } from "../lib/compras/entradaAlPanol";

const RUTA_ENV = process.env.ENV_PATH ?? ".env.local";
for (const linea of readFileSync(RUTA_ENV, "utf8").split("\n")) {
  const m = linea.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  { auth: { persistSession: false } }
);

/** PostgREST corta en 1000 filas y no avisa. */
async function traerTodo<T>(tabla: string, armar: (q: any) => any): Promise<T[]> {
  const filas: T[] = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await armar(db.from(tabla)).range(desde, desde + 999);
    if (error) throw new Error(`${tabla}: ${error.message}`);
    filas.push(...((data ?? []) as T[]));
    if ((data ?? []).length < 1000) break;
  }
  return filas;
}

interface Ri {
  id: string;
  nro_ri: number;
  codigo: string | null;
  descripcion: string | null;
  estado_compra: string | null;
  estado_aprobacion: string | null;
  fecha_recepcion: string | null;
  seguimiento_fila: number | null;
}

/** Lo que hay que saber para devolver una fila a como estaba. */
interface Reversa {
  id: string;
  nro_ri: number;
  estado_compra: string | null;
  fecha_recepcion: string | null;
}

const NOTA = "Recibido según el kardex: la entrada al pañol nombra este RI.";

async function queHayQueMarcar() {
  const ris = await traerTodo<Ri>("compras_requerimientos", (q) =>
    q.select("id, nro_ri, codigo, descripcion, estado_compra, estado_aprobacion, fecha_recepcion, seguimiento_fila")
  );
  const movimientos = await traerTodo<{ requerimiento_id: string; tipo: string; fecha: string | null }>(
    "inventario_movimientos",
    (q) => q.select("requerimiento_id, tipo, fecha").not("requerimiento_id", "is", null)
  );
  const llegadas = llegadasPorRequerimiento(movimientos);

  const objetivo = ris.filter(
    (r) =>
      r.estado_aprobacion !== "DENEGADA" &&
      elEstadoNoLoDice(r.estado_compra) &&
      llegadas.has(r.id)
  );
  return { objetivo, llegadas, total: ris.length };
}

async function mirar(aplicar: boolean) {
  const { objetivo, llegadas, total } = await queHayQueMarcar();
  const porEstado: Record<string, number> = {};
  for (const r of objetivo) porEstado[r.estado_compra ?? "null"] = (porEstado[r.estado_compra ?? "null"] ?? 0) + 1;

  console.log(`Requerimientos: ${total}`);
  console.log(`Ya recibieron y su estado no lo dice: ${objetivo.length}`);
  console.log(`  por estado: ${JSON.stringify(porEstado)}`);
  console.log(`  con fila en SEGUIMIENTO (se reexportan): ${objetivo.filter((r) => r.seguimiento_fila != null).length}`);
  console.log(`  ya tenían fecha_recepcion (se conserva): ${objetivo.filter((r) => r.fecha_recepcion).length}`);

  if (!aplicar) {
    console.log(`\nNo se escribió nada. Para aplicarlo: --aplicar`);
    for (const r of objetivo.slice(0, 10)) {
      console.log(`  RI ${r.nro_ri} ${r.codigo ?? "—"} · ${r.estado_compra} → RECIBIDO el ${llegadas.get(r.id)!.fecha}`);
    }
    if (objetivo.length > 10) console.log(`  … y ${objetivo.length - 10} más`);
    return;
  }

  // El estado anterior va a disco ANTES de escribir, igual que el registro de
  // auditoría va antes del borrado: si no se puede guardar, no se escribe.
  const reversa: Reversa[] = objetivo.map((r) => ({
    id: r.id, nro_ri: r.nro_ri,
    estado_compra: r.estado_compra, fecha_recepcion: r.fecha_recepcion,
  }));
  const archivo = `recibidos-del-kardex-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(archivo, JSON.stringify(reversa, null, 2), "utf8");
  console.log(`\nEstado anterior guardado en ${archivo}`);

  let escritos = 0;
  const fallados: string[] = [];
  for (const r of objetivo) {
    const cambios: Record<string, unknown> = { estado_compra: "RECIBIDO" };
    // La fecha real del kardex, y sólo si no había una cargada a mano.
    if (!r.fecha_recepcion) cambios.fecha_recepcion = llegadas.get(r.id)!.fecha;

    const { error } = await db.from("compras_requerimientos").update(cambios).eq("id", r.id);
    if (error) { fallados.push(`RI ${r.nro_ri}: ${error.message}`); continue; }
    escritos++;

    /*
     * El trigger de la 017 ya dejó la fila del historial con el par
     * anterior → nuevo. Le falta decir de dónde vino: `usuario_id` queda en
     * **null a propósito**, porque nadie decidió esto pedido por pedido, y
     * ponerle un autor haría pasar por decisión de alguien lo que fue un
     * barrido. La nota es lo que lo explica.
     */
    await db
      .from("compras_historial")
      .update({ nota: NOTA })
      .eq("requerimiento_id", r.id)
      .eq("campo", "estado_compra")
      .is("usuario_id", null)
      .is("nota", null);
  }

  console.log(`Marcados en RECIBIDO: ${escritos}`);
  if (fallados.length > 0) {
    console.log(`No se pudieron escribir ${fallados.length}:`);
    for (const f of fallados) console.log(`  ${f}`);
  }

  await exportarLosQueYaEstaban(objetivo.filter((r) => r.seguimiento_fila != null));
}

/**
 * Reexporta al libro SEGUIMIENTO los que ya tenían fila ahí.
 *
 * Sólo ésos: los otros 154 nunca estuvieron en ese libro, y crearles la fila
 * sería completarlo, que es otra decisión. Lo que acá se evita es lo que la
 * regla del repo prohíbe —tocar un campo que se exporta y no exportarlo—: una
 * fila que existe y dice «PEDIDO» cuando la base ya dice otra cosa.
 *
 * Si Google rechaza una, `exportarSeguimiento` deja el motivo en
 * `seguimiento_pendiente` y el cron la reintenta: no hay nada que rehacer a
 * mano.
 */
async function exportarLosQueYaEstaban(conFila: Ri[]) {
  if (conFila.length === 0) return;
  if (!process.env.GOOGLE_SHEETS_SEGUIMIENTO_ID || !process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    console.log(`\nSEGUIMIENTO: faltan credenciales, ${conFila.length} filas quedan sin reexportar.`);
    return;
  }
  const { exportarSeguimiento } = await import("../lib/compras/seguimientoSheets");
  console.log(`\nReexportando ${conFila.length} filas al libro SEGUIMIENTO…`);
  for (const r of conFila) {
    const motivo = await exportarSeguimiento(r.id);
    console.log(`  RI ${r.nro_ri}: ${motivo ?? "ok"}`);
  }
}

async function revertir(archivo: string) {
  const reversa = JSON.parse(readFileSync(archivo, "utf8")) as Reversa[];
  console.log(`Devolviendo ${reversa.length} requerimientos a como estaban.`);

  let vueltos = 0;
  const movidos: number[] = [];
  for (const r of reversa) {
    const { data } = await db
      .from("compras_requerimientos")
      .select("estado_compra")
      .eq("id", r.id)
      .single();
    // Si alguien lo movió después, no se pisa: lo que vino después sabe más
    // que este archivo.
    if (data?.estado_compra !== "RECIBIDO") { movidos.push(r.nro_ri); continue; }

    const { error } = await db
      .from("compras_requerimientos")
      .update({ estado_compra: r.estado_compra, fecha_recepcion: r.fecha_recepcion })
      .eq("id", r.id);
    if (!error) vueltos++;
  }
  console.log(`Vueltos atrás: ${vueltos}`);
  if (movidos.length > 0) {
    console.log(`Salteados porque ya no estaban como los dejó esta corrida: ${movidos.join(", ")}`);
  }
  console.log(`\nOjo: \`editado_en_app\` queda en true. Revertir el estado no lo apaga,`);
  console.log(`y apagarlo haría que la planilla vuelva a pisar esas filas.`);
}

const args = process.argv.slice(2);
const iRevertir = args.indexOf("--revertir");
if (iRevertir >= 0) {
  const archivo = args[iRevertir + 1];
  if (!archivo) {
    console.error("Falta el archivo: --revertir <archivo.json>");
    process.exit(1);
  }
  await revertir(archivo);
} else {
  await mirar(args.includes("--aplicar"));
}
