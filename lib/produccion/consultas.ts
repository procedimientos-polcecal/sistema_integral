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
import { armarLosDias, type DiaDelMes } from "./mes";
import type { ClaveDeParte } from "./turnos";
import type { Despacho, Parte, Producto } from "./types";

export type { DiaDelMes } from "./mes";

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

  // Caché de depósitos ya traídos, sólo durante esta llamada (no entre pedidos
  // HTTP distintos). El depósito del parte anterior al turno `12_20` es el del
  // `4_12` del mismo día, que el bucle ya trajo entero unas líneas antes: sin
  // esto se pedía dos veces a la base dentro de la misma exportación, y las dos
  // lecturas podían no coincidir si alguien guardaba el parte de la mañana justo
  // en el medio — la mañana y la resta de la tarde saldrían de dos fotos
  // distintas. Guardamos también el `null` de "el parte no existe": es un
  // resultado válido, no "todavía no lo busqué".
  const depositosPorClave = new Map<string, Record<string, number> | null>();
  const claveDe = (c: ClaveDeParte) => `${c.fecha}|${c.turno}`;

  async function depositoCacheado(clave: ClaveDeParte): Promise<Record<string, number> | null> {
    const k = claveDe(clave);
    if (depositosPorClave.has(k)) return depositosPorClave.get(k)!;
    const deposito = await traerDepositoDe(db, clave);
    depositosPorClave.set(k, deposito);
    return deposito;
  }

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
    // Este parte ya está completo en mano: dejarlo en la caché evita volver a
    // pedirlo cuando el turno siguiente lo necesite como "parte anterior".
    depositosPorClave.set(claveDe({ fecha, turno }), completo.deposito);

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
        depositoAnterior: await depositoCacheado(parteAnterior({ fecha, turno })),
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

export interface MesArmado {
  primerDia: string;
  ultimoDia: string;
  productos: Producto[];
  dias: DiaDelMes[];
}

/**
 * El mes entero, día por día, para `/produccion/resumenes`.
 *
 * Reusa exactamente las mismas funciones que `armarElDia` y que la
 * exportación a la planilla — `totalesDeDespacho`, `roturaTotal`,
 * `produccionDelTurno`, `produccionDelDia`, `soloLoCalculado`—: si la pantalla
 * y la planilla alguna vez muestran números distintos para el mismo día, es
 * porque los datos cambiaron en el medio, no porque haya dos cuentas.
 *
 * La diferencia con `armarElDia` es sólo de acceso a datos, no de aritmética.
 * Llamar a `armarElDia` una vez por día de un mes de 31 días dispararía del
 * orden de 300 consultas (productos + dos `traerParte` por día, cada uno con
 * su parte, su depósito y sus despachos, más el parte anterior recalculado
 * cada vez sin acordarse del día previo). Acá se trae **todo el rango de una
 * sola vez** —partes por fecha, con `.gte`/`.lte` y nunca por un `.in()` de
 * muchos ids— y con los ids de esos partes (a lo sumo 62 en un mes, muy por
 * debajo del límite de 200 de la regla del repo) se trae depósito y despachos
 * en un solo `.in()` cada uno. Todo el día se arma después en memoria.
 */
export async function armarElMes(
  db: SupabaseClient,
  primerDia: string,
  ultimoDia: string
): Promise<MesArmado> {
  // Ver el comentario de armarElDia: acá también hace falta el catálogo
  // completo, no sólo activos, porque un parte viejo puede referenciar un
  // producto ya desactivado.
  const productos = await traerProductos(db, { soloActivos: false });

  // Las tres consultas de acá abajo son el primer lugar del módulo que cruza
  // de verdad el corte de 1000 de PostgREST (un mes completo son ~1.054 filas
  // de depósito y hasta ~1.900 de despachos), así que van por `range()` en
  // tandas — y paginar con `range()` sin un `.order()` estable puede repetir o
  // saltear filas entre tandas si el motor no devuelve siempre el mismo orden.
  // El síntoma sería un despachado del mes distinto al del día, sin ningún
  // error. Ordenar por la clave primaria alcanza: no importa en qué orden
  // vuelvan las filas, sólo que sea el mismo en cada tanda.
  const partes = await traerTodo<{ id: string; fecha: string; turno: ClaveDeParte["turno"] }>(
    (desde, hasta) =>
      db
        .from("produccion_partes")
        .select("id, fecha, turno")
        .gte("fecha", primerDia)
        .lte("fecha", ultimoDia)
        .order("id")
        .range(desde, hasta)
  );

  const ids = partes.map((p) => p.id);

  // Sin partes este mes (catálogo recién arrancado, o un mes sin cargar
  // todavía) no hay nada que pedirle a `produccion_deposito` ni a
  // `produccion_despachos`: un `.in("parte_id", [])` es una consulta de más
  // que siempre vuelve vacía.
  const filasDeposito =
    ids.length === 0
      ? []
      : await traerTodo<{ parte_id: string; producto_id: string; cantidad: number }>(
          (desde, hasta) =>
            db
              .from("produccion_deposito")
              .select("parte_id, producto_id, cantidad")
              .in("parte_id", ids)
              .order("parte_id")
              .order("producto_id")
              .range(desde, hasta)
        );

  const despachosPlanos =
    ids.length === 0
      ? []
      : await traerTodo<Despacho>((desde, hasta) =>
          db
            .from("produccion_despachos")
            .select(
              "id, parte_id, orden, equipo_raw, cliente_raw, producto_id, producto_raw, kilos, bultos, envase_raw, pallets_cantidad, pallets_tipo, rotura_bolsa, rotura_bolson"
            )
            .in("parte_id", ids)
            .order("id")
            .range(desde, hasta)
        );

  // El único dato que el rango de arriba no trae: el depósito del turno
  // anterior al primer turno del mes, que es el `12_20` del último día del
  // mes previo. Sin esto el turno `4_12` del día 1 sale siempre
  // "sin_parte_anterior" — un agujero fijo en cada mes, no un dato real que
  // falte. Es la misma cuenta de `parteAnterior` que resuelve este mismo
  // problema en la pantalla del día.
  const anteriorAlMes = await traerDepositoDe(db, parteAnterior({ fecha: primerDia, turno: "4_12" }));

  // De acá para abajo no hay más red: `armarLosDias` (en `mes.ts`) es la
  // función pura que arma el día por día, y la que tiene los tests — esta
  // función sólo trae y le pasa lo que ya bajó.
  const dias = armarLosDias({
    primerDia,
    ultimoDia,
    partes,
    filasDeposito,
    despachos: despachosPlanos,
    depositoAnteriorAlMes: anteriorAlMes,
  });

  return { primerDia, ultimoDia, productos, dias };
}
