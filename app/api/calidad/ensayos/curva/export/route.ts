import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { nivelCalidadDe } from "@/lib/calidad/auth";
import { traerMuestra } from "@/lib/calidad/ensayos/consultas";
import { TOPE_DE_MUESTRAS, type MuestraParaComparar } from "@/lib/calidad/ensayos/comparacion";
import { filasDeLaHoja, leerApagadas } from "@/lib/calidad/ensayos/hojaDeLaCurva";
import { colocarImagenes, medidasDelPng } from "@/lib/calidad/ensayos/imagenesDeLaHoja";
import { xlsxConImagenesResponse } from "@/lib/core/xlsxExport";

/**
 * El Excel de la curva granulométrica: la tabla y una foto de los gráficos,
 * para pegar en un informe. Acepta hasta `TOPE_DE_MUESTRAS` muestras, que es lo
 * que la pantalla deja comparar.
 *
 * **Los números no vienen del navegador.** La ruta lee cada muestra y sus
 * retenidos de la base con `traerMuestra(id)` y arma las filas con eso. Del
 * cliente llegan sólo tres cosas: los ids, los tamices apagados —que son estado
 * de pantalla y no se guardan en ningún lado— y las imágenes de los gráficos.
 * Aceptar valores medidos en el cuerpo sería dejar que el informe diga otra
 * cosa que la base.
 *
 * **La imagen es un cuerpo que entra y se valida como tal**: empieza con la
 * firma PNG leyendo los bytes —el `type` lo escribe quien manda el archivo— y
 * tiene un tope de tamaño.
 *
 * **Riesgo conocido y asumido:** el servidor no puede saber si el PNG que recibe
 * es el gráfico de esas muestras. Un cliente que mande otro dibujo lo recibe
 * tal cual. Se decidió asumirlo: quien lo hace ya tiene acceso al módulo y sólo
 * consigue un Excel mal armado para sí mismo; los números de la tabla, que son
 * lo que importa, sí salen de la base.
 *
 * Cuerpo `multipart/form-data`:
 *   muestras    JSON con un array de uuid, de 1 a TOPE_DE_MUESTRAS
 *   muestra_id  uuid de una sola muestra — la forma vieja, que se sigue
 *               aceptando para que una pantalla abierta durante el despliegue
 *               no quede rota
 *   apagadas    JSON con un array de mallas (opcional; sin él, ninguna)
 *   retenido, acumulado, pasante   PNG de cada gráfico (opcionales, de a uno)
 *
 * Specs: docs/superpowers/specs/2026-11-11-calidad-curva-pasante-y-excel-design.md
 *        docs/superpowers/specs/2026-11-19-calidad-curva-comparar-muestras-design.md
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

/**
 * Columna de la primera imagen, 0-based (A = 0). La tabla larga ocupa de la A a
 * la F, la G queda de separador angosto y por eso las imágenes arrancan en la
 * H, que es el índice 7.
 */
const COLUMNA_DE_LAS_IMAGENES = 7;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function problema(mensaje: string, status = 400) {
  return NextResponse.json({ error: mensaje }, { status });
}

/**
 * Los ids que pide el formulario, por la forma nueva o la vieja.
 *
 * Se valida que sean UUID acá y no se delega en la base: un id cualquiera
 * haría una consulta que no encuentra nada y contestaría 404, que dice algo
 * distinto de «lo que mandaste no es un id».
 */
function leerIds(formulario: FormData): string[] | { problema: string } {
  const crudo = formulario.get("muestras");
  const unaSola = formulario.get("muestra_id");

  let ids: unknown;
  if (typeof crudo === "string" && crudo !== "") {
    try {
      ids = JSON.parse(crudo);
    } catch {
      return { problema: "Las muestras no son un JSON válido." };
    }
  } else if (typeof unaSola === "string" && unaSola !== "") {
    ids = [unaSola];
  } else {
    return { problema: "Falta la muestra." };
  }

  if (!Array.isArray(ids) || ids.length === 0) {
    return { problema: "Las muestras tienen que ser una lista con al menos una." };
  }
  if (ids.length > TOPE_DE_MUESTRAS) {
    return { problema: `Son ${TOPE_DE_MUESTRAS} muestras como máximo y llegaron ${ids.length}.` };
  }
  if (!ids.every((id) => typeof id === "string" && UUID.test(id))) {
    return { problema: "Alguna de las muestras no tiene un id válido." };
  }
  return ids as string[];
}

