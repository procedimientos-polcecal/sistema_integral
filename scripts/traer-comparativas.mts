/**
 * Trae los presupuestos de las comparativas que la planilla tenía anotadas.
 *
 * Es lo mismo que el botón "Comparativas de la planilla" de
 * `/compras/configuracion`, pero de una sola vez: la ruta procesa 20 archivos
 * por llamada para no pasarse del límite de 300s de Vercel, y el histórico son
 * 219 archivos, o sea once apretones. Acá no hay límite de request, así que se
 * drena la cola entera.
 *
 * El vínculo —qué archivo es la comparativa de cada RI— NO se recalcula: ya lo
 * trajo la sincronización, que lee el hipervínculo escondido detrás del "LINK"
 * de la celda. Acá se agrupa por `comparativa_drive_id` y lo único que se hace
 * es abrir cada planilla y leer sus filas.
 *
 * Lo que decide qué entra a la base es el mismo código que usa la app
 * —`leerComparativa`, `mapearEncabezados`, `filasParaEsteRi`, `parsearFila`,
 * `archivosPorHacer`—, importado de `lib/`. Acá vive nada más que el orden en
 * que se llaman: un script que reimplemente el parseo termina guardando otra
 * cosa que la app, y sobre datos de producción eso no se nota hasta mucho
 * después.
 *
 * Un archivo se da por hecho cuando sus RI tienen `comparativa_nombre`, que
 * sale de adentro del archivo: es la prueba de que se abrió. Que un RI no tenga
 * ninguna fila propia es un resultado posible y también cuenta como hecho, si
 * no la cola se tapa sola.
 *
 * Uso:
 *   npx tsx scripts/traer-comparativas.mts              (dry-run, no escribe)
 *   npx tsx scripts/traer-comparativas.mts --aplicar
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const linea of readFileSync(new URL("../.env.local", import.meta.url), "utf-8").split(/\r?\n/)) {
  const m = linea.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

// `leerComparativa` pide el token con las credenciales del entorno; el id de la
// planilla de PEDIDOS DE COMPRA no hace falta acá, porque el vínculo ya está en
// la base.
const { leerComparativa } = await import("../lib/compras/drive.ts");
const { mapearEncabezados, filasParaEsteRi, parsearFila } = await import("../lib/compras/comparativa.ts");
const { archivosPorHacer } = await import("../lib/compras/vincular.ts");
const { claveProveedor } = await import("../lib/compras/sheets.ts");

const APLICAR = process.argv.includes("--aplicar");

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

/** PostgREST corta en 1000 filas y no avisa. */
async function traerTodo<T>(
  consulta: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const todo: T[] = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await consulta(desde, desde + 999);
    if (error) throw new Error(JSON.stringify(error));
    const lote = data ?? [];
    todo.push(...lote);
    if (lote.length < 1000) return todo;
  }
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * El ritmo, que no es un detalle de comodidad.
 *
 * La cuota de lectura de Sheets es de **60 pedidos por minuto y por usuario**
 * —no por proyecto—, y `leerComparativa` son dos llamadas por archivo: la
 * cabecera y los valores. Con medio segundo de pausa esto pide 240 por minuto y
 * Google corta: en el primer dry-run, 62 de 167 archivos volvieron con 429, y
 * el 429 no dice "esperá", dice "no se pudo leer la planilla". Es la misma
 * lección que ya había costado una tarde del lado de la escritura.
 *
 * 2,4s por archivo son ~50 pedidos por minuto: los 167 archivos en unos siete
 * minutos. Nadie está esperando esto en una pantalla.
 */
const PAUSA_MS = 2400;

/**
 * Reintenta lo que no es un error del dato.
 *
 * El 429 es cuota y el 503 es que Google no está: los dos se arreglan
 * esperando, y abandonarlos deja la planilla sin leer con un mensaje que se
 * parece a un problema de permisos. Lo que NO se reintenta es el 403 —falta
 * compartir el archivo— ni un encabezado que no corresponde: eso hay que
 * arreglarlo afuera, y reintentarlo es gastar cuota para volver a fallar.
 */
