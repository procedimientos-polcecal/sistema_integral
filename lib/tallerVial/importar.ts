import { createAdminClient } from "@/lib/supabase/admin";
import { leerValores } from "@/lib/core/sheets";
import { fechaDeSheets } from "@/lib/core/fechaDeSheets";
import { codigoDesdeTextoLibre } from "./equipos";
import { estadoDesdeCodigoSheet } from "./estados";

/**
 * Espejo de dos pestañas de la planilla real de Taller Vial: "DATOS" (cargas
 * de combustible) y "HISTORIAL ESTADOS" (OP/FS/OCF por día). Pivote del
 * 17/09/2026: la primera versión de este módulo dejaba cargar desde una
 * pantalla del SdG ("de acá en adelante manda el SdG", como Producción o
 * Despacho); el usuario aclaró que quiere lo contrario — sigue cargando en la
 * planilla, y el SdG sólo espeja para mostrar tablas y verlas más fácil.
 * Mismo cambio de dirección que tuvieron Compras/Mantenimiento/Inventario
 * desde el principio.
 *
 * Los services por horómetro (`taller_vial_services`) NO están acá: esos sí
 * se cargan desde el SdG, a pedido del usuario — ver `lib/tallerVial/service.ts`
 * y `/api/taller-vial/services`.
 *
 * Reusa `scripts/importar-taller-vial-historico.mts`, que ahora es un
 * envoltorio de esto — mismo patrón que `cantera/importarAcarreo.ts` con su
 * script y su cron.
 */

const LIBRO = () => process.env.GOOGLE_SHEETS_TALLER_VIAL_ID || "1P1bZb3CxDgR_EulR8-lXUJTNsIZLu5rMVLh-VIY6N4g";

export interface ResultadoSincronizacionCargas {
  filasLeidas: number;
  filasInsertadas: number;
  sinFecha: number;
  sinLitros: number;
  sinEquipoReconocido: number;
}

/**
 * `escribir: false` sólo lee y cuenta —para ensayar—; `true` además escribe.
 * El cron siempre llama con `true`.
 */
export async function sincronizarCargasDesdeSheets(escribir: boolean): Promise<ResultadoSincronizacionCargas> {
  const libro = LIBRO();
  const sb = createAdminClient();

  const { data: equiposDB, error: errEquipos } = await sb.from("equipos").select("id, code").ilike("code", "EM%");
  if (errEquipos) throw new Error(`equipos: ${errEquipos.message}`);
  const idPorCodigo = new Map<string, string>((equiposDB ?? []).map((e) => [e.code as string, e.id as string]));

  const valores = await leerValores(libro, "DATOS");
  const filas = valores.slice(1); // sin encabezado

  let sinFecha = 0;
  let sinLitros = 0;
  let sinEquipoReconocido = 0;
  const paraInsertar: {
    equipo_id: string | null;
    equipo_raw: string;
    fecha: string;
    litros: number;
    lectura: number | null;
  }[] = [];

  for (const fila of filas) {
    const [fechaRaw, equipoRaw, litrosRaw, lecturaRaw] = fila;

    const fecha = fechaDeSheets(fechaRaw);
    if (!fecha) { sinFecha++; continue; }

    const litros = Number(String(litrosRaw ?? "").replace(",", "."));
    if (!isFinite(litros) || litros <= 0) { sinLitros++; continue; }

    const equipoRawLimpio = String(equipoRaw ?? "").trim();
    const codigo = codigoDesdeTextoLibre(equipoRawLimpio);
    // No es una de las filas sueltas de combustible que no son de un equipo
    // móvil ("empresa piparo", "sección hornos"): se guardan igual, sin
    // equipo, para no perder litros del total y poder avisar que hay que
    // revisarlas — ver el comentario grande de la migración.
    const equipoId = codigo ? idPorCodigo.get(codigo) ?? null : null;
    if (!equipoId) sinEquipoReconocido++;

    const lecturaNum = lecturaRaw === undefined || lecturaRaw === "" ? null : Number(String(lecturaRaw).replace(",", "."));

    paraInsertar.push({
      equipo_id: equipoId,
      equipo_raw: equipoRawLimpio,
      fecha,
      litros,
      lectura: lecturaNum !== null && isFinite(lecturaNum) ? lecturaNum : null,
    });
  }

  let filasInsertadas = 0;
  if (escribir) {
    // Sin clave natural —un mismo equipo puede cargar combustible dos veces
    // el mismo día— no hay con qué hacer upsert: se borra todo y se recarga
    // entero cada vez, mismo criterio que `cantera_pesadas`. Es seguro porque
    // la tabla es 100% reproducible desde "DATOS" —nada acá lo carga a
    // mano—, pero deja una ventana corta entre el delete y el insert donde
    // una lectura ve la tabla vacía. Asumido: corre cada 20-30 min por cron,
    // así que la ventana es frecuente pero de segundos.
    const { error: errDel } = await sb.from("taller_vial_cargas").delete().not("id", "is", null);
    if (errDel) throw new Error(`cargas (borrando lo anterior): ${errDel.message}`);

    const TAMANO_LOTE = 500;
    for (let i = 0; i < paraInsertar.length; i += TAMANO_LOTE) {
      const lote = paraInsertar.slice(i, i + TAMANO_LOTE);
      const { error } = await sb.from("taller_vial_cargas").insert(lote);
      if (error) throw new Error(`cargas (lote ${i}): ${error.message}`);
      filasInsertadas += lote.length;
    }
  }

  return { filasLeidas: filas.length, filasInsertadas, sinFecha, sinLitros, sinEquipoReconocido };
}

