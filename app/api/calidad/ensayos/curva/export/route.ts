import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { nivelCalidadDe } from "@/lib/calidad/auth";
import { traerMuestra } from "@/lib/calidad/ensayos/consultas";
import { filasDeLaHoja } from "@/lib/calidad/ensayos/hojaDeLaCurva";
import { xlsxConImagenesResponse } from "@/lib/core/xlsxExport";
import type { ImagenDeLaHoja } from "@/lib/core/excel";

/**
 * El Excel de la curva granulométrica de una muestra: la tabla y una foto de
 * los gráficos, para pegar en un informe.
 *
 * **Los números no vienen del navegador.** La ruta lee la muestra y sus
 * retenidos de la base con `traerMuestra(id)` y arma las filas con eso. Del
 * cliente llegan sólo dos cosas: los tamices apagados —que son estado de
 * pantalla y no se guardan en ningún lado— y las imágenes de los gráficos.
 * Aceptar valores medidos en el cuerpo sería dejar que el informe diga otra
 * cosa que la base.
 *
 * **La imagen es un cuerpo que entra y se valida como tal**: empieza con la
 * firma PNG leyendo los bytes —el `type` lo escribe quien manda el archivo— y
 * tiene un tope de tamaño.
 *
 * **Riesgo conocido y asumido:** el servidor no puede saber si el PNG que recibe
 * es el gráfico de esa muestra. Un cliente que mande otro dibujo lo recibe tal
 * cual. Se decidió asumirlo: quien lo hace ya tiene acceso al módulo y sólo
 * consigue un Excel mal armado para sí mismo; los números de la tabla, que son
 * lo que importa, sí salen de la base.
 *
 * Cuerpo `multipart/form-data`:
 *   muestra_id  uuid de la muestra
 *   apagadas    JSON con un array de mallas (opcional; sin él, ninguna)
 *   retenido, acumulado, pasante   PNG de cada gráfico (opcionales, de a uno)
 *
 * Spec: docs/superpowers/specs/2026-11-11-calidad-curva-pasante-y-excel-design.md
 */

/** Los gráficos del Excel, en el orden en que se apilan, con su nombre en el formulario. */
const GRAFICOS = [
  { campo: "retenido", etiqueta: "del retenido" },
  { campo: "acumulado", etiqueta: "del acumulado" },
  { campo: "pasante", etiqueta: "del pasante" },
] as const;

/**
 * Un megabyte por imagen. Un gráfico así pesa unos cientos de kilobytes, y los
 * tres juntos tienen que entrar en los 4,5 MB que Vercel le deja a un cuerpo.
 */
const MAXIMO_POR_IMAGEN = 1024 * 1024;

/** Los primeros ocho bytes de todo PNG. */
const FIRMA_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Ancho al que se escala cada imagen en la hoja, en píxeles: entra en una pantalla sin scroll. */
const ANCHO_EN_LA_HOJA = 640;

/** Alto de una fila de Excel por defecto, en píxeles. */
const ALTO_DE_FILA = 20;

/** Primera columna libre, 0-based: las cinco de la tabla son la A a la E. */
const COLUMNA_DE_LAS_IMAGENES = 6;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function problema(mensaje: string, status = 400) {
  return NextResponse.json({ error: mensaje }, { status });
}

/**
 * Ancho y alto de un PNG, leídos de su cabecera IHDR (bytes 16 a 23).
 * Devuelve `null` si el archivo no es un PNG o su cabecera no dice un tamaño.
 */
function medidasDelPng(bytes: Buffer): { ancho: number; alto: number } | null {
  if (bytes.length < 24) return null;
  if (!FIRMA_PNG.every((b, i) => bytes[i] === b)) return null;
  // Después de la firma viene siempre el trozo IHDR.
  if (bytes.toString("ascii", 12, 16) !== "IHDR") return null;
  const ancho = bytes.readUInt32BE(16);
  const alto = bytes.readUInt32BE(20);
  if (ancho === 0 || alto === 0) return null;
  return { ancho, alto };
}

