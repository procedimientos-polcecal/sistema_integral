import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { noSePudoAveriguar, puedeEditarVentas } from "@/lib/ventas/auth";
import { leerPrimeraHoja } from "@/lib/core/excel";
import { traerTodo } from "@/lib/core/paginado";
import { normalizarCuit } from "@/lib/core/cuit";
import {
  normalizarEncabezado,
  planDeImportacion,
  type ContextoDeImportacion,
} from "@/lib/ventas/crm/importarClientes";

/**
 * Previsualizar un Excel de clientes. **No escribe nada.**
 *
 * Devuelve el plan: qué filas se crearían, cuáles ya están, cuáles están
 * repetidas dentro del archivo y cuáles tienen un problema. Recién después,
 * con lo que la persona vio en pantalla, `importar/confirmar` escribe.
 *
 * Que la previsualización sea una ruta aparte y no un parámetro de la de
 * escritura es a propósito: un `?dry_run=0` que se manda mal escribe 300
 * clientes, y no hay forma de equivocarse llamando a una ruta que no inserta.
 * Es la misma forma que ya tiene la importación de empleados de RRHH.
 *
 * ── EL CONTEXTO SE LEE ACÁ Y VIAJA AL PLAN ──────────────────
 *
 * Qué CUITs y qué razones sociales ya existen, y los usuarios activos para
 * resolver el vendedor. Se leen enteros con `traerTodo()` —PostgREST corta en
 * 1000 filas sin avisar— y el cruce lo hace una función pura con tests, no esta
 * ruta: así «ya existe» quiere decir exactamente lo mismo en la pantalla, en el
 * plan y en el test.
 */

/** Un Excel de varios cientos de filas y la lectura del padrón entero. */
export const maxDuration = 120;

/**
 * Lo que entra por el formulario. Cuatro megas es más que suficiente para un
 * padrón de clientes —el de 300 filas pesa decenas de kilobytes— y queda por
 * debajo del corte de 4,5 MB que Vercel aplica al cuerpo **antes** de invocar
 * la función: pasarse devuelve un 413 que esta ruta no contesta y nadie
 * entiende.
 */
const MAXIMO = 4 * 1024 * 1024;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const permiso = await puedeEditarVentas(supabase, user.id);
  if (!permiso.ok) return noSePudoAveriguar(permiso);
  if (!permiso.si) {
    return NextResponse.json({ error: "No tenés permiso para cargar clientes" }, { status: 403 });
  }

  const formulario = await request.formData().catch(() => null);
  const archivo = formulario?.get("archivo");
  if (!(archivo instanceof File)) {
    return NextResponse.json({ error: "Falta el archivo" }, { status: 400 });
  }
  if (archivo.size === 0) {
    return NextResponse.json({ error: "El archivo está vacío" }, { status: 400 });
  }
  if (archivo.size > MAXIMO) {
    return NextResponse.json(
      {
        error:
          `El archivo pesa ${(archivo.size / 1024 / 1024).toFixed(1)} MB y el máximo es 4 MB. ` +
          `Un padrón de clientes no debería acercarse: fijate si no tiene imágenes pegadas.`,
      },
      { status: 400 }
    );
  }

  let filas: Record<string, unknown>[];
  let encabezados: string[];
  try {
    const hoja = await leerPrimeraHoja(await archivo.arrayBuffer());
    filas = hoja.filas;
    encabezados = hoja.encabezados;
  } catch (e) {
    // Lo que dijo la librería, sin traducir: un .xls viejo, un archivo que no
    // es un Excel o uno corrupto fallan distinto, y un mensaje genérico no
    // deja distinguirlos.
    return NextResponse.json(
      { error: `No se pudo leer el Excel: ${(e as Error).message}` },
      { status: 400 }
    );
  }

  let contexto: ContextoDeImportacion;
  try {
    const [clientes, usuarios] = await Promise.all([
      traerTodo((desde, hasta) =>
        supabase.from("ventas_clientes").select("cuit, razon_social").range(desde, hasta)
      ),
      traerTodo((desde, hasta) =>
        supabase
          .from("usuarios")
          .select("id, nombre, apellido, activo")
          .eq("activo", true)
          .range(desde, hasta)
      ),
    ]);

    contexto = {
      cuitsExistentes: new Set(
        clientes
          .map((c) => normalizarCuit(c.cuit as string | null))
          .filter((c): c is string => c !== null)
      ),
      razonesExistentes: new Set(
        clientes.map((c) => normalizarEncabezado(c.razon_social as string))
      ),
      usuariosPorNombre: new Map(
        usuarios.map((u) => [
          normalizarEncabezado(`${u.nombre} ${u.apellido}`),
          u.id as string,
        ])
      ),
    };
  } catch (e) {
    // No se puede previsualizar contra un padrón que no se pudo leer: diría que
    // todo es nuevo, y confirmar eso duplicaría el padrón entero.
    return NextResponse.json(
      { error: `No se pudo leer el padrón para comparar: ${(e as Error).message}` },
      { status: 503 }
    );
  }

  return NextResponse.json({ plan: planDeImportacion(filas, encabezados, contexto) });
}