export interface ResultadoSincronizacionEstados {
  filasLeidas: number;
  celdasEscritas: number;
  sinFecha: number;
  columnasSinEquipo: string[];
  codigosSinMapear: Set<string>;
}

/**
 * Espejo de "HISTORIAL ESTADOS": una matriz fecha × equipo (una columna por
 * equipo, con OP/FS/OCF en cada celda). A diferencia de las cargas, esto SÍ
 * tiene clave natural —un equipo tiene un solo estado por día— así que es un
 * upsert por (equipo_id, fecha) y no un borrar-y-recargar entero.
 */
export async function sincronizarEstadosDesdeSheets(escribir: boolean): Promise<ResultadoSincronizacionEstados> {
  const libro = LIBRO();
  const sb = createAdminClient();

  const { data: equiposDB, error: errEquipos } = await sb.from("equipos").select("id, code").ilike("code", "EM%");
  if (errEquipos) throw new Error(`equipos: ${errEquipos.message}`);
  const idPorCodigo = new Map<string, string>((equiposDB ?? []).map((e) => [e.code as string, e.id as string]));

  const valores = await leerValores(libro, "HISTORIAL ESTADOS");
  const [encabezado, ...filas] = valores;

  // Columna → equipo_id, sólo para las columnas cuyo encabezado empieza con
  // un código EM conocido (la columna 0 es "FECHA").
  const columnasSinEquipo: string[] = [];
  const equipoPorColumna = new Map<number, string>();
  for (let col = 1; col < encabezado.length; col++) {
    const codigo = codigoDesdeTextoLibre(encabezado[col] ?? "");
    const equipoId = codigo ? idPorCodigo.get(codigo) : undefined;
    if (equipoId) equipoPorColumna.set(col, equipoId);
    else if (encabezado[col]) columnasSinEquipo.push(encabezado[col]);
  }

  let sinFecha = 0;
  const codigosSinMapear = new Set<string>();
  const paraInsertar: { equipo_id: string; fecha: string; estado: string }[] = [];

  for (const fila of filas) {
    const fecha = fechaDeSheets(fila[0]);
    if (!fecha) { sinFecha++; continue; }

    for (const [col, equipoId] of equipoPorColumna) {
      const celda = (fila[col] ?? "").trim();
      if (!celda) continue; // sin dato ese día para ese equipo, no se inventa
      const estado = estadoDesdeCodigoSheet(celda);
      if (!estado) { codigosSinMapear.add(celda); continue; }
      paraInsertar.push({ equipo_id: equipoId, fecha, estado });
    }
  }

  let celdasEscritas = 0;
  if (escribir && paraInsertar.length > 0) {
    const TAMANO_LOTE = 500;
    for (let i = 0; i < paraInsertar.length; i += TAMANO_LOTE) {
      const lote = paraInsertar.slice(i, i + TAMANO_LOTE);
      const { error } = await sb.from("taller_vial_estados_diarios").upsert(lote, { onConflict: "equipo_id,fecha" });
      if (error) throw new Error(`estados (lote ${i}): ${error.message}`);
      celdasEscritas += lote.length;
    }
  }

  return { filasLeidas: filas.length, celdasEscritas, sinFecha, columnasSinEquipo, codigosSinMapear };
}
