/**
 * Traer de la planilla lo que la sección Envases espeja.
 *
 * LA PLANILLA MANDA, al revés que el resto de Producción. El stock del listado
 * es una fórmula sobre el kardex, así que es el stock consolidado correcto: acá
 * se lee y se anota cuándo. El SdG no lo calcula.
 *
 * Es también **la carga inicial**: la primera corrida trae todo. No hay un
 * importador aparte — un script `.mjs` no podría usar el parser de
 * `planilla.ts` y habría que duplicarlo sin tests, que es cómo las dos copias
 * se separan.
 *
 * Vive en `lib` y no dentro de la ruta porque lo van a llamar dos cosas con
 * permisos distintos: el botón, que exige sesión, y el reloj, que no tiene
 * ninguna.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { registrarSincronizacion } from "@/lib/core/sincronizaciones";
import { leerValores } from "@/lib/core/sheets";
import { traerTodo } from "@/lib/core/paginado";
import { indiceDeProveedores, buscarProveedor } from "@/lib/core/proveedores";
import { normalizarCuit } from "@/lib/core/cuit";
import {
  mapearListado, mapearKardex, filaDeArticulo, filaDeMovimiento, filaDeProveedor,
  type ArticuloLeido, type MovimientoLeido, type ProveedorLeido,
} from "@/lib/produccion/envases/planilla";

type Datos = Record<string, unknown>;

export type Resultado =
  | { ok: true; datos: Datos }
  | { ok: false; status: number; error: string; datos?: Datos };

const logra = (datos: Datos): Resultado => ({ ok: true, datos });
const falla = (status: number, error: string): Resultado => ({ ok: false, status, error });
const mensaje = (e: unknown) => (e instanceof Error ? e.message : String(e));

const PLANILLA = () => process.env.GOOGLE_SHEETS_ENVASES_ID ?? "";
const TAB_LISTADO = () => process.env.GOOGLE_SHEETS_ENVASES_TAB ?? "Listado articulos GRAL";
/** Lleva **doble espacio**, que es como está en la planilla. */
const TAB_KARDEX = () => process.env.GOOGLE_SHEETS_ENVASES_TAB_MOV ?? "Entradas  Salidas";
const TAB_PROV = () => process.env.GOOGLE_SHEETS_ENVASES_TAB_PROV ?? "PROVEEDORES";
const TAB_REF = () => process.env.GOOGLE_SHEETS_ENVASES_TAB_REF ?? "REFERENCIAS";

/**
 * A qué proveedor del núcleo corresponde uno de la pestaña.
 *
 * **Primero por CUIT y después por nombre**: el CUIT identifica sin ambigüedad
 * y el nombre no —"Torraco Pablo Javier" en esta pestaña es "Flexi Rigs" en las
 * facturas—. Si ninguno de los dos lo reconoce, `null`: enlazar al que se le
 * parece pone el gasto en el proveedor que no es y no se nota nunca.
 *
 * Exportada y pura para poder probarla: es una decisión, no plomería.
 */
export function enlazarProveedor(
  porCuit: Map<string, string>,
  porNombre: Map<string, string>,
  p: { nombre: string; cuit: string | null }
): string | null {
  if (p.cuit) {
    const porDocumento = porCuit.get(p.cuit);
    if (porDocumento) return porDocumento;
  }
  return buscarProveedor(porNombre, p.nombre);
}

/**
 * Traer de la planilla, y que un fallo diga qué pasó.
 *
 * Adentro casi todo devuelve `falla(...)` con un motivo, pero los `traerTodo`
 * **lanzan**, y una excepción que sube hasta la ruta se convierte en un 500 sin
 * cuerpo: la pantalla no encuentra `error` y muestra su texto de reserva, que
 * no distingue una tabla que falta de Google caído de un permiso mal dado.
 */
export async function sincronizarEnvases(): Promise<Resultado> {
  try {
    return await traerDeLaPlanilla();
  } catch (e) {
    const detalle = mensaje(e);
    await registrarSincronizacion({
      modulo: "produccion", recurso: "envases_movimientos", ok: false, error: detalle,
    });
    return falla(500, detalle);
  }
}