async function conReintento<T>(que: () => Promise<T>, quien: string): Promise<T> {
  const esperas = [15_000, 30_000, 60_000];
  for (let intento = 0; ; intento++) {
    try {
      return await que();
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : String(e);
      const transitorio = mensaje.includes("429") || mensaje.includes("503");
      if (!transitorio || intento >= esperas.length) throw e;
      const espera = esperas[intento];
      console.log(`    ${quien}: ${mensaje.slice(0, 60)}… reintento en ${espera / 1000}s`);
      await esperar(espera);
    }
  }
}

const ABIERTOS = ["SIN_INICIAR", "EN_COMPARATIVA", "PARA_COMPRAR", "APROBADO", "PEDIDO"];

interface Ri {
  id: string;
  nro_ri: number;
  comparativa_drive_id: string | null;
  comparativa_nombre: string | null;
}

async function main() {
  console.log(APLICAR ? "APLICANDO\n" : "DRY-RUN (no escribe)\n");

  // El padrón de proveedores, una vez. Adentro del bucle serían cientos de
  // consultas para resolver los mismos nombres.
  const proveedores = await traerTodo<{ id: string; nombre: string }>((desde, hasta) =>
    sb.from("proveedores").select("id, nombre").range(desde, hasta)
  );
  const porNombre = new Map(proveedores.map((p) => [claveProveedor(p.nombre), p.id]));

  // Los que todavía tiene sentido mirar: aprobados y sin cerrar. Un denegado o
  // un recibido no se va a volver a abrir. Es el mismo alcance que la ruta.
  const requerimientos = await traerTodo<Ri>((desde, hasta) =>
    sb
      .from("compras_requerimientos")
      .select("id, nro_ri, comparativa_drive_id, comparativa_nombre")
      .eq("estado_aprobacion", "APROBADA")
      .in("estado_compra", ABIERTOS)
      .not("comparativa_drive_id", "is", null)
      .range(desde, hasta)
  );

  const porArchivo = new Map<string, (Ri & { yaVinculado: boolean; yaLeido: boolean })[]>();
  for (const r of requerimientos) {
    const lista = porArchivo.get(r.comparativa_drive_id!) ?? [];
    lista.push({ ...r, yaVinculado: true, yaLeido: r.comparativa_nombre !== null });
    porArchivo.set(r.comparativa_drive_id!, lista);
  }

  const pendientes = archivosPorHacer(porArchivo, true);

  console.log(`${requerimientos.length} requerimientos abiertos con planilla enlazada`);
  console.log(`${porArchivo.size} archivos distintos, ${pendientes.length} por abrir\n`);

  let leidos = 0, intentados = 0, presupuestos = 0, sinProveedor = 0, sinPrecio = 0, ajenasTotal = 0;
  const faltanProveedores = new Map<string, number>();
  const problemas: string[] = [];

  for (const [driveId, ris] of pendientes) {
    let planilla;
    try {
      planilla = await conReintento(
        () => leerComparativa(driveId),
        `RI ${ris[0].nro_ri}`
      );
    } catch (e) {
      problemas.push(
        `RI ${ris.map((r) => r.nro_ri).join(", ")}: no se pudo leer la planilla — ` +
        (e instanceof Error ? e.message : String(e))
      );
      intentados += 1;
      await esperar(PAUSA_MS);
      continue;
    }
    leidos += 1;

    const mapeo = mapearEncabezados(planilla.encabezado);
    if (!mapeo.ok) {
      problemas.push(
        `RI ${ris.map((r) => r.nro_ri).join(", ")}: "${planilla.nombre}" no tiene la forma ` +
        `de una comparativa. Falta: ${mapeo.faltan.join("; ")}`
      );
      // No se marca como leída: la planilla puede tener la forma esperada
      // mañana, cuando alguien le corrija el encabezado.
      intentados += 1;
      await esperar(PAUSA_MS);
      continue;
    }

    for (const ri of ris) {
      const { propias, ajenas } = filasParaEsteRi(planilla.filas, mapeo.idx.nro_ri, ri.nro_ri);
      ajenasTotal += ajenas;

      const nuevas: Record<string, unknown>[] = [];
      for (const { fila, numeroFila } of propias) {
        const leida = parsearFila(fila, mapeo.idx);
        if (!leida) { sinPrecio += 1; continue; }

        const proveedorId = porNombre.get(claveProveedor(leida.proveedor_nombre));
        if (!proveedorId) {
          // La ruta hace lo mismo: no da de alta proveedores en tanda. Un
          // nombre mal escrito en una planilla vieja crearía un proveedor
          // nuevo que después hay que fusionar a mano.
          sinProveedor += 1;
          faltanProveedores.set(
            leida.proveedor_nombre,
            (faltanProveedores.get(leida.proveedor_nombre) ?? 0) + 1
          );
          continue;
        }

        const { proveedor_nombre: _n, ...campos } = leida;
        nuevas.push({
          ...campos,
          requerimiento_id: ri.id,
          proveedor_id: proveedorId,
          origen: "drive",
          drive_fila: numeroFila,
          // Nadie en el sistema cargó estos presupuestos: vienen de la
          // planilla. Estampar el usuario de quien corre el script diría que
          // los cargó él.
          created_by: null,
        });
      }

      presupuestos += nuevas.length;

      if (!APLICAR) continue;

      // Qué presupuesto estaba elegido, para no perderlo al reemplazar: elegir
      // uno ES aprobar la compra, y la fila de la planilla es lo que identifica
      // al presupuesto entre una lectura y la siguiente. La ruta en tanda no lo
      // hacía; la de un RI sí, y es la que tiene razón.
      const { data: previas } = await sb
        .from("compras_cotizaciones")
        .select("drive_fila, elegida")
        .eq("requerimiento_id", ri.id)
        .eq("origen", "drive");

      const elegidas = new Set(
        (previas ?? []).filter((p) => p.elegida).map((p) => p.drive_fila as number)
      );

      await sb
        .from("compras_cotizaciones")
        .delete()
        .eq("requerimiento_id", ri.id)
        .eq("origen", "drive");

      if (nuevas.length > 0) {
        const conEleccion = nuevas.map((n) => ({
          ...n,
          elegida: elegidas.has(n.drive_fila as number),
        }));
        const { error } = await sb.from("compras_cotizaciones").insert(conEleccion);
        if (error) problemas.push(`RI ${ri.nro_ri}: ${error.message}`);
      }

      // El nombre es lo que marca la planilla como abierta. Va aunque no haya
      // entrado ninguna fila: se abrió, y ese es el hecho.
      const { error: errorRi } = await sb
        .from("compras_requerimientos")
        .update({ comparativa_nombre: planilla.nombre })
        .eq("id", ri.id);
      if (errorRi) problemas.push(`RI ${ri.nro_ri} (nombre): ${errorRi.message}`);
    }

    intentados += 1;
    if (intentados % 20 === 0) console.log(`  ${intentados}/${pendientes.length} archivos…`);
    await esperar(PAUSA_MS);
  }

  console.log(`\nArchivos leídos: ${leidos} de ${pendientes.length}`);
  console.log(`Presupuestos: ${presupuestos}`);
  console.log(`Filas sin proveedor en el padrón: ${sinProveedor}`);
  console.log(`Filas sin proveedor o sin precio (no se pueden comparar): ${sinPrecio}`);
  console.log(`Filas de otros RI que se dejaron quietas: ${ajenasTotal}`);

  if (faltanProveedores.size > 0) {
    console.log(`\nProveedores que la planilla nombra y no están en el padrón (${faltanProveedores.size}):`);
    for (const [nombre, veces] of [...faltanProveedores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
      console.log(`  ${veces.toString().padStart(3)} × ${nombre}`);
    }
  }

  if (problemas.length > 0) {
    console.log(`\nProblemas (${problemas.length}):`);
    for (const p of problemas.slice(0, 30)) console.log(`  · ${p}`);
  }
}

await main();
