import type { SupabaseClient } from "@supabase/supabase-js";
import { traerTodo } from "@/lib/core/paginado";
import { TURNOS, parteAnterior } from "./turnos";
import { totalesDeDespacho, roturaTotal } from "./despachos";
import {
  produccionDelTurno,
  produccionDelDia,
  soloLoCalculado,
  type ProduccionPorProducto,
} from "./produccion";
import type { ClaveDeParte } from "./turnos";
import type { Despacho, Parte, Producto } from "./types";

/**
 * Traer de la base lo que las pantallas y las rutas necesitan.
 *
 * Dos partes por día con diez renglones cada uno son ~7.300 despachos al año.
 * **PostgREST corta en 1000 y no avisa**, así que todo lo que barra despachos va
 * por `traerTodo()`, y los filtros van por rango de fecha y nunca por un `.in()`
 * de muchos ids: esa URL PostgREST la rechaza con un 400 sin decir por qué.
 *
 * Los `select()` van literales y no armados en una variable: la cadena en una
 * variable pierde la inferencia de tipos de Supabase.
 */

export async function traerProductos(
  db: SupabaseClient,
  { soloActivos = true } = {}
): Promise<Producto[]> {
  let q = db
    .from("produccion_productos")
    .select("id, nombre, familia, envase, kg_por_unidad, nombre_planilla, orden, activo")
    .order("orden");
  if (soloActivos) q = q.eq("activo", true);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as Producto[];
}

export interface ParteCompleto {
  parte: Parte;
  deposito: Record<string, number>;
  despachos: Despacho[];
}

/** Un parte con su depósito y sus renglones, o `null` si ese turno no está cargado. */
export async function traerParte(
  db: SupabaseClient,
  clave: ClaveDeParte
): Promise<ParteCompleto | null> {
  const { data: parte, error } = await db
    .from("produccion_partes")
    .select(
      "id, fecha, turno, capataz_raw, capataz_id, observaciones, tareas_limpieza, recuento_bolsones, sheets_pendiente, sheets_pendiente_en"
    )
    .eq("fecha", clave.fecha)
    .eq("turno", clave.turno)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!parte) return null;

  const filas = await traerTodo<{ producto_id: string; cantidad: number }>((desde, hasta) =>
    db
      .from("produccion_deposito")
      .select("producto_id, cantidad")
      .eq("parte_id", parte.id)
      .range(desde, hasta)
  );

  const despachos = await traerTodo<Despacho>((desde, hasta) =>
    db
      .from("produccion_despachos")
      .select(
        "id, parte_id, orden, equipo_raw, cliente_raw, producto_id, producto_raw, kilos, bultos, envase_raw, pallets_cantidad, pallets_tipo, rotura_bolsa, rotura_bolson"
      )
      .eq("parte_id", parte.id)
      .order("orden")
      .range(desde, hasta)
  );

  const deposito: Record<string, number> = {};
  for (const f of filas) deposito[f.producto_id] = Number(f.cantidad);

  return { parte: parte as Parte, deposito, despachos };
}

/**
 * El depósito de un parte, o `null` si ese parte no existe.
 *
 * El `null` es el dato: es lo que hace que la producción se informe como no
 * calculable en vez de salir de una resta contra cero.
 */
export async function traerDepositoDe(
  db: SupabaseClient,
  clave: ClaveDeParte
): Promise<Record<string, number> | null> {
  const completo = await traerParte(db, clave);
  return completo ? completo.deposito : null;
}

export interface DiaArmado {
  /** Los partes cargados ese día, para poder anotarles el pendiente. */
  ids: string[];
  productos: Producto[];
  produccion: Record<string, number>;
  despacho: Record<string, number>;
  rotura: Record<string, number>;
}

/**
 * El día entero, listo para exportar.
 *
 * Lo usan la ruta que guarda un parte y la que reintenta un pendiente. Está acá
 * y no en una de las dos porque hacían exactamente lo mismo, y dos copias de una
 * cuenta es cómo se corrige una sola.
 *
 * Lo que no se puede calcular **no se exporta**: `soloLoCalculado` deja afuera
 * los productos de un turno al que le falta el parte anterior. Escribir un cero
 * en la planilla sería poner allá el mismo dato falso que el módulo vino a sacar.
 */
export async function armarElDia(db: SupabaseClient, fecha: string): Promise<DiaArmado> {
  // Catálogo completo, no sólo activos: cargar y exportar no son lo mismo. El
  // formulario de carga sí filtra `activo` (nadie tiene que poder cargar un
  // producto discontinuado), pero acá `produccion`/`despacho`/`rotura` salen
  // de las filas crudas de `produccion_deposito` y `produccion_despachos`, que
  // no filtran por activo. Si se desactiva un producto a mitad de mes, un
  // parte viejo que lo referencia sigue aportando cantidad a esos mapas; con
  // sólo activos acá, `celdasDeResumen` no le encuentra columna y ese valor se
  // pierde al exportar sin que nada avise. La columna sigue en la planilla, y
  // quien decide si un producto se exporta es `nombre_planilla`, no `activo`.
  const productos = await traerProductos(db, { soloActivos: false });

  const ids: string[] = [];
  // Un turno que no está cargado entra como `null`, no se saltea: es la única
  // forma de que `produccionDelDia` distinga "el turno produjo cero" de "el
  // turno no existe". Sin eso, un día con sólo la mañana cargada se exporta
  // como si fuera el día entero.
  const porTurno: (ProduccionPorProducto | null)[] = [];
  const despacho: Record<string, number> = {};
  const rotura: Record<string, number> = {};

  for (const turno of TURNOS) {
    const completo = await traerParte(db, { fecha, turno });
    if (!completo) {
      porTurno.push(null);
      continue;
    }
    ids.push(completo.parte.id);

    const totales = totalesDeDespacho(completo.despachos);
    const roturas = roturaTotal(totales);

    for (const [id, v] of Object.entries(totales.despachado)) {
      despacho[id] = (despacho[id] ?? 0) + v;
    }
    for (const [id, v] of Object.entries(roturas)) {
      rotura[id] = (rotura[id] ?? 0) + v;
    }

    porTurno.push(
      produccionDelTurno({
        deposito: completo.deposito,
        depositoAnterior: await traerDepositoDe(db, parteAnterior({ fecha, turno })),
        despachado: totales.despachado,
        rotura: roturas,
      })
    );
  }

  return {
    ids,
    productos,
    produccion: soloLoCalculado(produccionDelDia(porTurno)),
    despacho,
    rotura,
  };
}