/** Con una muestra, el producto y su fecha; con varias, cuántas son y el día de hoy. */
function nombreDelArchivo(muestras: MuestraParaComparar[]): string {
  if (muestras.length === 1) {
    // El nombre del archivo no admite barras ni los demás separadores de ruta.
    const producto = muestras[0].producto.replace(/[\\/:*?"<>|]/g, "-");
    return `Curva granulométrica - ${producto} - ${muestras[0].fecha}.xlsx`;
  }
  const hoy = new Date().toISOString().slice(0, 10);
  return `Curva granulométrica - ${muestras.length} muestras - ${hoy}.xlsx`;
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
    return problema("El cuerpo tiene que ser un formulario con las muestras y los gráficos.");
  }

  const ids = leerIds(formulario);
  if ("problema" in ids) return problema(ids.problema);

  const apagadas = leerApagadas(formulario.get("apagadas"));
  if ("problema" in apagadas) return problema(apagadas.problema);

  // Las imágenes se validan todas antes de leer nada de la base: si una está
  // mal, no tiene sentido haber ido a buscar las muestras.
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
      return problema(`La imagen ${etiqueta} pesa ${mb} MB y el máximo es 1 MB.`);
    }
    const png = Buffer.from(await archivo.arrayBuffer());
    const medidas = medidasDelPng(png);
    if (!medidas) {
      return problema(`La imagen ${etiqueta} no es un PNG válido.`);
    }
    imagenes.push({ png, ...medidas });
  }

  // De a una y no con un `.in()`: son seis como mucho por el tope, y un `.in()`
  // con muchos ids arma una URL que PostgREST rechaza con un 400 sin decir por
  // qué. El orden es el que mandó el cliente, que es el de la pantalla.
  const traidas = await Promise.all(ids.map((id) => traerMuestra(supabase, id)));
  if (traidas.some((d) => d === null)) {
    return problema("No se encontró alguna de las muestras.", 404);
  }

  const nombres = new Map<string, string>();
  const muestras: MuestraParaComparar[] = [];
  for (const datos of traidas) {
    const { muestra, retenidos } = datos!;

    if (!nombres.has(muestra.producto_id)) {
      const { data: producto } = await supabase
        .from("calidad_ensayos_productos")
        .select("nombre")
        .eq("id", muestra.producto_id)
        .maybeSingle();
      nombres.set(muestra.producto_id, producto?.nombre ?? "Producto sin nombre");
    }

    muestras.push({
      id: muestra.id,
      producto: nombres.get(muestra.producto_id)!,
      fecha: muestra.fecha,
      observaciones: muestra.observaciones,
      pesoMuestraG: muestra.granulometria_peso_muestra_g,
      retenidos: retenidos.map((r) => ({ malla: r.malla, retenido_g: r.retenido_g })),
    });
  }

  const filas = filasDeLaHoja(muestras, apagadas);

  // Las imágenes van a la derecha de la tabla y no debajo: debajo, la nota de
  // las mallas apagadas hace que la tabla mida distinto cada vez y la imagen
  // taparía su última fila.
  const sobreLaHoja = colocarImagenes(imagenes, COLUMNA_DE_LAS_IMAGENES);

  return await xlsxConImagenesResponse(nombreDelArchivo(muestras), [
    {
      nombre: "Curva",
      filas,
      // La B la comparten «Producto» del encabezado y «Malla» de la tabla, y
      // ahora tiene a la C ocupada: con 10 se recortaba «Despacho a Kartonsec».
      anchos: [30, 22, 14, 18, 14, 13, 3],
      imagenes: sobreLaHoja,
    },
  ]);
}
