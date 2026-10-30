import { traerTodo } from "@/lib/core/paginado";
import { cuentaDeServicio, obtenerToken, SCOPE_DRIVE } from "@/lib/core/google";
import type { createAdminClient } from "@/lib/supabase/admin";
import { BUCKET_DE_FOTOS } from "./guardarLaFoto";
import {
  cualesRespaldar,
  diagnosticoDeDrive,
  fallaEsDeLaCarpeta,
  MAXIMO_POR_CORRIDA,
  nombreEnDrive,
  tipoDeLaFoto,
} from "./respaldoDeFotos";

/**
 * Baja cada foto sin respaldar de Storage y la sube a Drive. Una por una.
 *
 * ── LA CARPETA TIENE QUE ESTAR EN UNA UNIDAD COMPARTIDA ─────────────────────
 *
 * Una cuenta de servicio **no tiene cuota de Drive**: subir a «Mi unidad» de
 * una persona falla con *"Service Accounts do not have storage quota"* aunque
 * la carpeta esté compartida como editor. En una unidad compartida el dueño de
 * los archivos es la unidad y no quien sube, y ahí sí entra (de ahí el
 * `supportsAllDrives=true` en cada llamada). Es la misma regla, y el mismo
 * porqué, que `scripts/backup/subir-a-drive.mts` y `SCOPE_DRIVE`.
 *
 * ── CÓMO SE COMPORTA ANTE LOS FALLOS ────────────────────────────────────────
 *
 * - **Una foto que falla no frena a las demás**: queda en null y la corrida
 *   siguiente la vuelve a intentar. Eso es todo el «reintento»: no hay contador
 *   de intentos —la tabla no tiene dónde guardarlo— ni un tope de tres.
 * - **Un fallo de la carpeta sí frena todo** (`fallaEsDeLaCarpeta`): permiso,
 *   cuota, carpeta que no existe, freno de Google. Insistir con las otras
 *   treinta y nueve sólo repetiría el mismo renglón.
 * - **Subir y marcar son dos pasos y el segundo puede fallar solo**, así que
 *   antes de subir se busca en la carpeta un archivo con el mismo nombre (que
 *   lleva el id de la foto): si está, sólo se marca. Sin eso, un fallo al
 *   marcar duplicaría la foto en Drive en cada corrida.
 * - **Nada se traduce al guardarlo** (`diagnosticoDeDrive`): va lo que dijo
 *   Google, y al lado qué tocar.
 *
 * Una foto que falla **siempre** (por ejemplo, si alguien la borró del bucket)
 * ocupa un lugar en la fila de las más viejas en cada corrida. Con el tope de
 * cuarenta eso no alcanza a tapar a las demás mientras haya pocas, y cada una
 * queda nombrada en el resultado para que se vea.
 */

type Admin = ReturnType<typeof createAdminClient>;

/** Lo que el multipart de Drive acepta en un solo pedido. Más arriba hay que pasar a upload reanudable. */
const LIMITE_MULTIPART = 5 * 1024 * 1024;

/**
 * Margen de tiempo: la ruta declara 300 s y a los 240 se corta sola, para
 * devolver el resultado y anotarlo antes de que Vercel mate la función.
 */
const PRESUPUESTO_MS = 240_000;

export interface ResultadoDelRespaldo {
  /** Cuántas había sin respaldar al empezar. */
  pendientes: number;
  /** Cuántas se subieron y quedaron marcadas en esta corrida. */
  respaldadas: number;
  /** Las que fallaron, cada una con lo que dijo quien falló. */
  fallaron: { foto_id: string; error: string }[];
  /** Si algo cortó la corrida antes de recorrer todas, y por qué. */
  cortadaPor: string | null;
}

interface FilaDeFoto {
  id: string;
  ruta: string;
  subida_el: string;
  respaldada_en_drive_el: string | null;
  syh_condiciones: { numero: number | null } | { numero: number | null }[] | null;
}

function numeroDe(fila: FilaDeFoto): number | null {
  const c = Array.isArray(fila.syh_condiciones) ? fila.syh_condiciones[0] : fila.syh_condiciones;
  return c?.numero ?? null;
}

class FallaDeDrive extends Error {
  constructor(
    public estado: number,
    public cuerpo: string,
    mensaje: string
  ) {
    super(mensaje);
  }
}

