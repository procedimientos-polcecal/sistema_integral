import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { usuarioActual } from "@/lib/core/sesion";
import { nivelCalidadDe } from "@/lib/calidad/auth";
import { traerMuestra } from "@/lib/calidad/ensayos/consultas";
import { filasDeLaHoja, leerApagadas } from "@/lib/calidad/ensayos/hojaDeLaCurva";
import { colocarImagenes, medidasDelPng } from "@/lib/calidad/ensayos/imagenesDeLaHoja";
import { xlsxConImagenesResponse } from "@/lib/core/xlsxExport";

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

/**
 * Columna de la primera imagen, 0-based (A = 0). La tabla ocupa de la A a la E,
 * la F queda de separador angosto y por eso las imágenes arrancan en la G, que
 * es el índice 6.
 */
const COLUMNA_DE_LAS_IMAGENES = 6;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function problema(mensaje: string, status = 400) {
  return NextResponse.json({ error: mensaje }, { status });
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
      return problema(`La imagen ${etiqueta} pesa ${mb} MB y el máximo es 1 MB.`);
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
  const sobreLaHoja = colocarImagenes(imagenes, COLUMNA_DE_LAS_IMAGENES);

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
