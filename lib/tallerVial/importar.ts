import { createAdminClient } from "@/lib/supabase/admin";
import { leerValores } from "@/lib/core/sheets";
import { fechaDeSheets } from "@/lib/core/fechaDeSheets";
import { codigoDesdeTextoLibre } from "./equipos";
import { estadoDesdeCodigoSheet } from "./estados";
import { esEcoDeCargaDelSistema } from "./planilla";

/**
 * Trae de dos pestañas de la planilla real de Taller Vial ("DATOS" y
 * "HISTORIAL ESTADOS") lo que se haya cargado ahí. Van dos pivotes:
 *
 * 17/09/2026 — de "se carga desde una pantalla del SdG" a "se carga en la
 * planilla y el SdG espeja" (mismo lugar que Compras/Mantenimiento/Inventario).
 *
 * 18/09/2026 — el usuario cambió de opinión otra vez: quiere cargar desde el
 * SdG (`/api/taller-vial/cargas`, `/api/taller-vial/estados`), pero sin
 * dejar de leer la planilla por si alguien todavía anota ahí. Ver la
 * migración 20260918101859 y `lib/tallerVial/espejo.ts` (el sentido
 * contrario: el SdG escribe en la planilla al cargar).
 *
 * `sincronizarCargasDesdeSheets` sigue siendo un borrar-y-recargar porque
 * `taller_vial_cargas` no tiene clave natural, pero ahora sólo toca las filas
 * con `cargado_por is null` (las de la planilla) — nunca las que nacieron en
 * el SdG. Y salta cualquier fila de la planilla que sea el eco de una carga
 * del SdG (`esEcoDeCargaDelSistema`, columna H de "DATOS"): sin ese salto,
 * la carga que el SdG ya escribió y también exportó a la planilla volvería a
 * entrar como una fila nueva, duplicando litros.
 *
 * `sincronizarEstadosDesdeSheets` no necesita ningún truco parecido: como
 * tiene clave natural (equipo_id, fecha) y ya hacía upsert, la fila que trae
 * la planilla pisa con el mismo valor que el SdG acaba de escribir — no
 * cambia nada en el caso normal.
 *
 * Los services por horómetro (`taller_vial_services`) NO están acá: esos ya
 * se cargaban desde el SdG desde antes — ver `lib/tallerVial/service.ts` y
 * `/api/taller-vial/services`.
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
  /** Filas que son el eco de una carga que ya nació en el SdG — no se cuentan como error, se saltean a propósito. */
  ecoDelSistema: number;
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
  let ecoDelSistema = 0;
  const paraInsertar: {
    equipo_id: string | null;
    equipo_raw: string;
    fecha: string;
    litros: number;
    lectura: number | null;
  }[] = [];

  for (const fila of filas) {
    if (esEcoDeCargaDelSistema(fila)) { ecoDelSistema++; continue; }

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
    // el mismo día— no hay con qué hacer upsert: se borra y se recarga
    // entero, mismo criterio que `cantera_pesadas`. Pero sólo las filas
    // `cargado_por is null`: las que nacieron en el SdG (`cargado_por`
    // puesto) no las escribió este import y no las borra tampoco — si las
    // borrara, la única forma de recuperarlas sería que su eco en "DATOS"
    // volviera a insertarlas, y ya se saltean más arriba (`ecoDelSistema`)
    // para no duplicarlas. Deja una ventana corta entre el delete y el
    // insert donde una lectura ve sólo las filas del SdG; asumido, igual que
    // antes: corre cada 20-30 min por cron.
    const { error: errDel } = await sb.from("taller_vial_cargas").delete().is("cargado_por", null);
    if (errDel) throw new Error(`cargas (borrando lo anterior): ${errDel.message}`);

    const TAMANO_LOTE = 500;
    for (let i = 0; i < paraInsertar.length; i += TAMANO_LOTE) {
      const lote = paraInsertar.slice(i, i + TAMANO_LOTE);
      const { error } = await sb.from("taller_vial_cargas").insert(lote);
      if (error) throw new Error(`cargas (lote ${i}): ${error.message}`);
      filasInsertadas += lote.length;
    }
  }

  return { filasLeidas: filas.length, filasInsertadas, sinFecha, sinLitros, sinEquipoReconocido, ecoDelSistema };
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