async function buscarEnLaCarpeta(token: string, carpeta: string, nombre: string): Promise<string | null> {
  const params = new URLSearchParams({
    q: `'${carpeta}' in parents and trashed = false and name = '${nombre.replace(/['\\]/g, "")}'`,
    fields: "files(id)",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
    pageSize: "1",
  });
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const cuerpo = await res.text();
    throw new FallaDeDrive(res.status, cuerpo, diagnosticoDeDrive(res.status, cuerpo, cuentaDeServicio()));
  }
  const datos = (await res.json()) as { files?: { id: string }[] };
  return datos.files?.[0]?.id ?? null;
}

async function subirALaCarpeta(
  token: string,
  carpeta: string,
  nombre: string,
  tipo: string,
  contenido: Buffer
): Promise<void> {
  const limite = "-------sdg-syh-fotos-limite";
  const cuerpo = Buffer.concat([
    Buffer.from(
      `--${limite}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
        JSON.stringify({ name: nombre, parents: [carpeta] }) +
        `\r\n--${limite}\r\nContent-Type: ${tipo}\r\n\r\n`
    ),
    contenido,
    Buffer.from(`\r\n--${limite}--`),
  ]);

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${limite}`,
      },
      body: new Uint8Array(cuerpo),
    }
  );
  if (!res.ok) {
    const texto = await res.text();
    throw new FallaDeDrive(res.status, texto, diagnosticoDeDrive(res.status, texto, cuentaDeServicio()));
  }
}

export async function respaldarLasFotos(admin: Admin, carpeta: string): Promise<ResultadoDelRespaldo> {
  // Las que nunca se respaldaron. Todas, no sólo las primeras cuarenta: la
  // cuenta de «pendientes» tiene que ser verdadera, y la tabla va a crecer.
  const filas = await traerTodo<FilaDeFoto>((desde, hasta) =>
    admin
      .from("syh_fotos")
      .select("id, ruta, subida_el, respaldada_en_drive_el, syh_condiciones(numero)")
      .is("respaldada_en_drive_el", null)
      .order("subida_el", { ascending: true })
      .order("id", { ascending: true })
      .range(desde, hasta)
  );

  const resultado: ResultadoDelRespaldo = {
    pendientes: filas.length,
    respaldadas: 0,
    fallaron: [],
    cortadaPor: null,
  };
  if (filas.length === 0) return resultado;

  const token = await obtenerToken([SCOPE_DRIVE]);
  const empezo = Date.now();

  for (const foto of cualesRespaldar(filas, MAXIMO_POR_CORRIDA)) {
    if (Date.now() - empezo > PRESUPUESTO_MS) {
      resultado.cortadaPor = "se acabó el tiempo de la corrida: el resto sale en la siguiente";
      break;
    }

    try {
      const nombre = nombreEnDrive(foto, numeroDe(foto));

      // ¿Ya está arriba? Pasa si un marcado anterior falló después de subir.
      const yaSubida = await buscarEnLaCarpeta(token, carpeta, nombre);

      if (!yaSubida) {
        const bajada = await admin.storage.from(BUCKET_DE_FOTOS).download(foto.ruta);
        if (bajada.error || !bajada.data) {
          // De esta foto y no de la carpeta: se sigue con la siguiente.
          throw new Error(`No se pudo bajar de Storage (${foto.ruta}): ${bajada.error?.message ?? "sin datos"}`);
        }
        const contenido = Buffer.from(await bajada.data.arrayBuffer());
        if (contenido.length > LIMITE_MULTIPART) {
          throw new Error(
            `La foto pesa ${(contenido.length / 1024 / 1024).toFixed(1)} MB y el respaldo sube hasta 5 MB en un pedido: ` +
              "habría que pasar a upload reanudable."
          );
        }
        await subirALaCarpeta(token, carpeta, nombre, tipoDeLaFoto(foto.ruta), contenido);
      }

      // `.is(null)` para no pisar la fecha de una corrida que se cruzó con ésta.
      const { error } = await admin
        .from("syh_fotos")
        .update({ respaldada_en_drive_el: new Date().toISOString() })
        .eq("id", foto.id)
        .is("respaldada_en_drive_el", null);
      if (error) {
        throw new Error(
          `Subió a Drive pero no se pudo marcar en la base (${error.message}): la próxima corrida la encuentra por el nombre y sólo la marca.`
        );
      }

      resultado.respaldadas += 1;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      resultado.fallaron.push({ foto_id: foto.id, error });

      if (e instanceof FallaDeDrive && fallaEsDeLaCarpeta(e.estado, e.cuerpo)) {
        resultado.cortadaPor = `falla de la carpeta, no de la foto: ${error}`;
        break;
      }
    }
  }

  return resultado;
}