async function traerDeLaPlanilla(): Promise<Resultado> {
  const planilla = PLANILLA();
  if (!planilla) return falla(503, "Falta configurar GOOGLE_SHEETS_ENVASES_ID");

  const admin = createAdminClient();

  // ── El listado: artículos y su stock ───────────────────────
  let filasListado: string[][];
  try {
    filasListado = await leerValores(planilla, TAB_LISTADO(), { sinFormato: true });
  } catch (e) {
    return falla(502, `No se pudo leer «${TAB_LISTADO()}»: ${mensaje(e)}`);
  }
  if (filasListado.length < 2) {
    return falla(502, `La pestaña «${TAB_LISTADO()}» vino vacía. No se toca nada.`);
  }

  const idxListado = mapearListado(filasListado[0]);
  if (idxListado.codigo < 0) {
    return falla(502, `«${TAB_LISTADO()}» no tiene una columna de código reconocible.`);
  }

  const articulos: ArticuloLeido[] = [];
  const vistos = new Set<string>();
  let repetidos = 0;
  for (let i = 1; i < filasListado.length; i++) {
    const a = filaDeArticulo(filasListado[i], idxListado, i + 1);
    if (!a) continue;
    // El código es unique: dos filas iguales harían fallar el lote entero con
    // "ON CONFLICT DO UPDATE command cannot affect row a second time".
    if (vistos.has(a.codigo)) { repetidos++; continue; }
    vistos.add(a.codigo);
    articulos.push(a);
  }

  // ── El kardex ──────────────────────────────────────────────
  let filasKardex: string[][];
  try {
    filasKardex = await leerValores(planilla, TAB_KARDEX(), { sinFormato: true });
  } catch (e) {
    return falla(502, `El listado se leyó; el kardex «${TAB_KARDEX()}» no: ${mensaje(e)}`);
  }

  const idxKardex = filasKardex.length ? mapearKardex(filasKardex[0]) : {};
  const movimientos: MovimientoLeido[] = [];
  for (let i = 1; i < filasKardex.length; i++) {
    const m = filaDeMovimiento(filasKardex[i], idxKardex, i + 1);
    if (m) movimientos.push(m);
  }

  // ── El grupo de cada artículo, desde la K ──────────────────
  //
  // La K es una fórmula sobre el código, así que todas las filas de un mismo
  // código tienen que decir lo mismo. Cuando no lo dicen —o cuando el artículo
  // no tiene ninguna fila— el grupo queda en null y se informa: enlazarlo al
  // que se le parece pone el artículo en el total que no es y no se nota nunca.
  const gruposPorCodigo = new Map<string, Set<string>>();
  for (const m of movimientos) {
    if (!m.grupo_raw) continue;
    const s = gruposPorCodigo.get(m.codigo) ?? new Set<string>();
    s.add(m.grupo_raw);
    gruposPorCodigo.set(m.codigo, s);
  }

  const sinGrupo: string[] = [];
  const grupoEnDisputa: string[] = [];
  const grupoDe = (codigo: string): string | null => {
    const s = gruposPorCodigo.get(codigo);
    if (!s || s.size === 0) { sinGrupo.push(codigo); return null; }
    if (s.size > 1) { grupoEnDisputa.push(`${codigo}: ${[...s].join(" / ")}`); return null; }
    return [...s][0];
  };

  const ahora = new Date().toISOString();
  let guardadosArticulos = 0;
  for (let i = 0; i < articulos.length; i += 500) {
    const lote = articulos.slice(i, i + 500).map((a) => ({
      ...a,
      grupo: grupoDe(a.codigo),
      stock_sincronizado_en: ahora,
    }));
    const { error } = await admin
      .from("produccion_envases_articulos")
      .upsert(lote, { onConflict: "codigo" });
    if (error) {
      await registrarSincronizacion({
        modulo: "produccion", recurso: "envases_articulos", ok: false, error: error.message,
      });
      return falla(400, error.message);
    }
    guardadosArticulos += lote.length;
  }

  // ── Los proveedores y las referencias ──────────────────────
  // Un fallo en cualquiera de las dos no corta la sincronización: los artículos
  // y el kardex, que son lo que se mira todos los días, ya entraron o están por
  // entrar. Se informa y se sigue.
  const { proveedores: guardadosProveedores, sinEnlazar, error: errorProveedores } =
    await sincronizarProveedores(admin, planilla);
  const referencias = await sincronizarReferencias(admin, planilla);

  // ── Los movimientos ────────────────────────────────────────
  const porCodigo = new Map(
    (await traerTodo<{ id: string; codigo: string }>((desde, hasta) =>
      admin.from("produccion_envases_articulos").select("id, codigo").range(desde, hasta)
    )).map((f) => [f.codigo, f.id])
  );

  // Los proveedores del núcleo, sólo para leer. La columna J viene vacía en
  // todas las filas de hoy, pero el alta desde la app la puede llenar.
  const proveedoresNucleo = indiceDeProveedores(
    await traerTodo<{ id: string; nombre: string }>((desde, hasta) =>
      admin.from("proveedores").select("id, nombre").range(desde, hasta)
    )
  );

  let sinArticulo = 0;
  const filas = movimientos.flatMap((m) => {
    const articulo_id = porCodigo.get(m.codigo);
    // Un movimiento de un código que no está en el listado no se puede colgar
    // de ningún artículo. Se cuenta y se sigue.
    if (!articulo_id) { sinArticulo++; return []; }

    return [{
      articulo_id,
      codigo: m.codigo,
      fecha: m.fecha,
      entrada: m.entrada,
      salida: m.salida,
      rotura: m.rotura,
      despacho: m.despacho,
      observacion: m.observacion,
      proveedor_raw: m.proveedor_raw,
      proveedor_id: buscarProveedor(proveedoresNucleo, m.proveedor_raw),
      // `origen` NO viaja, a propósito: en un upsert las columnas que no se
      // mandan no entran en el SET, así que un movimiento cargado en la app y
      // después espejado conserva su 'app' cuando la sincronización relee esa
      // fila. Las filas nuevas toman el default, que es 'planilla'.
      sheets_fila: m.sheets_fila,
    }];
  });

  let guardadosMovimientos = 0;
  for (let i = 0; i < filas.length; i += 500) {
    const lote = filas.slice(i, i + 500);
    const { error } = await admin
      .from("produccion_envases_movimientos")
      .upsert(lote, { onConflict: "sheets_fila" });
    if (error) {
      await registrarSincronizacion({
        modulo: "produccion", recurso: "envases_movimientos", ok: false, error: error.message,
      });
      return falla(400, error.message);
    }
    guardadosMovimientos += lote.length;
  }

  await registrarSincronizacion({
    modulo: "produccion", recurso: "envases_articulos", ok: true, filas: guardadosArticulos,
  });
  await registrarSincronizacion({
    modulo: "produccion", recurso: "envases_movimientos", ok: true, filas: guardadosMovimientos,
  });

  return logra({
    articulos: guardadosArticulos,
    articulos_repetidos: repetidos,
    movimientos: guardadosMovimientos,
    movimientos_sin_articulo: sinArticulo,
    proveedores: guardadosProveedores,
    // Los nombres y no el conteo: cuáles son es lo que decide si hay algo que
    // arreglar. Con un número hay que ir a buscarlos.
    proveedores_sin_enlazar: sinEnlazar,
    proveedores_error: errorProveedores ?? null,
    referencias: referencias.colores,
    referencias_historial: referencias.historial,
    referencias_error: referencias.error ?? null,
    // Artículos cuyo grupo no se pudo establecer. Los que no tienen ningún
    // movimiento van a aparecer siempre acá, y está bien: la K sale del kardex.
    articulos_sin_grupo: sinGrupo,
    // Códigos cuyas filas dicen dos grupos distintos. Eso es una fórmula tocada
    // a mano o una columna corrida, y se arregla en la planilla.
    articulos_con_grupo_en_disputa: grupoEnDisputa,
  });
}

