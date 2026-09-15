/**
 * El banco de pruebas del lector de QR: corre contra una carpeta de facturas de
 * verdad y dice cuántas se leen solas.
 *
 * ## Por qué existe, y por qué no hay tests que lo reemplacen
 *
 * La búsqueda del QR **no se puede probar con un fixture inventado**. Lo que
 * decide si una factura se lee no es la lógica —que sí tiene tests— sino cómo la
 * imprimió el emisor: si dejó zona de silencio, qué tan chico salió el QR, si el
 * PDF lo estira. Eso sólo lo dicen las facturas reales.
 *
 * ## Corre las mismas funciones que el navegador
 *
 * `buscarQr`, `buscarQrConZxing` y `buscarQrConVentanas` se importan de `lib/`,
 * no se copian. Lo único que cambia es de dónde salen los píxeles —acá
 * `@napi-rs/canvas` en vez de un `<canvas>`— y de dónde sale el wasm de ZXing
 * —del disco, porque en Node no hay a quién pedírselo por HTTP—. Las dos son
 * costuras que los módulos ya tenían previstas.
 *
 * **Y medir acá no alcanza**: este mismo banco dio por buena una pasada que en
 * el navegador no hacía nada (las imágenes embebidas del PDF). Lo que se mide
 * acá hay que comprobarlo después en un navegador de verdad.
 *
 * ## Cómo se corre
 *
 *   npm i --no-save @napi-rs/canvas
 *   npx tsx scripts/banco-de-qr.mts "G:/…/FACTURAS/SEPTIEMBRE 2026"
 *
 * Con `--detalle` lista factura por factura en vez de sólo el resumen.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import type { PDFPageProxy } from "pdfjs-dist";
import { buscarQr, buscarQrConVentanas, type PixelesDe } from "../lib/facturacion/escaneoQr";
import { buscarQrConZxing, leerConZxing, type Lector } from "../lib/facturacion/escaneoQrZxing";
import { leerQrAfip } from "../lib/facturacion/qrAfip";
import { filasDeTexto } from "../lib/facturacion/leerArchivo";
import { leerCabeceraDelTexto } from "../lib/facturacion/cabeceraDelTexto";

/** Los CUIT del grupo: es lo que separa al emisor del receptor en el texto. */
const CUITS_DEL_GRUPO = ["30641068019", "30707285008"];

/** Los mismos de `leerArchivo.ts`. Si cambian allá, tienen que cambiar acá. */
const ANCHOS = [1600, 2600, 3600];
const ANCHO_DE_VENTANAS = 3000;
const PAGINAS_MAXIMAS = 3;

type Pasada = "página dibujada" | "segundo decodificador" | "ventanas" | "texto del PDF" | null;

interface Resultado {
  archivo: string;
  pasada: Pasada;
  ancho: number | null;
  cuit: string | null;
  /** Lo que salió del texto, cuando hubo QR con qué compararlo. */
  control?: { campo: string; qr: unknown; texto: unknown }[];
  importe?: number | null;
  ms: number;
  error?: string;
  /** Qué campos no se pudieron sacar del texto, cuando tampoco hubo QR. */
  falta?: string[];
}

async function lectorDeZxing(): Promise<Lector> {
  const { readBarcodes, prepareZXingModule } = await import("zxing-wasm/reader");
  const wasmBinary = await readFile(
    join(import.meta.dirname, "..", "node_modules", "zxing-wasm", "dist", "reader", "zxing_reader.wasm")
  );
  // En el navegador el wasm se baja de `/pdfjs/`; acá se le pasan los bytes.
  await prepareZXingModule({
    overrides: { wasmBinary: new Uint8Array(wasmBinary).buffer },
    fireImmediately: true,
  });
  return (p) => leerConZxing(readBarcodes as never, p);
}

function pixelesDe(ctx: SKRSContext2D, ancho: number, alto: number): PixelesDe {
  return {
    width: ancho,
    height: alto,
    getImageData: (x, y, w, h) => ctx.getImageData(x, y, w, h) as unknown as ReturnType<PixelesDe["getImageData"]>,
  };
}

async function dibujar(pagina: PDFPageProxy, ancho: number) {
  const base = pagina.getViewport({ scale: 1 });
  const viewport = pagina.getViewport({ scale: ancho / base.width });

  const lienzo = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = lienzo.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, lienzo.width, lienzo.height);

  // El canvas de `@napi-rs/canvas` cumple la interfaz que pdf.js usa, pero no
  // es el del DOM: el cast es por los tipos, no por el comportamiento.
  await pagina.render({
    // `canvas: null` es lo que pdf.js pide cuando se le da el contexto y no el
    // lienzo, que es el único camino acá: el de `@napi-rs/canvas` cumple la
    // interfaz pero no es un `HTMLCanvasElement`. El cast es por los tipos.
    canvas: null,
    canvasContext: ctx as unknown as CanvasRenderingContext2D,
    viewport,
    intent: "print",
  }).promise;
  return { ctx, ancho: lienzo.width, alto: lienzo.height };
}

