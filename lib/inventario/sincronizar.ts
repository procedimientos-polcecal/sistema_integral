/**
 * Traer de la planilla lo que el módulo Inventario espeja.
 *
 * La planilla manda. La gente del pañol sigue cargando movimientos en
 * `GESTIÓN DE ALMACÉN POLCECAL POLYSAN`, así que el kardex es la unión de lo que
 * carga la app y lo que carga la gente, y la fórmula del listado
 * —inicial + entradas − salidas— es el stock consolidado correcto. Acá se lee y
 * se anota cuándo; el SdG no lo calcula.
 *
 * Esta misma función es **la carga inicial**. No hay un importador aparte: la
 * primera corrida trae los ~2.800 artículos y el kardex entero. Un script `.mjs`
 * no podría usar el parser de `planilla.ts` —es TypeScript— y habría que
 * duplicarlo sin tests, que es cómo las dos copias se separan.
 *
 * Vive en `lib` y no dentro de la ruta porque lo van a llamar dos cosas con
 * permisos distintos, igual que en Mantenimiento: el botón, que exige sesión, y
 * el reloj, que no tiene ninguna.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { registrarSincronizacion } from "@/lib/core/sincronizaciones";
import { leerValores } from "@/lib/core/sheets";
import { traerTodo } from "@/lib/core/paginado";
import {
  mapearListado, mapearKardex, filaDeArticulo, filaDeMovimiento,
  type ArticuloLeido, type MovimientoLeido,
} from "@/lib/inventario/planilla";
import {
  indicePorNombre, indiceDeEmpleados, reconocer, SinReconocer,
} from "@/lib/inventario/enlaces";
import { reconciliarSolicitantes, type Destino, type Solicitante } from "@/lib/inventario/catalogos";

type Datos = Record<string, unknown>;

/** Una fila de catálogo del núcleo: lo mínimo para reconocer un nombre. */
interface Nombrado { id: string; nombre: string }

export type Resultado =
  | { ok: true; datos: Datos }
  | { ok: false; status: number; error: string; datos?: Datos };

const logra = (datos: Datos): Resultado => ({ ok: true, datos });
const falla = (status: number, error: string): Resultado => ({ ok: false, status, error });

/**
 * La planilla y sus dos pestañas.
 *
 * `GOOGLE_SHEETS_INVENTARIO_ID` y `..._TAB` ya están configuradas: son las que
 * Mantenimiento usa para consultar si hay stock de un repuesto. La del kardex es
 * nueva, y su nombre lleva **doble espacio** —"Entradas  Salidas"—, que es como
 * está en la planilla.
 */
const PLANILLA = () => process.env.GOOGLE_SHEETS_INVENTARIO_ID ?? "";
const TAB_LISTADO = () => process.env.GOOGLE_SHEETS_INVENTARIO_TAB ?? "Listado articulos GRAL";
const TAB_KARDEX = () => process.env.GOOGLE_SHEETS_INVENTARIO_TAB_MOV ?? "Entradas  Salidas";

/**
 * Traer de la planilla, y que un fallo diga qué pasó.
 *
 * Adentro casi todo devuelve `falla(...)` con un motivo, pero no todo: los
 * `traerTodo` **lanzan**, y una excepción que sube hasta la ruta se convierte
 * en un 500 sin cuerpo. La pantalla no encuentra `error` y muestra su texto de
 * reserva, "No se pudo sincronizar", que no distingue una tabla que falta de
 * Google caído de un permiso mal dado.
 *
 * Pasó de verdad: con la migración de la lista del pañol sin correr, la
 * sincronización moría al leer `inventario_solicitantes` y lo único que se veía
 * era esa frase. Un diagnóstico que no se distingue de otro no es un
 * diagnóstico — la misma regla que ya aplica al espejo cuando Google rechaza
 * una escritura.
 */
export async function sincronizarInventario(): Promise<Resultado> {
  try {
    return await traerDeLaPlanilla();
  } catch (e) {
    const detalle = mensaje(e);
    await registrarSincronizacion({
      modulo: "inventario", recurso: "movimientos", ok: false, error: detalle,
    });
    return falla(500, detalle);
  }
}