/** Los 16 proveedores de envases. Lo que no se reconoce se informa. */
async function sincronizarProveedores(
  admin: ReturnType<typeof createAdminClient>,
  planilla: string
): Promise<{ proveedores: number; sinEnlazar: string[]; error?: string }> {
  let filas: string[][];
  try {
    filas = await leerValores(planilla, TAB_PROV(), { sinFormato: true });
  } catch (e) {
    return { proveedores: 0, sinEnlazar: [], error: mensaje(e) };
  }
  if (filas.length < 2) return { proveedores: 0, sinEnlazar: [] };

  const leidos: ProveedorLeido[] = [];
  for (let i = 1; i < filas.length; i++) {
    const p = filaDeProveedor(filas[i], filas[0], i + 1);
    if (p) leidos.push(p);
  }

  const delNucleo = await traerTodo<{ id: string; nombre: string; cuit: string | null }>(
    (desde, hasta) => admin.from("proveedores").select("id, nombre, cuit").range(desde, hasta)
  );
  const porNombre = indiceDeProveedores(delNucleo);
  const porCuit = new Map<string, string>();
  for (const p of delNucleo) {
    const c = normalizarCuit(p.cuit);
    if (c && !porCuit.has(c)) porCuit.set(c, p.id);
  }

  const sinEnlazar: string[] = [];
  const lote = leidos.map((p) => {
    const proveedor_id = enlazarProveedor(porCuit, porNombre, p);
    if (!proveedor_id) sinEnlazar.push(p.nombre);
    return { ...p, proveedor_id };
  });

  const { error } = await admin
    .from("produccion_envases_proveedores")
    .upsert(lote, { onConflict: "nombre" });

  return error
    ? { proveedores: 0, sinEnlazar, error: error.message }
    : { proveedores: lote.length, sinEnlazar };
}