async function medirUna(ruta: string, lector: Lector): Promise<Resultado> {
  const desde = Date.now();
  const archivo = ruta.split(/[\\/]/).pop() ?? ruta;

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const documento = await pdfjs.getDocument({
    data: new Uint8Array(await readFile(ruta)),
    /*
     * Las fuentes estándar hay que dárselas: en el navegador pdf.js las trae de
     * su propio bundle y acá no hay de dónde. Sin esto la página se dibuja con
     * la tipografía que sea —al QR no le importa, pero el aviso tapa la salida y
     * un renderizado incompleto podría, sí, mover un recorte—.
     */
    standardFontDataUrl: join(import.meta.dirname, "..", "node_modules", "pdfjs-dist", "standard_fonts") + "/",
    /*
     * Y el wasm de JBIG2/JPEG2000, por la misma razón y con más consecuencia:
     * **sin esto, una factura escaneada se dibuja sin su imagen** y el banco la
     * cuenta como "no se lee" cuando en el navegador se lee perfecto. Es la
     * trampa de este banco, y ya invalidó una corrida: 38 avisos sobre 10
     * imágenes. En el navegador pdf.js resuelve su propio wasm y no hace falta.
     */
    wasmUrl: join(import.meta.dirname, "..", "node_modules", "pdfjs-dist", "wasm") + "/",
    useSystemFonts: false,
  }).promise;

  const hasta = Math.min(documento.numPages, PAGINAS_MAXIMAS);

  const salida = async (pasada: Pasada, ancho: number | null, textos: string[]): Promise<Resultado> => {
    const leidos = textos.map((t) => leerQrAfip(t));
    const qr = leidos.find((x): x is Extract<typeof x, { ok: true }> => x.ok)?.cabecera ?? null;
    const base = {
      archivo,
      pasada,
      ancho,
      cuit: qr?.cuitEmisor ?? null,
      importe: qr?.importeTotal ?? null,
      ms: Date.now() - desde,
    };
    if (!controlar || !qr) return base;

    /*
     * El control que hace posible confiar en el lector de texto: **cada factura
     * que sí trae QR es un banco de pruebas**. Se lee el texto igual y se compara
     * contra lo que firmó ARCA, que es la verdad. Un importe equivocado no se
     * nota nunca, así que esto es lo que separa "el texto encontró algo" de "el
     * texto encontró lo correcto".
     */
    const filas = await filasDeTexto(documento, hasta);
    const t = leerCabeceraDelTexto(filas, CUITS_DEL_GRUPO).parcial;
    const control = [
      { campo: "cuit", qr: qr.cuitEmisor, texto: t.cuitEmisor },
      { campo: "punto de venta", qr: qr.puntoVenta, texto: t.puntoVenta },
      { campo: "número", qr: qr.numero, texto: t.numero },
      { campo: "fecha", qr: qr.fecha, texto: t.fecha },
      { campo: "importe", qr: qr.importeTotal, texto: t.importeTotal },
    ].filter((c) => c.texto !== null && String(c.qr) !== String(c.texto));

    return { ...base, control };
  };

  for (let n = 1; n <= hasta; n++) {
    const pagina = await documento.getPage(n);

    for (const ancho of ANCHOS) {
      const { ctx, ancho: w, alto: h } = await dibujar(pagina, ancho);
      const px = pixelesDe(ctx, w, h);

      const conJsQr = buscarQr(px);
      if (conJsQr.length) return await salida("página dibujada", ancho, conJsQr);

      const conZxing = await buscarQrConZxing(px, lector);
      if (conZxing.length) return await salida("segundo decodificador", ancho, conZxing);
    }
  }

  const pagina = await documento.getPage(1);
  const { ctx, ancho: w, alto: h } = await dibujar(pagina, ANCHO_DE_VENTANAS);
  const conVentanas = buscarQrConVentanas(pixelesDe(ctx, w, h));
  if (conVentanas.length) return await salida("ventanas", ANCHO_DE_VENTANAS, conVentanas);

  /*
   * Sin QR queda el texto del PDF, que es lo que cubre a los emisores que no
   * imprimen el bloque de ARCA. Es la misma función que corre el navegador, con
   * las mismas filas: `filasDeTexto` se exporta justamente para esto.
   */
  const filas = await filasDeTexto(documento, hasta);
  const delTexto = leerCabeceraDelTexto(filas, CUITS_DEL_GRUPO);
  if (delTexto.cabecera) {
    return {
      archivo,
      pasada: "texto del PDF",
      ancho: null,
      cuit: delTexto.cabecera.cuitEmisor,
      importe: delTexto.cabecera.importeTotal,
      ms: Date.now() - desde,
    };
  }

  return {
    archivo,
    pasada: null,
    ancho: null,
    cuit: null,
    ms: Date.now() - desde,
    falta: delTexto.falta,
  };
}