/** Los tamices apagados: un array JSON de números. Cualquier otra cosa, un problema que dice cuál. */
function leerApagadas(crudo: FormDataEntryValue | null): number[] | { problema: string } {
  if (crudo === null || crudo === "") return [];
  if (typeof crudo !== "string") return { problema: "Las mallas apagadas tienen que ir como texto JSON." };

  let valor: unknown;
  try {
    valor = JSON.parse(crudo);
  } catch {
    return { problema: "Las mallas apagadas no son un JSON válido." };
  }
  if (!Array.isArray(valor) || valor.length > 100) {
    return { problema: "Las mallas apagadas tienen que ser una lista de números." };
  }
  if (!valor.every((m) => typeof m === "number" && Number.isFinite(m))) {
    return { problema: "Las mallas apagadas tienen que ser números." };
  }
  return valor as number[];
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const user = await usuarioActual();
  if (!user) return problema("No autorizado", 401);
  if (!(await nivelCalidadDe(supabase, user.id))) {
    return problema("Sin acceso al módulo Calidad", 403);
  }

  let formulario: FormData;
  try {
    formulario = await request.formData();
  } catch {
    return problema("El cuerpo tiene que ser un formulario con la muestra y los gráficos.");
  }

  const muestraId = formulario.get("muestra_id");
  if (typeof muestraId !== "string" || !UUID.test(muestraId)) {
    return problema("Falta la muestra, o su id no es válido.");
  }

  const apagadas = leerApagadas(formulario.get("apagadas"));
  if ("problema" in apagadas) return problema(apagadas.problema);

  // Las imágenes se validan todas antes de leer nada de la base: si una está
  // mal, no tiene sentido haber ido a buscar la muestra.
  const imagenes: { png: Buffer; ancho: number; alto: number }[] = [];
  for (const { campo, etiqueta } of GRAFICOS) {
    const archivo = formulario.get(campo);
    if (archivo === null) continue;
    if (typeof archivo === "string") {
      return problema(`La imagen ${etiqueta} tiene que ser un archivo y llegó como texto.`);
    }
    if (archivo.size > MAXIMO_POR_IMAGEN) {
      // Redondeado para arriba: un archivo que se pasó por diez bytes no puede
      // decir «pesa 1,0 MB y el máximo es 1».
      const mb = (Math.ceil((archivo.size / 1024 / 1024) * 10) / 10).toFixed(1).replace(".", ",");
      return problema(`La imagen ${etiqueta} pesa ${mb} MB y el máximo es 1.`);
    }
    const png = Buffer.from(await archivo.arrayBuffer());
    const medidas = medidasDelPng(png);
    if (!medidas) {
      return problema(`La imagen ${etiqueta} no es un PNG válido.`);
    }
    imagenes.push({ png, ...medidas });
  }

  const datos = await traerMuestra(supabase, muestraId);
  if (!datos) return problema("No se encontró la muestra.", 404);
  const { muestra, retenidos } = datos;

  const { data: producto } = await supabase
    .from("calidad_ensayos_productos")
    .select("nombre")
    .eq("id", muestra.producto_id)
    .maybeSingle();
  const nombreDelProducto = producto?.nombre ?? "Producto sin nombre";

  const filas = filasDeLaHoja(
    {
      pesoMuestraG: muestra.granulometria_peso_muestra_g,
      retenidos: retenidos.map((r) => ({ malla: r.malla, retenido_g: r.retenido_g })),
    },
    apagadas,
    { producto: nombreDelProducto, fecha: muestra.fecha, observaciones: muestra.observaciones }
  );

  // Las imágenes van a la derecha de la tabla y no debajo: debajo, la nota de
  // las mallas apagadas hace que la tabla mida distinto cada vez y la imagen
  // taparía su última fila.
  let fila = 0;
  const sobreLaHoja: ImagenDeLaHoja[] = imagenes.map(({ png, ancho, alto }) => {
    const anchoFinal = ANCHO_EN_LA_HOJA;
    const altoFinal = Math.round((alto * anchoFinal) / ancho);
    const colocada = { png, fila, columna: COLUMNA_DE_LAS_IMAGENES, ancho: anchoFinal, alto: altoFinal };
    fila += Math.ceil(altoFinal / ALTO_DE_FILA) + 1;
    return colocada;
  });

  // El nombre del archivo no admite barras ni los demás separadores de ruta.
  const productoParaElNombre = nombreDelProducto.replace(/[\\/:*?"<>|]/g, "-");
  return await xlsxConImagenesResponse(`Curva granulométrica - ${productoParaElNombre} - ${muestra.fecha}.xlsx`, [
    {
      nombre: "Curva",
      filas,
      anchos: [24, 14, 14, 14, 14, 3],
      imagenes: sobreLaHoja,
    },
  ]);
}