async function traerDeLaPlanilla(): Promise<Resultado> {
  const planilla = PLANILLA();
  if (!planilla) return falla(503, "Falta configurar GOOGLE_SHEETS_INVENTARIO_ID");

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
  const codigosVistos = new Set<string>();
  let listadoRepetidos = 0;

  for (let i = 1; i < filasListado.length; i++) {
    const art = filaDeArticulo(filasListado[i], idxListado, i + 1);
    if (!art) continue;
    // El código es unique: dos filas con el mismo harían fallar el lote entero
    // con "ON CONFLICT DO UPDATE command cannot affect row a second time".
    if (codigosVistos.has(art.codigo)) { listadoRepetidos++; continue; }
    codigosVistos.add(art.codigo);
    articulos.push(art);
  }

  const ahora = new Date().toISOString();
  let guardadosArticulos = 0;

  for (let i = 0; i < articulos.length; i += 500) {
    const lote = articulos.slice(i, i + 500).map((a) => ({
      ...a,
      stock_sincronizado_en: ahora,
    }));
    const { error } = await admin
      .from("inventario_articulos")
      .upsert(lote, { onConflict: "codigo" });

    if (error) {
      await registrarSincronizacion({
        modulo: "inventario", recurso: "articulos", ok: false, error: error.message,
      });
      return falla(400, error.message);
    }
    guardadosArticulos += lote.length;
  }

  // ── El kardex ──────────────────────────────────────────────
  let filasKardex: string[][];
  try {
    filasKardex = await leerValores(planilla, TAB_KARDEX(), { sinFormato: true });
  } catch (e) {
    // El listado ya entró: se informa lo que se pudo y lo que no, en vez de
    // perder las dos cosas.
    await registrarSincronizacion({
      modulo: "inventario", recurso: "articulos", ok: true, filas: guardadosArticulos,
    });
    return falla(502, `Los artículos entraron; el kardex «${TAB_KARDEX()}» no se pudo leer: ${mensaje(e)}`);
  }

  const idxKardex = filasKardex.length ? mapearKardex(filasKardex[0]) : {};
  const movimientos: MovimientoLeido[] = [];
  for (let i = 1; i < filasKardex.length; i++) {
    const mov = filaDeMovimiento(filasKardex[i], idxKardex, i + 1);
    if (mov) movimientos.push(mov);
  }

  // Los RI que existen, para enlazar la entrada con el pedido que la trajo. Se
  // filtra por los que la planilla nombró: son decenas, no los 1.900.
  const riDeLaPlanilla = [...new Set(movimientos.map((m) => m.ri).filter((r): r is number => r !== null))];
  const requerimientos = new Map<number, string>();
  if (riDeLaPlanilla.length > 0) {
    // De a 200 por vez: un `.in()` con mil valores arma una URL que PostgREST
    // rechaza con un 400 sin decir por qué.
    for (let i = 0; i < riDeLaPlanilla.length; i += 200) {
      const { data } = await admin
        .from("compras_requerimientos")
        .select("id, nro_ri")
        .in("nro_ri", riDeLaPlanilla.slice(i, i + 200));
      for (const r of data ?? []) requerimientos.set(r.nro_ri as number, r.id as string);
    }
  }

  // La lista del pañol se engancha con el padrón antes de resolver nada, así un
  // nombre que ayer no estaba en `empleados` y hoy sí queda enlazado en esta
  // misma corrida en vez de en la próxima.
  const catalogo = await reconciliarSolicitantes(admin);

  // Los catálogos del núcleo, sólo para leer.
  const [porCodigo, sectores, empleados, proveedores] = await Promise.all([
    articulosPorCodigo(admin),
    // Los tres `select` van con la cadena literal y no armada en una variable:
    // con una variable, Supabase pierde la inferencia y todo lo que sale queda
    // como error de string. Es la misma nota que dejó `sectoresDePlanta`.
    indicePorNombre(
      await traerTodo<Nombrado>((desde, hasta) =>
        // Sólo los activos: `indicePorNombre` se queda con el primero que
        // aparece y no avisa del empate, así que un nombre repetido por una
        // fila dada de baja mandaría los movimientos nuevos al sector viejo.
        admin.from("sectores").select("id, nombre").eq("activo", true).range(desde, hasta)
      )
    ),
    // Los empleados van por su propio índice: el nombre y el apellido están en
    // columnas separadas y la planilla escribe los dos juntos, en los dos
    // órdenes. Con `indicePorNombre` no reconocía ni uno.
    indiceDeEmpleados(
      await traerTodo<Nombrado & { apellido: string | null }>((desde, hasta) =>
        admin.from("empleados").select("id, nombre, apellido").range(desde, hasta)
      )
    ),
    indicePorNombre(
      await traerTodo<Nombrado>((desde, hasta) =>
        admin.from("proveedores").select("id, nombre").range(desde, hasta)
      )
    ),
  ]);

  // Y la lista propia del pañol, que es contra la que de verdad se escribe el
  // kardex. `MECÁNICO` y `Omar Piparo` no están en `sectores` ni en `empleados`
  // y sí acá, así que esto es lo que hace que un movimiento se pueda atribuir.
  const [destinos, solicitantes] = await Promise.all([
    traerTodo<Destino>((desde, hasta) =>
      admin.from("inventario_destinos").select("id, nombre, sector_id").range(desde, hasta)
    ),
    traerTodo<Solicitante>((desde, hasta) =>
      admin.from("inventario_solicitantes")
        .select("id, nombre, destino_id, empleado_id").range(desde, hasta)
    ),
  ]);
  const porDestino = indicePorNombre(destinos);
  const porSolicitante = indicePorNombre(solicitantes);

  const sinReconocer = new SinReconocer();
  let sinArticulo = 0;

  const filas = movimientos.flatMap((m) => {
    const articulo_id = porCodigo.get(m.codigo);
    // Un movimiento de un código que no está en el listado no se puede colgar
    // de ningún artículo. Se cuenta y se sigue: la planilla tiene filas con
    // códigos viejos que ya no existen.
    if (!articulo_id) { sinArticulo++; return []; }

    const destino_id = reconocer(porDestino, m.sector_raw);
    const solicitante_id = reconocer(porSolicitante, m.solicitante);
    const empleado_id = reconocer(empleados, m.solicitante);
    const proveedor_id = reconocer(proveedores, m.proveedor_raw);

    // El sector del núcleo sale del destino cuando el destino es uno, y si no,
    // del texto: la mayoría de los destinos —MECÁNICO, TALLER VIAL— no son
    // sectores y ahí queda en null, que es lo correcto.
    const sector_id =
      (destino_id ? destinos.find((d) => d.id === destino_id)?.sector_id : null) ??
      reconocer(sectores, m.sector_raw);

    // Lo que no está en la lista del pañol es lo que hay que agregarle, y por
    // eso se informa aparte de lo que no está en los catálogos del núcleo: son
    // dos problemas distintos con dos arreglos distintos.
    if (m.sector_raw && !destino_id) sinReconocer.anotar("destinos", m.sector_raw);
    if (m.solicitante && !solicitante_id) sinReconocer.anotar("solicitantes", m.solicitante);
    if (m.proveedor_raw && !proveedor_id) sinReconocer.anotar("proveedores", m.proveedor_raw);

    return [{
      articulo_id,
      codigo: m.codigo,
      fecha: m.fecha ?? null,
      tipo: m.tipo,
      cantidad: m.cantidad,
      stock_resultante: m.stock_resultante,
      solicitante: m.solicitante,
      solicitante_id,
      empleado_id,
      sector_raw: m.sector_raw,
      destino_id,
      sector_id,
      proveedor_raw: m.proveedor_raw,
      proveedor_id,
      ri: m.ri,
      // El pedido que trajo este material, cuando el RI existe. Null si la
      // planilla nombró un número que no está: no se enlaza al que se parece.
      requerimiento_id: m.ri !== null ? requerimientos.get(m.ri) ?? null : null,
      // `origen` NO viaja, a propósito. En un upsert las columnas que no se
      // mandan no entran en el `SET`, así que un movimiento que se cargó en la
      // app y después se espejó al kardex conserva su 'app' cuando la
      // sincronización vuelve a leer esa fila. Las filas nuevas toman el
      // default, que es 'planilla'.
      sheets_fila: m.sheets_fila,
    }];
  });

  let guardadosMovimientos = 0;
  for (let i = 0; i < filas.length; i += 500) {
    const lote = filas.slice(i, i + 500);
    const { error } = await admin
      .from("inventario_movimientos")
      .upsert(lote, { onConflict: "sheets_fila" });

    if (error) {
      await registrarSincronizacion({
        modulo: "inventario", recurso: "movimientos", ok: false, error: error.message,
      });
      return falla(400, error.message);
    }
    guardadosMovimientos += lote.length;
  }

  await registrarSincronizacion({
    modulo: "inventario", recurso: "articulos", ok: true, filas: guardadosArticulos,
  });
  await registrarSincronizacion({
    modulo: "inventario", recurso: "movimientos", ok: true, filas: guardadosMovimientos,
  });

  const riSinRequerimiento = riDeLaPlanilla.filter((r) => !requerimientos.has(r));

  return logra({
    articulos: guardadosArticulos,
    articulos_repetidos: listadoRepetidos,
    movimientos: guardadosMovimientos,
    movimientos_sin_articulo: sinArticulo,
    ri_sin_requerimiento: riSinRequerimiento.length,
    solicitantes_enganchados: catalogo.enganchados,
    solicitantes_sin_empleado: catalogo.sueltos,
    sin_reconocer: sinReconocer.resumen(),
  });
}

/** Los códigos ya cargados, para colgar cada movimiento de su artículo. */
async function articulosPorCodigo(
  admin: ReturnType<typeof createAdminClient>
): Promise<Map<string, string>> {
  const filas = await traerTodo<{ id: string; codigo: string }>((desde, hasta) =>
    admin.from("inventario_articulos").select("id, codigo").range(desde, hasta)
  );
  return new Map(filas.map((f) => [f.codigo, f.id]));
}

const mensaje = (e: unknown) => (e instanceof Error ? e.message : String(e));