const carpeta = process.argv[2];
if (!carpeta) {
  console.error('Falta la carpeta. Ej: npx tsx scripts/banco-de-qr.mts "G:/…/SEPTIEMBRE 2026"');
  process.exit(1);
}
const detallado = process.argv.includes("--detalle");
/** Compara el lector de texto contra el QR en las que traen los dos. */
const controlar = process.argv.includes("--controlar");

const archivos = (await readdir(carpeta))
  .filter((f) => f.toLowerCase().endsWith(".pdf"))
  .sort();

console.log(`${archivos.length} PDF en ${carpeta}\n`);

const lector = await lectorDeZxing();
const resultados: Resultado[] = [];

for (const f of archivos) {
  try {
    const r = await medirUna(join(carpeta, f), lector);
    resultados.push(r);
    if (detallado) {
      console.log(
        `${(r.pasada ?? "—").padEnd(22)} ${String(r.ancho ?? "").padStart(5)} ${String(r.ms).padStart(6)} ms  ${r.archivo}`
      );
    } else {
      process.stdout.write(r.pasada === null ? "·" : r.pasada === "página dibujada" ? "." : r.pasada === "segundo decodificador" ? "Z" : r.pasada === "ventanas" ? "v" : "T");
    }
  } catch (e) {
    resultados.push({ archivo: f, pasada: null, ancho: null, cuit: null, ms: 0, error: (e as Error).message });
    if (!detallado) process.stdout.write("!");
  }
}

const cuantas = (p: Pasada) => resultados.filter((r) => r.pasada === p).length;
const leidas = resultados.filter((r) => r.pasada !== null);
const tiempos = resultados.map((r) => r.ms).sort((a, b) => a - b);

console.log(`\n\n── de ${resultados.length} facturas ──`);
console.log(`  se leen solas:             ${leidas.length} (${((100 * leidas.length) / resultados.length).toFixed(0)}%)`);
console.log(`    página dibujada (jsQR):  ${cuantas("página dibujada")}`);
console.log(`    segundo decodificador:   ${cuantas("segundo decodificador")}`);
console.log(`    ventanas:                ${cuantas("ventanas")}`);
console.log(`    texto del PDF (sin QR):  ${cuantas("texto del PDF")}`);
console.log(`  no se leen:                ${cuantas(null)}`);
console.log(`  errores al abrir el PDF:   ${resultados.filter((r) => r.error).length}`);
console.log(`\n  mediana ${tiempos[Math.floor(tiempos.length / 2)]} ms · peor caso ${tiempos[tiempos.length - 1]} ms`);

const porAncho = new Map<number, number>();
for (const r of leidas) if (r.ancho) porAncho.set(r.ancho, (porAncho.get(r.ancho) ?? 0) + 1);
console.log(`  por ancho: ${[...porAncho.entries()].sort((a, b) => a[0] - b[0]).map(([a, n]) => `${a}px:${n}`).join(" · ")}`);

const porTexto = resultados.filter((r) => r.pasada === "texto del PDF");
if (porTexto.length) {
  console.log(`
── las que salieron del texto, sin QR ──`);
  for (const r of porTexto) {
    const importe = r.importe === null || r.importe === undefined ? "sin importe" : r.importe.toFixed(2);
    console.log(`  ${String(r.cuit ?? "sin cuit").padEnd(12)} ${importe.padStart(14)}  ${r.archivo}`);
  }
}

const rescatadas = resultados.filter((r) => r.pasada === "segundo decodificador");
if (rescatadas.length) {
  console.log(`\n── las que rescató el segundo decodificador ──`);
  for (const r of rescatadas) console.log(`  ${String(r.ancho).padStart(5)}px  ${r.archivo}`);
}

const perdidas = resultados.filter((r) => r.pasada === null);
if (perdidas.length) {
  console.log(`\n── las que siguen sin leerse ──`);
  for (const r of perdidas) {
    console.log(`  ${r.error ? "ERROR " + r.error.slice(0, 40) + "  " : ""}${r.archivo}`);
    if (r.falta?.length) console.log(`       del texto sale todo menos: ${r.falta.join(", ")}`);
  }
}

if (controlar) {
  const conControl = resultados.filter((r) => r.control);
  const discrepantes = conControl.filter((r) => r.control!.length);
  console.log(`
── control del lector de texto contra el QR ──`);
  console.log(`  facturas con QR y con texto: ${conControl.length}`);
  console.log(`  coinciden en todo lo que el texto pudo leer: ${conControl.length - discrepantes.length}`);
  for (const r of discrepantes) {
    console.log(`  ${r.archivo}`);
    for (const c of r.control!) console.log(`     ${c.campo}: QR ${JSON.stringify(c.qr)} · texto ${JSON.stringify(c.texto)}`);
  }
}