/**
 * La pestaña `REFERENCIAS`: color → proveedor, y el historial de cambios.
 *
 * Las dos cosas. La tabla de colores sin su historial miente: hoy el verde es
 * de Bolsera y hasta el 3 de julio de 2026 era de Recuperadora del Sur, así que
 * un bolsón viejo se le atribuiría al proveedor equivocado.
 *
 * La pestaña no tiene encabezados de tabla: la fila 1 es un título, la 2 dice
 * COLOR / PROVEEDOR, y más abajo arranca el historial después de la palabra
 * "MODIFICACIONES:". Se corta por esa marca y no por número de fila, para que
 * agregar un color no rompa nada.
 */
async function sincronizarReferencias(
  admin: ReturnType<typeof createAdminClient>,
  planilla: string
): Promise<{ colores: number; historial: number; error?: string }> {
  let filas: string[][];
  try {
    filas = await leerValores(planilla, TAB_REF(), { sinFormato: true });
  } catch (e) {
    return { colores: 0, historial: 0, error: mensaje(e) };
  }

  const corte = filas.findIndex((f) =>
    (f?.[0] ?? "").toString().toUpperCase().startsWith("MODIFICACIONES")
  );
  const hasta = corte >= 0 ? corte : filas.length;

  const colores: {
    color: string; proveedor_nombre: string | null; orden: number; sheets_fila: number;
  }[] = [];
  for (let i = 0; i < hasta; i++) {
    const color = (filas[i]?.[0] ?? "").toString().trim();
    const prov = (filas[i]?.[1] ?? "").toString().trim();
    // Sólo las filas que son un par color/proveedor. El título de la pestaña y
    // el encabezado no lo son.
    if (!color || !prov || color.toUpperCase() === "COLOR") continue;
    colores.push({ color, proveedor_nombre: prov, orden: i, sheets_fila: i + 1 });
  }

  const historial: { texto: string; sheets_fila: number }[] = [];
  for (let i = hasta + 1; i < filas.length; i++) {
    const texto = (filas[i]?.[0] ?? "").toString().trim();
    if (texto) historial.push({ texto, sheets_fila: i + 1 });
  }

  if (colores.length) {
    const { error } = await admin
      .from("produccion_envases_referencias")
      .upsert(colores, { onConflict: "color" });
    if (error) return { colores: 0, historial: 0, error: error.message };
  }
  if (historial.length) {
    const { error } = await admin
      .from("produccion_envases_referencias_historial")
      .upsert(historial, { onConflict: "sheets_fila" });
    if (error) return { colores: colores.length, historial: 0, error: error.message };
  }

  return { colores: colores.length, historial: historial.length };
}
