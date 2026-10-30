/**
 * Traer de las planillas lo que el módulo espeja.
 *
 * Vive acá y no dentro de las rutas porque lo llaman dos cosas: el botón "Traer
 * de la planilla", que exige sesión y permisos, y el reloj, que no tiene
 * ninguna de las dos. Mientras estuvo en los handlers, el cron no podía usarlo.
 *
 * Cada una registra su corrida —salga bien o mal— para que la pantalla pueda
 * decir cuándo se actualizó por última vez.
 *
 * LAS TRES BORRAN, DESDE EL 18/10/2026
 *
 * Hasta ahora sólo traían y pisaban, así que una fila que alguien sacaba de la
 * planilla seguía viva en el SdG para siempre: el espejo dejaba de ser un
 * espejo y nada avisaba. Ahora, lo que la planilla no trajo se borra.
 *
 * El cómo —qué se protege y cuándo no se borra nada— está en
 * `lib/core/borradoDeEspejo.ts`, que es donde vive la decisión y donde están
 * los tests. Acá cada sincronización sólo dice cómo se llaman sus columnas.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { registrarSincronizacion } from "@/lib/core/sincronizaciones";
import { traerTodo } from "@/lib/core/paginado";
import { avisarAQuienDecide } from "@/lib/core/avisoAlInstante";
import { lasOSQueNacenEsperando } from "@/lib/mantenimiento/aprobacion";
import { borrarLoQueLaPlanillaNoTrajo } from "@/lib/core/borradoDeEspejo";
import { leerValores, leerFormulas, listarPestanas } from "@/lib/core/sheets";
import { linkDeCelda } from "@/lib/core/links";
import { cargarEnlaces, resolver, proveedorDe } from "@/lib/mantenimiento/enlaces";
import { filaDeAviso } from "@/lib/mantenimiento/avisos";
import { resolverElArea, repartirPorArea } from "@/lib/mantenimiento/areaDelAviso";
import { filaDeOrden, paraLaBase, celdasParaRegistrar, type OrdenLeida } from "@/lib/mantenimiento/ordenes";
import { contrastar, type OrdenDelSistema } from "@/lib/mantenimiento/contraste";
import { loQueSeGuardaDelContraste } from "@/lib/mantenimiento/divergencias";
import { generarLasPeriodicas } from "@/lib/mantenimiento/generarPeriodicas";
import { loQueHayQueExportar } from "@/lib/mantenimiento/cierreDeOT";
import { escribirEnLaFilaDeLaOT } from "@/lib/mantenimiento/planillaDeOT";
import { escribirEnLaFilaDeLaOS } from "@/lib/mantenimiento/planillaDeOS";
import { loQueHayQueExportarDeLaOS } from "@/lib/mantenimiento/pendienteDeLaOS";
import { escribirEnLaFilaDelAviso } from "@/lib/mantenimiento/planillaDelAviso";
import { camposDelPendiente, celdasDelAviso, elIntentoDelAviso } from "@/lib/mantenimiento/pendienteDelAviso";
import { cualesReintentar } from "@/lib/mantenimiento/reintentoDePendientes";
import {
  COMPARATIVA_PESTANAS, filaDeComparativa, pareceCotizacion, pestanasQueFaltan,
} from "@/lib/mantenimiento/comparativas";
import {
  OS_PESTANAS, mapearEncabezados, filaDeOS, seguimientoHuerfano,
} from "@/lib/mantenimiento/os";

type Datos = Record<string, unknown>;

/**
 * Cómo se llama cada cosa en las tres tablas que se espejan.
 *
 * Las tres comparten el vocabulario porque vinieron de la misma app: `*_number`
 * para el número de la planilla, `synced_at` para el sello de la corrida,
 * `app_created` + `sheets_row` para distinguir lo que la app escribió y
 * todavía no exportó.
 */
const ESPEJO_DE_OT = {
  tabla: "ordenes_trabajo", numero: "ot_number", sincronizado: "synced_at",
  creada: "created_at_app", fila: "sheets_row",
  deLaApp: { columna: "app_created", valor: true },
  modulo: "mantenimiento", entidad: "orden_trabajo",
} as const;

const ESPEJO_DE_AVISOS = {
  tabla: "avisos", numero: "oa_number", sincronizado: "synced_at",
  creada: "created_at", fila: "sheets_row",
  deLaApp: { columna: "app_created", valor: true },
  modulo: "mantenimiento", entidad: "aviso",
} as const;

const ESPEJO_DE_OS = {
  tabla: "ordenes_servicio", numero: "os_number", sincronizado: "synced_at",
  creada: "created_at", fila: "sheets_row",
  deLaApp: { columna: "app_created", valor: true },
  modulo: "mantenimiento", entidad: "orden_servicio",
} as const;

/**
 * Lo que una corrida puede pedir.
 *
 * `sinFreno` levanta el tope del borrado masivo. Lo pasa la ruta cuando una
 * persona confirmó el número; **el cron no lo pasa nunca**, y ésa es toda la
 * diferencia: un borrado grande de verdad lo autoriza alguien que lo miró.
 */
export interface OpcionesDeCorrida {
  sinFreno?: boolean;
  actor?: "sincronizacion" | "cron";
}

/**
 * Cómo salió una sincronización.
 *
 * El fallo lleva `status` para que la ruta lo devuelva tal cual: el cron lo
 * ignora, pero quien aprieta el botón merece saber si el problema fue de
 * configuración (503), de la planilla (502) o de la base (400).
 */
export type Resultado =
  | { ok: true; datos: Datos }
  | { ok: false; status: number; error: string; datos?: Datos };

const logra = (datos: Datos): Resultado => ({ ok: true, datos });
const falla = (status: number, error: string, datos?: Datos): Resultado =>
  ({ ok: false, status, error, datos });

/**
 * Una sola fila por número, y cuáles venían repetidos.
 *
 * Las tres planillas se espejan con un `upsert` sobre su número —`oa_number`,
 * `ot_number`, `os_number`—. Si el lote trae dos filas con el mismo, Postgres
 * aborta **el lote entero** con "ON CONFLICT DO UPDATE command cannot affect
 * row a second time": un número repetido en la planilla dejaba sin sincronizar
 * las otras 1.760 órdenes, y el mensaje no decía cuál era.
 *
 * Gana la última, que en una planilla es la de más abajo: el trabajo nuevo se
 * agrega al final, así que ante dos filas con el mismo número la de abajo es la
 * más reciente. No se elige en silencio: los repetidos se devuelven para que la
 * pantalla los nombre y alguien los corrija en la planilla, que es donde está
 * el problema de verdad.
 */
export function unaPorNumero<T extends Datos>(
  registros: T[],
  clave: string
): { unicos: T[]; repetidos: number[] } {
  const porNumero = new Map<unknown, T>();
  const repetidos = new Set<number>();

  for (const r of registros) {
    const numero = r[clave];
    if (porNumero.has(numero)) repetidos.add(Number(numero));
    porNumero.set(numero, r);
  }

  return {
    unicos: [...porNumero.values()],
    repetidos: [...repetidos].sort((a, b) => a - b),
  };
}

/**
 * Una sola fila por celda de la planilla, y cuáles venían repetidas.
 *
 * Las comparativas no se espejan por número: varias filas comparten el N° de OS
 * —son las ofertas que se comparan entre sí— así que lo que identifica a cada
 * cotización es la celda de la que salió, `(sheets_tab, sheets_row)`. Ésa es la
 * clave única que la tabla trae del esquema original de la app de
 * Mantenimiento.
 *
 * La dedupe hace falta por lo mismo que `unaPorNumero`: un `upsert` cuyo lote
 * trae dos veces la misma clave aborta **el lote entero**, y ahí se caen las 152
 * cotizaciones por una celda leída dos veces.
 *
 * Gana la última por la misma razón que allá, y los repetidos se devuelven con
 * el nombre de la celda —`Compresores!14`— para que se puedan buscar en la
 * planilla, que es donde está el problema de verdad.
 */
export function unaPorCelda<T extends Datos>(
  registros: T[]
): { unicos: T[]; repetidos: string[] } {
  const porCelda = new Map<string, T>();
  const repetidos = new Set<string>();

  for (const r of registros) {
    const celda = `${r.sheets_tab}!${r.sheets_row}`;
    if (porCelda.has(celda)) repetidos.add(celda);
    porCelda.set(celda, r);
  }

  return { unicos: [...porCelda.values()], repetidos: [...repetidos].sort() };
}

/** El texto que explica por qué no se pudo leer una pestaña. */
async function porQueNoSeLeyo(
  planilla: string, pestana: string, e: unknown, variable: string
): Promise<string> {
  // El error de Google no dice qué pestañas hay, y adivinar el nombre es la
  // primera cosa que sale mal. Se lo decimos.
  let disponibles: string[] = [];
  try {
    disponibles = await listarPestanas(planilla);
  } catch {
    // Si tampoco se puede listar, el problema es de acceso: vale el de arriba.
  }

  return (
    `No se pudo leer la pestaña "${pestana}". ` +
    (disponibles.length > 0
      ? `La planilla tiene: ${disponibles.join(", ")}. Configurá ${variable}.`
      : e instanceof Error ? e.message : String(e))
  );
}

/**
 * Lo que hace falta para ponerle área a los avisos que llegan de la planilla:
 * el resolvedor de nombres y qué áreas tienen ya guardadas los avisos.
 *
 * Son dos lecturas por corrida, y de la segunda se trae **sólo lo que ya tiene
 * área**: es lo que hay que proteger, y filtrar por la condición evita tanto
 * un `.in()` con cientos de números como traer los que no aportan nada.
 *
 * **Los usuarios se traen TODOS, también los dados de baja, y es deliberado:**
 * `indiceDeCatalogo` documenta que se arma con las filas activas, y esto lo
 * contradice a propósito. Filtrar por `activo` perdería el área de los avisos
 * cargados por gente ya dada de baja —la planilla los re-trae en cada corrida,
 * así que cada vez quedarían sin área—. El riesgo contrario, que una persona
 * inactiva comparta nombre normalizado con una activa y vuelva ambiguo el
 * resultado, no existe hoy entre los 14 usuarios. Si algún día pasa, el aviso
 * queda en null y se ve: es el fallo seguro. No lo «arregles» agregando
 * `.eq("activo", true)` sin pensar en los avisos de quien ya no está.
 *
 * **Si cualquiera falla devuelve `{ error }` y la sincronización sigue sin tocar
 * el área.** Frenar toda la corrida por esto dejaría sin actualizar los avisos por
 * una columna secundaria; en cambio no mandar `area_id` es siempre seguro, y lo
 * que quedó sin completar se completa en la corrida siguiente.
 */
async function cargarLasAreasDeLosAvisos(admin: ReturnType<typeof createAdminClient>): Promise<
  | { areaDe: ReturnType<typeof resolverElArea>; guardadas: Map<string, string> }
  | { error: string }
> {
  try {
    const usuarios = await traerTodo((desde, hasta) =>
      admin
        .from("usuarios")
        .select("id, nombre, apellido, usuario_areas_compras(area_id)")
        .order("id")
        .range(desde, hasta)
    );
    const conArea = await traerTodo((desde, hasta) =>
      admin
        .from("avisos")
        .select("oa_number, area_id")
        .not("area_id", "is", null)
        .order("oa_number")
        .range(desde, hasta)
    );

    return {
      areaDe: resolverElArea(
        usuarios.map((u) => ({
          id: u.id,
          nombre: u.nombre ?? "",
          apellido: u.apellido ?? "",
          areas: (u.usuario_areas_compras ?? []).map((a) => a.area_id as string),
        }))
      ),
      guardadas: new Map(conArea.map((a) => [String(a.oa_number), a.area_id as string])),
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Reescribe lo que no llegó a la planilla de avisos, y devuelve los N° OA que
 * **siguen** sin llegar.
 *
 * Hermana de `exportarLoPendiente` (OT) y `exportarLoPendienteDeOS`, con una
 * diferencia que no se deduce: acá no se rearma el registro entero desde la
 * fila, sino **sólo el campo que falló**, porque `OT ASIGNADA` la escriben a
 * mano —182 de 186— y reescribirla por un fallo de la otra columna podría
 * vaciar un número que el sync todavía no importó. El porqué completo está en
 * `lib/mantenimiento/pendienteDelAviso.ts`.
 */
export async function exportarLoPendienteDeAvisos(
  admin: ReturnType<typeof createAdminClient>
): Promise<{ siguenPendientes: Set<string>; problema: string | null }> {
  const siguenPendientes = new Set<string>();

  // La cadena va literal: armada en una variable, Supabase pierde la inferencia.
  const { data: pendientes, error } = await admin
    .from("avisos")
    .select("id, oa_number, sheets_row, ot_asignada, observaciones, sheets_pendiente_campos")
    .not("sheets_pendiente", "is", null);

  // Y si no se pudo leer la cola, se dice. Con la migración `20261029081402`
  // sin aplicar, PostgREST contesta que no existe la columna y un `?? []` haría
  // que esto no reintentara nada ni salteara nada —la protección apagada,
  // importando igual y sin una palabra—. Mismo criterio que en las OS: no
  // aborta la corrida, pero no se calla.
  if (error) {
    return {
      siguenPendientes,
      problema:
        `No se pudo leer la cola de exportación de los avisos, así que esta corrida no ` +
        `reintentó nada y pudo pisar un enlace o una desestimación: ${error.message}`,
    };
  }

  for (const aviso of pendientes ?? []) {
    const celdas = celdasDelAviso(aviso, camposDelPendiente(aviso.sheets_pendiente_campos));

    // Sin campos reconocibles no hay nada que reescribir: se limpia la marca en
    // vez de reintentar para siempre, igual que cuando una OT deja de tener
    // algo que exportar.
    if (!celdas) {
      await admin.from("avisos")
        .update({ sheets_pendiente: null, sheets_pendiente_campos: null, sheets_intentado_en: new Date().toISOString() })
        .eq("id", aviso.id);
      continue;
    }

    const fallo = await escribirEnLaFilaDelAviso(aviso, celdas);
    if (fallo) siguenPendientes.add(aviso.oa_number as string);

    await admin.from("avisos")
      .update(elIntentoDelAviso(fallo, camposDelPendiente(aviso.sheets_pendiente_campos)))
      .eq("id", aviso.id);
  }

  return { siguenPendientes, problema: null };
}

/** Trae los avisos de su planilla. */
export async function sincronizarAvisos(opciones: OpcionesDeCorrida = {}): Promise<Resultado> {
  const planilla = process.env.GOOGLE_SHEETS_AVISOS_ID ?? "";
  const pestana = process.env.GOOGLE_SHEETS_AVISOS_TAB ?? "AVISOS";
  if (!planilla) return falla(503, "Falta configurar GOOGLE_SHEETS_AVISOS_ID");

  // Antes de leer: lo que aparezca después de este instante no estaba en lo
  // que leímos, y su ausencia no prueba que alguien lo haya borrado.
  const inicio = new Date().toISOString();
  const admin = createAdminClient();

  // Primero sale lo que el sistema sabe y la planilla no, igual que en las OT y
  // las OS: así lo que acabamos de escribir vuelve con el resto en la lectura
  // de abajo, en vez de ser pisado por una columna vieja.
  const { siguenPendientes: sinExportar, problema: colaSinLeer } =
    await exportarLoPendienteDeAvisos(admin);

  let filas: string[][];
  try {
    filas = await leerValores(planilla, pestana, { sinFormato: true });
  } catch (e) {
    return falla(502, await porQueNoSeLeyo(planilla, pestana, e, "GOOGLE_SHEETS_AVISOS_TAB"));
  }

  if (filas.length < 2) return logra({ leidas: 0, guardados: 0, sin_equipo: 0 });

  const enlaces = await cargarEnlaces(admin);
  // Uno solo para toda la corrida: es el sello que después distingue lo que la
  // planilla trajo de lo que sobra. Con un `toISOString()` por fila, cada una
  // quedaba con el suyo y no se podía preguntar "cuáles no toqué".
  const cuando = new Date().toISOString();

  const registros: Datos[] = [];
  /** Lo que la planilla trajo, esté o no entre lo que vamos a escribir. */
  const trajoLaPlanilla = new Set<string>();
  let sinEquipo = 0;

  for (let i = 0; i < filas.length - 1; i++) {
    const aviso = filaDeAviso(filas[i + 1], i + 2);
    if (!aviso) continue;

    // Contado antes del salteo, no después: un aviso salteado sigue estando en
    // la planilla, y dejarlo fuera de `clavesLeidas` lo manda a borrar. Ver el
    // comentario largo en `sincronizarOrdenes`.
    trajoLaPlanilla.add(aviso.oa_number);

    // Lo que no se pudo exportar no se pisa: la planilla todavía no sabe lo que
    // el sistema sabe, y leerla ahora le borraría el enlace o la observación.
    if (sinExportar.has(aviso.oa_number)) continue;

    const { equipment_id, sector_id } = resolver(enlaces, aviso);
    if (!equipment_id) sinEquipo += 1;

    registros.push({ ...aviso, equipment_id, sector_id, synced_at: cuando });
  }

  let guardados = 0;
  const { unicos, repetidos } = unaPorNumero(registros, "oa_number");

  // El área no viene de la planilla —no tiene columna para eso— sino del nombre
  // de quien avisó, y sólo se **completa**: lo que alguien ya eligió en la app
  // no se toca. Ver `areaParaElUpsert` para el porqué, y `repartirPorArea` para
  // por qué van dos upserts y no uno. Se lee acá, después de la planilla y justo
  // antes de escribir, para que la ventana en la que alguien pueda elegir un
  // área sin que la veamos sea la más corta posible.
  const areas = await cargarLasAreasDeLosAvisos(admin);
  const { conArea, sinArea } =
    "error" in areas
      ? { conArea: [], sinArea: unicos }
      : repartirPorArea(
          unicos as (Datos & { oa_number: string; quien_aviso?: string | null })[],
          areas.guardadas,
          areas.areaDe
        );

  for (const grupo of [conArea, sinArea]) {
    for (let i = 0; i < grupo.length; i += 500) {
      const lote = grupo.slice(i, i + 500);
      const { error } = await admin.from("avisos").upsert(lote, { onConflict: "oa_number" });

      if (error) {
        await registrarSincronizacion({
          modulo: "mantenimiento", recurso: "avisos", ok: false, error: error.message,
        });
        return falla(400, error.message);
      }
      guardados += lote.length;
    }
  }

  const borrado = await borrarLoQueLaPlanillaNoTrajo(admin, ESPEJO_DE_AVISOS, {
    clavesLeidas: trajoLaPlanilla,
    cuando, inicio, sinFreno: opciones.sinFreno, actor: opciones.actor,
  });

  // Si no se pudieron leer las áreas, la corrida **no se anota como limpia**: el
  // JSON de abajo lo ve quien la dispara a mano, pero el cron corre solo, y si
  // esa lectura fallara todos los días los avisos nuevos entrarían sin área sin
  // que nadie se enterara. Se anota como el resto de los fallos —`ok: false` y
  // el motivo en `error`—, que es lo que la pantalla de Avisos muestra en rojo
  // con el texto al pasar el mouse. Los avisos sí se guardaron, y el mensaje lo
  // dice para que no se lea como una corrida perdida.
  await registrarSincronizacion(
    "error" in areas
      ? {
          modulo: "mantenimiento", recurso: "avisos", ok: false, filas: guardados,
          error: `Los avisos se guardaron pero no se pudieron leer las áreas: ${areas.error}`,
        }
      : { modulo: "mantenimiento", recurso: "avisos", ok: true, filas: guardados }
  );
  return logra({
    leidas: filas.length - 1, guardados, sin_equipo: sinEquipo,
    numeros_repetidos: repetidos,
    areas_completadas: conArea.length,
    // Sólo cuando lo hay, para que no sea un campo que está siempre en null y
    // se deja de mirar. Hoy el único caso es la migración sin aplicar.
    ...(colaSinLeer ? { cola_sin_leer: colaSinLeer } : {}),
    // Un fallo acá no frena la corrida, así que se dice en el resultado: si no,
    // los avisos nuevos quedarían sin área sin que nadie supiera por qué.
    ...("error" in areas ? { area_sin_leer: areas.error } : {}),
    borrados: borrado.borradas, borrado: borrado.aviso,
  });
}

/** Trae las órdenes de trabajo de su planilla. */
/**
 * Las órdenes cuyo estado, cierre, horas u operarios todavía no llegaron al
 * master. Devuelve los `ot_number` que **siguen** pendientes después de
 * intentarlo.
 *
 * Corre **antes de importar**, y ése es el punto. Una OT creada desde el
 * sistema nace con esos datos y su fila del master todavía no existe —llega por
 * `IMPORTRANGE` y tarda—, así que el alta no los pudo escribir. Si se importara
 * primero, el master —con la `M` y la `O` vacías— le borraría el estado y las
 * horas justo antes de que los exportemos.
 *
 * Y lo que sigue pendiente, la importación **no lo pisa**: la planilla todavía
 * no sabe lo que el sistema sabe. Es el mismo principio que `editado_en_app` en
 * Compras y que "no pisa lo que una persona corrigió" en las marcaciones.
 *
 * ── DESDE EL 21/10/2026 YA NO ES EL ÚNICO DRENAJE, Y ESO ERA EL PROBLEMA ────
 *
 * Esto era lo único que vaciaba la cola, y corre con la sincronización: en la
 * práctica **cada 3 a 5 horas**, no cada quince minutos como dice su workflow.
 * Medido: de la K en adelante, las columnas que sólo viven en el master
 * tardaban entre 3 horas y 53 en llegar, y dos órdenes estaban esperando desde
 * hacía horas. Ahora también lo llaman el `after()` de la ruta de alta —que
 * insiste cuatro minutos— y la pantalla de Órdenes al abrirse. Esto queda de
 * piso: es lo que agarra lo que aquéllos no pudieron.
 *
 * `conFreno` es para esos dos: no reintenta una orden que se intentó hace menos
 * de diez minutos, porque la pantalla se abre todo el día y una orden que no se
 * va a poder escribir nunca haría una lectura del master por cada visita.
 */
export async function exportarLoPendiente(
  admin: ReturnType<typeof createAdminClient>,
  opciones: { conFreno?: boolean } = {}
): Promise<Set<number>> {
  const siguenPendientes = new Set<number>();

  const { data: todos } = await admin
    .from("ordenes_trabajo")
    .select("id, ot_number, estado, fecha_cierre, horas, contratista, operario_1, operario_2, operario_3, sheets_intentado_en")
    .not("sheets_pendiente", "is", null);

  // Con freno cuando lo dispara una visita a la pantalla, y sin freno cuando lo
  // dispara la sincronización: ésa es el piso y tiene que intentarlo todo. Ver
  // `MINIMO_ENTRE_INTENTOS_MS`.
  const pendientes = opciones.conFreno
    ? cualesReintentar(todos ?? [], Date.now())
    : (todos ?? []);

  for (const orden of pendientes) {
    const registro = loQueHayQueExportar(orden);

    // Dejó de tener algo que exportar: alguien lo borró o lo cambió en el
    // sistema. Se limpia la marca en vez de reintentar para siempre.
    if (!registro) {
      await admin.from("ordenes_trabajo")
        .update({ sheets_pendiente: null, sheets_intentado_en: new Date().toISOString() })
        .eq("id", orden.id);
      continue;
    }

    const fallo = await escribirEnLaFilaDeLaOT(orden, celdasParaRegistrar(registro));
    if (fallo) siguenPendientes.add(orden.ot_number as number);

    await admin.from("ordenes_trabajo")
      .update({ sheets_pendiente: fallo, sheets_intentado_en: new Date().toISOString() })
      .eq("id", orden.id);
  }

  return siguenPendientes;
}

/**
 * Contrasta los dos lados y deja anotado lo que no coincide.
 *
 * Corre dentro de la sincronización y **antes del upsert**, que es el único
 * momento en que las dos versiones existen a la vez: después, el sistema es la
 * planilla por construcción. Lo que queda anotado es, entonces, exactamente lo
 * que esta corrida está por reemplazar sin que nadie se entere.
 *
 * **La tabla se rehace entera**: una divergencia que se arregló tiene que
 * desaparecer sola, porque su tamaño es lo que cuenta el aviso. Si las filas se
 * acumularan, el aviso contaría problemas viejos y dejaría de mirarse.
 *
 * **Nunca tira.** Si la tabla todavía no existe —la migración la corre una
 * persona— o la escritura falla, se devuelve el motivo y la sincronización
 * sigue. Importar las órdenes es lo que no puede fallar; anotar lo que hay que
 * mirar es valioso y es secundario, y romper lo primero por lo segundo sería
 * exactamente el mal negocio que este módulo ya aprendió con los carteles del
 * listado.
 */
async function anotarLasDivergencias(
  admin: ReturnType<typeof createAdminClient>,
  deLaPlanilla: readonly OrdenLeida[]
): Promise<{ cuantas: number; recortadas: number; error: string | null }> {
  const vacio = { cuantas: 0, recortadas: 0 };
  try {
    // `traerTodo` porque son 2.300 y PostgREST corta en 1.000 sin avisar.
    const delSistema = await traerTodo<OrdenDelSistema>((desde, hasta) =>
      admin
        .from("ordenes_trabajo")
        .select("ot_number, sector_raw, equipo_raw, especialidad, tipo, quien, descripcion, fecha_ejecucion, fecha_cierre, estado, contratista, horas, operario_1, operario_2, operario_3, prioridad, sheets_pendiente, fecha_ejecucion_pendiente")
        .range(desde, hasta)
    );

    const { filas, total, recortadas } = loQueSeGuardaDelContraste(
      contrastar(delSistema, deLaPlanilla)
    );

    // Se vacía y se vuelve a llenar. PostgREST exige un filtro para borrar, y
    // `ot_number >= 0` las toma todas: los números de OT son positivos.
    const borrado = await admin.from("mantenimiento_divergencias").delete().gte("ot_number", 0);
    if (borrado.error) return { ...vacio, error: borrado.error.message };

    if (filas.length > 0) {
      const alta = await admin.from("mantenimiento_divergencias").insert(filas);
      if (alta.error) return { ...vacio, error: alta.error.message };
    }

    return { cuantas: total, recortadas, error: null };
  } catch (e) {
    return { ...vacio, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function sincronizarOrdenes(opciones: OpcionesDeCorrida = {}): Promise<Resultado> {
  const planilla = process.env.GOOGLE_SHEETS_OT_ID ?? "";
  const pestana = process.env.GOOGLE_SHEETS_OT_TAB ?? "OT";
  if (!planilla) return falla(503, "Falta configurar GOOGLE_SHEETS_OT_ID");

  const inicio = new Date().toISOString();

  // Primero sale lo que el sistema sabe y la planilla no. Después se lee: así
  // lo que acabamos de escribir vuelve con el resto, en vez de ser pisado por
  // una columna vacía.
  const admin = createAdminClient();
  const sinExportar = await exportarLoPendiente(admin);

  let filas: string[][];
  try {
    filas = await leerValores(planilla, pestana, { sinFormato: true });
  } catch (e) {
    return falla(502, await porQueNoSeLeyo(planilla, pestana, e, "GOOGLE_SHEETS_OT_TAB"));
  }

  if (filas.length < 2) return logra({ leidas: 0, guardadas: 0, sin_equipo: 0 });

  const enlaces = await cargarEnlaces(admin);
  const cuando = new Date().toISOString();

  const registros: Datos[] = [];
  const sinProveedor = new Set<string>();
  let sinEquipo = 0;

  // Lo que la planilla trajo, **esté o no entre lo que vamos a escribir**.
  //
  // Es lo que después decide quién sobra, y por eso se cuenta acá arriba y no
  // de `unicos`: una orden salteada por tener la exportación pendiente sigue
  // estando en la planilla, así que contarla como ausente es decir que alguien
  // la borró de ahí. Eso la mandaba a `borrarLoQueLaPlanillaNoTrajo`, donde no
  // la protege nada —`nuncaEstuvoEnLaPlanilla` pide `app_created` y fila nula,
  // y ésta tiene las dos al revés— y se la llevaba con sus notas, sus repuestos
  // y su aviso en cascada. O sea: la marca que existe para que no la pisen la
  // mandaba a borrar. Es la misma lección que Compras pagó con las 1.678 filas
  // `editado_en_app`, y está fijada con un test en `borradoDeEspejo.test.ts`.
  const trajoLaPlanilla = new Set<number>();

  /** Todas las de la planilla, para contrastarlas antes de pisar nada. */
  const leidasDeLaPlanilla: OrdenLeida[] = [];

  // ── LAS FECHAS QUE YA SALIERON Y TODAVIA NO DERRAMARON ────────────────────
  //
  // Postergar una OT escribe su fecha en «Altas del sistema», y de ahi al
  // master derrama entre 3 y 53 horas despues (medido el 21/10/2026). En esa
  // ventana la J del master sigue diciendo la fecha vieja: importarla seria
  // deshacer la postergacion, y a la corrida siguiente volver a deshacerla.
  //
  // `fecha_ejecucion_pendiente` es lo que lo evita. Se lee entero y no por OT
  // porque son dos columnas de una tabla que ya se consulta igual.
  const enCamino = new Map<number, string>();
  {
    const { data } = await admin
      .from("ordenes_trabajo")
      .select("ot_number, fecha_ejecucion_pendiente")
      .not("fecha_ejecucion_pendiente", "is", null);
    for (const o of data ?? []) {
      enCamino.set(o.ot_number as number, String(o.fecha_ejecucion_pendiente));
    }
  }
  /** Las que el derrame ya alcanzo: se les limpia la marca al final. */
  const yaDerramaron: number[] = [];

  for (let i = 0; i < filas.length - 1; i++) {
    const orden = filaDeOrden(filas[i + 1], i + 2);
    if (!orden) continue;

    trajoLaPlanilla.add(orden.ot_number);
    leidasDeLaPlanilla.push(orden);

    // Lo que no se pudo exportar no se pisa: la planilla todavía no sabe lo
    // que el sistema sabe, y leerla ahora le borraría el estado y las horas.
    if (sinExportar.has(orden.ot_number)) continue;

    const { equipment_id, sector_id } = resolver(enlaces, orden);
    if (!equipment_id) sinEquipo += 1;

    // El contratista es un proveedor del SdG: si lo reconocemos, se enlaza.
    // El nombre crudo se conserva porque es lo que dice la planilla.
    const proveedor_id = proveedorDe(enlaces, orden.contratista);
    if (orden.contratista && !proveedor_id) sinProveedor.add(orden.contratista);

    // Una fecha en camino no se pisa con la del master. Y si el master YA la
    // trae, el derrame llego: se importa normal y la marca se limpia al final.
    // Limpiarla acá, antes de que el upsert entre, dejaría la OT descubierta
    // si el lote falla.
    const esperando = enCamino.get(orden.ot_number);
    const fecha_ejecucion = esperando && esperando !== orden.fecha_ejecucion
      ? esperando
      : orden.fecha_ejecucion;
    if (esperando && esperando === orden.fecha_ejecucion) yaDerramaron.push(orden.ot_number);

    // `paraLaBase` y no `...orden`: la orden leída lleva campos que no son
    // columnas —hoy `estado_raw`, que es del contraste— y PostgREST corta el
    // lote entero si le llega uno. Ver el comentario de esa función.
    registros.push({
      ...paraLaBase(orden), fecha_ejecucion, equipment_id, sector_id, proveedor_id, synced_at: cuando,
    });
  }

  // ── EL CONTRASTE VA ACÁ: ANTES DE PISAR, NO DESPUÉS ───────────────────────
  //
  // Después del upsert los dos lados coinciden por construcción, así que
  // contrastar ahí sólo encontraría lo que la importación salteó. Lo que
  // importa es justamente lo otro: la orden que decía algo distinto y que esta
  // misma corrida está por reemplazar con lo de la planilla. Eso es lo que se
  // perdía en silencio, y es lo que queda anotado.
  //
  // No cuesta ninguna lectura de Google: la planilla ya está leída. Lo único
  // que suma es traer las columnas del sistema, que es lo que `contrastar`
  // necesita del otro lado.
  const divergencias = await anotarLasDivergencias(admin, leidasDeLaPlanilla);

  let guardadas = 0;
  const { unicos, repetidos } = unaPorNumero(registros, "ot_number");

  for (let i = 0; i < unicos.length; i += 500) {
    const lote = unicos.slice(i, i + 500);
    const { error } = await admin
      .from("ordenes_trabajo")
      .upsert(lote, { onConflict: "ot_number" });

    if (error) {
      await registrarSincronizacion({
        modulo: "mantenimiento", recurso: "ordenes", ok: false, error: error.message,
      });
      return falla(400, error.message);
    }
    guardadas += lote.length;
  }

  // El derrame alcanzó a estas: el master ya dice la fecha que se había
  // escrito, así que la marca dejó de proteger algo y se saca. Va DESPUÉS del
  // upsert a propósito —si el lote hubiera fallado, la OT tiene que seguir
  // protegida— y es lo único que cierra el ciclo: sin esto la marca quedaría
  // puesta para siempre y la OT invisible para el contraste.
  if (yaDerramaron.length > 0) {
    await admin
      .from("ordenes_trabajo")
      .update({ fecha_ejecucion_pendiente: null })
      .in("ot_number", yaDerramaron);
  }

  const borrado = await borrarLoQueLaPlanillaNoTrajo(admin, ESPEJO_DE_OT, {
    clavesLeidas: trajoLaPlanilla,
    cuando, inicio, sinFreno: opciones.sinFreno, actor: opciones.actor,
  });

  await registrarSincronizacion({
    modulo: "mantenimiento", recurso: "ordenes", ok: true, filas: guardadas,
  });
  return logra({
    leidas: filas.length - 1,
    guardadas,
    sin_equipo: sinEquipo,
    numeros_repetidos: repetidos,
    sin_proveedor: [...sinProveedor],
    borradas: borrado.borradas,
    borrado: borrado.aviso,
    // Cuántas dicen distinto los dos lados. Va en el resultado aunque el aviso
    // ya lo cuente: quien corre la sincronización a mano lo ve en el momento.
    fechas_que_derramaron: yaDerramaron.length,
    divergencias: divergencias.cuantas,
    ...(divergencias.recortadas > 0 ? { divergencias_recortadas: divergencias.recortadas } : {}),
    // Un fallo acá no frena la corrida —anotar es secundario, importar no—, así
    // que se dice. Mientras la migración no esté corrida, esto dice por qué.
    ...(divergencias.error ? { divergencias_sin_anotar: divergencias.error } : {}),
  });
}

/**
 * Reescribe el seguimiento de las OS que no llegaron a la planilla, y devuelve
 * los números que **siguen** sin llegar.
 *
 * Gemela de `exportarLoPendiente` para las órdenes de trabajo, y existe por lo
 * mismo: `filaDeOS` vuelve a leer las cinco columnas del seguimiento, así que
 * importar una OS cuyo cambio todavía no se exportó la pisa con la celda vieja.
 * Los números que vuelven son los que la importación tiene que saltear.
 *
 * Sin freno de tiempo, a diferencia de la de OT: acá no hay un botón de
 * pantalla que la dispare: la llama sólo la sincronización, que es el piso y
 * tiene que intentarlo todo.
 */
export async function exportarLoPendienteDeOS(
  admin: ReturnType<typeof createAdminClient>
): Promise<{ siguenPendientes: Set<number>; problema: string | null }> {
  const siguenPendientes = new Set<number>();

  // La cadena va literal y no armada en una variable: así Supabase infiere los
  // tipos de lo que vuelve. Es la regla del CLAUDE.md, y acá avisó con un
  // `GenericStringError` en vez de dejarlo pasar.
  const { data: pendientes, error } = await admin
    .from("ordenes_servicio")
    .select("id, os_number, sheets_tab, sheets_row, estado, proveedor_elegido, fecha_pedido, fecha_realizacion, observaciones")
    .not("sheets_pendiente", "is", null);

  // **Y si no se pudo leer la cola, se dice.** El caso concreto es la migración
  // `20261026112137` sin aplicar: PostgREST contesta que no existe la columna,
  // `data` viene null y el `?? []` de abajo haría que esto no reintentara nada
  // y no salteara nada — o sea, la protección apagada, importando igual y sin
  // una palabra. Un diagnóstico que no se distingue del éxito es peor que
  // ninguno. No aborta la corrida: traer las OS sigue siendo mejor que no
  // traerlas, pero quien mire la sincronización tiene que ver por qué.
  if (error) {
    return {
      siguenPendientes,
      problema:
        `No se pudo leer la cola de exportación de las OS, así que esta corrida no ` +
        `reintentó nada y pudo pisar un seguimiento sin exportar: ${error.message}`,
    };
  }

  for (const os of pendientes ?? []) {
    const campos = loQueHayQueExportarDeLaOS(os);

    // Dejó de tener algo que exportar: alguien lo borró o lo cambió en el
    // sistema. Se limpia la marca en vez de reintentar para siempre.
    if (!campos) {
      await admin.from("ordenes_servicio")
        .update({ sheets_pendiente: null, sheets_intentado_en: new Date().toISOString() })
        .eq("id", os.id);
      continue;
    }

    const fallo = await escribirEnLaFilaDeLaOS(os, campos);
    if (fallo) siguenPendientes.add(os.os_number as number);

    await admin.from("ordenes_servicio")
      .update({ sheets_pendiente: fallo, sheets_intentado_en: new Date().toISOString() })
      .eq("id", os.id);
  }

  return { siguenPendientes, problema: null };
}

/** Trae las órdenes de servicio de su planilla, una pestaña por área. */
export async function sincronizarOrdenesDeServicio(opciones: OpcionesDeCorrida = {}): Promise<Resultado> {
  const planilla = process.env.GOOGLE_SHEETS_OS_ID ?? "";
  if (!planilla) return falla(503, "Falta configurar GOOGLE_SHEETS_OS_ID");

  const inicio = new Date().toISOString();
  const admin = createAdminClient();

  // Primero sale lo que el sistema sabe y la planilla no, igual que en las OT:
  // así lo que acabamos de escribir vuelve con el resto en la lectura de abajo,
  // en vez de ser pisado por una columna vieja.
  const { siguenPendientes: sinExportar, problema: colaSinLeer } =
    await exportarLoPendienteDeOS(admin);

  const enlaces = await cargarEnlaces(admin);
  const cuando = new Date().toISOString();

  // Una OS puede aparecer en la hoja maestra y en la de su área: se queda la
  // última leída, que es la que trae el seguimiento.
  const porNumero = new Map<number, Datos>();
  /** Lo que la planilla trajo, esté o no entre lo que vamos a escribir. */
  const trajoLaPlanilla = new Set<number>();
  const sinLeer: string[] = [];
  const huerfanas: string[] = [];
  const sinProveedor = new Set<string>();
  let sinEquipo = 0;

  for (const pestana of OS_PESTANAS) {
    let filas: string[][];
    try {
      filas = await leerValores(planilla, pestana, { sinFormato: true });
    } catch {
      sinLeer.push(pestana);
      continue;
    }
    if (filas.length < 2) continue;

    const idx = mapearEncabezados(filas[0]);

    // La comparativa es un `HYPERLINK` y la celda sólo muestra "LINK": la URL
    // hay que sacarla de la fórmula o se guarda la palabra.
    const formulas = idx.comparativa >= 0
      ? await leerFormulas(planilla, pestana).catch(() => [] as string[][])
      : [];

    for (let i = 1; i < filas.length; i++) {
      const os = filaDeOS(filas[i], idx, pestana, i + 1);

      if (!os) {
        // Seguimiento sin orden: el FILTER corrió las filas y lo escrito a
        // mano quedó colgado de ninguna OS. No se importa, se avisa.
        if (seguimientoHuerfano(filas[i])) huerfanas.push(`${pestana}!${i + 1}`);
        continue;
      }

      // Contada como traída antes del salteo, no después: una OS salteada
      // sigue estando en la planilla, y dejarla afuera de `clavesLeidas` la
      // manda a borrar. Ver el comentario largo en `sincronizarOrdenes`.
      trajoLaPlanilla.add(os.os_number);

      // Lo que no se pudo exportar no se pisa: la planilla todavía no sabe lo
      // que el sistema sabe, y leerla ahora le borraría el seguimiento.
      if (sinExportar.has(os.os_number)) continue;

      const link = linkDeCelda(formulas[i]?.[idx.comparativa], null);
      const { equipment_id, sector_id } = resolver(enlaces, os);
      if (!equipment_id) sinEquipo += 1;

      const proveedor_id = proveedorDe(enlaces, os.proveedor_elegido);
      if (os.proveedor_elegido && !proveedor_id) sinProveedor.add(os.proveedor_elegido);

      porNumero.set(os.os_number, {
        ...os,
        comparativa: link ?? os.comparativa,
        equipment_id,
        sector_id,
        proveedor_id,
        synced_at: cuando,
      });
    }
  }

  const registros = [...porNumero.values()];
  if (registros.length === 0) {
    return falla(
      502,
      sinLeer.length === OS_PESTANAS.length
        ? "No se pudo leer ninguna pestaña de la planilla."
        : "La planilla no tiene ninguna orden de servicio cargada.",
      { sin_leer: sinLeer, pestanas: await listarPestanas(planilla).catch(() => []) }
    );
  }

  // Qué números ya estaban, para saber cuáles nacen en esta corrida. Va antes
  // del `upsert` porque después todas existen y la pregunta deja de tener
  // respuesta — a diferencia de Compras, que distingue el alta de la
  // actualización dentro de su propio bucle.
  //
  // `traerTodo` y no un `select` pelado: son 261 filas hoy, pero PostgREST
  // corta en 1000 sin avisar y el día que se pase, esto empezaría a anunciar
  // como nuevas las que quedaron afuera de la primera página.
  const yaEstaban = new Set(
    (
      await traerTodo<{ os_number: number }>((desde, hasta) =>
        admin.from("ordenes_servicio").select("os_number").range(desde, hasta)
      )
    ).map((o) => o.os_number)
  );

  let guardadas = 0;
  for (let i = 0; i < registros.length; i += 500) {
    const lote = registros.slice(i, i + 500);
    const { error } = await admin
      .from("ordenes_servicio")
      .upsert(lote, { onConflict: "os_number" });

    if (error) {
      await registrarSincronizacion({
        modulo: "mantenimiento", recurso: "ordenes-servicio", ok: false, error: error.message,
      });
      return falla(400, error.message);
    }
    guardadas += lote.length;
  }

  // `sinLeer` entra como freno: la OS lee una pestaña por área, y si falla la
  // de Calcinación sus órdenes faltan en bloque. Borrarlas sería vaciar un
  // área entera por un error de red.
  const borrado = await borrarLoQueLaPlanillaNoTrajo(admin, ESPEJO_DE_OS, {
    clavesLeidas: trajoLaPlanilla,
    cuando, inicio, fuentesSinLeer: sinLeer,
    sinFreno: opciones.sinFreno, actor: opciones.actor,
  });

  await registrarSincronizacion({
    modulo: "mantenimiento", recurso: "ordenes-servicio", ok: true, filas: guardadas,
  });

  // El aviso al instante a quien aprueba una OS. Va al final, después de que
  // todo está guardado y registrado: `avisarAQuienDecide` no tira, así que un
  // push service caído no puede hacer que esta corrida figure como fallada.
  //
  // La url es la de Compras y no la de Mantenimiento: las órdenes de servicio
  // se aprueban en /compras/aprobaciones, que es donde se ejerce la decisión,
  // aunque la OS sea una entidad de este módulo.
  const aviso = await avisarAQuienDecide(admin, {
    lista: "os_aprobadores",
    // El cast es por `Datos = Record<string, unknown>`, que es como se arma lo
    // que va al `upsert`: los cuatro campos los pone `filaDeOS` y están
    // declarados en `OrdenServicioLeida`, pero el tipo del mapa los borra.
    items: lasOSQueNacenEsperando(
      registros as unknown as Parameters<typeof lasOSQueNacenEsperando>[0],
      yaEstaban
    ),
    nombre: { singular: "Una orden de servicio", plural: "órdenes de servicio" },
    url: "/compras/aprobaciones",
  });

  return logra({
    guardadas,
    sin_equipo: sinEquipo,
    sin_leer: sinLeer,
    huerfanas,
    sin_proveedor: [...sinProveedor],
    borradas: borrado.borradas,
    borrado: borrado.aviso,
    // Sólo cuando lo hay, para que no sea un campo que está siempre en null y
    // se deja de mirar. Hoy el único caso es la migración sin aplicar.
    ...(colaSinLeer ? { cola_sin_leer: colaSinLeer } : {}),
    // Un 0 es lo normal: la mayoría de las corridas no traen OS nuevas y fuera
    // de la ventana 7:00–21:00 no se manda nada a propósito.
    avisos_al_instante: aviso.enviadas,
    ...(aviso.motivo ? { avisos_al_instante_motivo: aviso.motivo } : {}),
  });
}

/** Trae las comparativas de proveedores de su planilla. */
export async function sincronizarComparativas(): Promise<Resultado> {
  const planilla = process.env.GOOGLE_SHEETS_COMPARATIVAS_ID ?? "";
  if (!planilla) return falla(503, "Falta configurar GOOGLE_SHEETS_COMPARATIVAS_ID");

  const admin = createAdminClient();
  const enlaces = await cargarEnlaces(admin);

  const cotizaciones: Datos[] = [];
  const sinLeer: string[] = [];
  const sinProveedor = new Set<string>();
  const cuando = new Date().toISOString();

  // Cuántas cotizaciones tenía la planilla y cuáles quedaron a medias.
  //
  // No se cuentan "filas no vacías": las pestañas traen miles de filas de
  // plantilla —formato, fórmulas, textos fijos— y contarlas daba 11.725 contra
  // 159 cargadas, un aviso que decía que faltaban 11.566 cotizaciones que no
  // existen. Se cuenta lo que `pareceCotizacion` reconoce: la fila que trae N°
  // de OS o proveedor, o sea la que alguien escribió.
  //
  // La diferencia con `guardadas` son las que tienen uno de los dos datos y no
  // el otro: quedaron a medias y hay que ir a mirarlas a la planilla.
  let leidas = 0;
  const sinParsear: string[] = [];

  // Una pestaña que la planilla sumó y el sistema no conoce no rompe nada, y
  // ése es el problema: sus cotizaciones no se leen nunca y las que se carguen
  // desde la app para ese sector caen en "Otros". Pasó con `Cantera` y
  // `Despacho`. Que la planilla no se pueda listar no frena la corrida: es un
  // aviso, no la sincronización.
  let pestanasNuevas: string[] = [];
  try {
    pestanasNuevas = pestanasQueFaltan(await listarPestanas(planilla));
  } catch {
    // Sin la lista no hay aviso que dar, y las pestañas conocidas se leen igual.
  }

  for (const pestana of COMPARATIVA_PESTANAS) {
    let filas: string[][];
    try {
      filas = await leerValores(planilla, pestana, { sinFormato: true });
    } catch {
      // Una pestaña que se renombró o se borró no puede frenar a las otras
      // once, pero tiene que verse en el resultado.
      sinLeer.push(pestana);
      continue;
    }

    for (let i = 1; i < filas.length; i++) {
      if (!pareceCotizacion(filas[i])) continue;
      leidas += 1;

      const cot = filaDeComparativa(filas[i], i + 1, pestana);
      if (!cot) {
        sinParsear.push(`${pestana}!${i + 1}`);
        continue;
      }

      const proveedor_id = proveedorDe(enlaces, cot.proveedor);
      if (!proveedor_id) sinProveedor.add(cot.proveedor);

      // La cotización dice de qué máquina es: sirve para ver lo que se cotizó
      // de un equipo sin pasar por la OS.
      const { equipment_id } = resolver(enlaces, cot);

      cotizaciones.push({ ...cot, proveedor_id, equipment_id, synced_at: cuando });
    }
  }

  // Sin nada leído no se toca el espejo: una planilla inaccesible lo borraría
  // entero y no habría con qué volver a armarlo.
  if (cotizaciones.length === 0) {
    return falla(
      502,
      sinLeer.length === COMPARATIVA_PESTANAS.length
        ? "No se pudo leer ninguna pestaña de la planilla."
        : "La planilla no tiene ninguna cotización cargada.",
      { sin_leer: sinLeer }
    );
  }

  // Refresco completo: en la planilla se corrigen y se borran filas, y sólo
  // volviendo a leerla entera queda igual de los dos lados.
  //
  // SE ESCRIBE CADA FILA SOBRE LA SUYA, DESPUÉS SE BORRA LO QUE SOBRÓ. Las dos
  // formas anteriores estaban mal, cada una a su manera:
  //
  //   - Borrar y después insertar deja la tabla VACÍA entre el DELETE y el
  //     primer INSERT, y esto corre cada 15 minutos: una pantalla que lea justo
  //     ahí no ve ninguna cotización. Y si falla el lote 3 de 5, el espejo
  //     queda borrado a medias: lo viejo ya no está y lo nuevo está incompleto.
  //
  //   - Insertar y después borrar —que es como estaba— apostaba a que por unos
  //     segundos hubiera filas repetidas, distinguidas por `synced_at`. Con un
  //     comentario que decía "no hace falta clave única". La clave única existe
  //     desde el esquema original de la app de Mantenimiento —
  //     `os_comparativas_sheets_tab_sheets_row_key`, sobre (sheets_tab,
  //     sheets_row)— y no está en ninguna migración de este repo, así que no se
  //     la vio. La copia nueva de cada fila chocaba con la vieja y el primer
  //     lote se caía entero: el espejo quedó congelado tres días con 152
  //     cotizaciones del 1 de septiembre, y cada corrida repitiendo el mismo
  //     error.
  //
  // El `upsert` sobre esa clave no tiene ninguna de las dos ventanas: cada
  // cotización se escribe encima de la suya, la tabla nunca queda vacía ni con
  // duplicados, y si falla un lote lo anterior sigue completo. De paso el `id`
  // de cada cotización deja de cambiar en cada corrida —antes se borraba y se
  // insertaba de nuevo—, así que la pantalla que tenía una lista cargada puede
  // elegir una sin que el id ya no exista.
  //
  // La dedupe es la trampa de siempre: un lote con la misma clave dos veces
  // aborta el lote entero.
  const { unicos, repetidos } = unaPorCelda(cotizaciones);

  let guardadas = 0;
  for (let i = 0; i < unicos.length; i += 500) {
    const lote = unicos.slice(i, i + 500);
    const { error } = await admin
      .from("os_comparativas")
      .upsert(lote, { onConflict: "sheets_tab,sheets_row" });

    if (error) {
      await registrarSincronizacion({
        modulo: "mantenimiento", recurso: "comparativas", ok: false, error: error.message,
      });
      return falla(400, `No se guardó nada nuevo y el espejo anterior quedó intacto. ${error.message}`);
    }
    guardadas += lote.length;
  }

  // Lo que sobró son las cotizaciones cuya celda ya no está en la planilla:
  // filas que alguien borró, o que el orden movió. El `upsert` no las puede
  // alcanzar —nadie escribió encima de ellas— así que se van por `synced_at`.
  //
  // Que esto falle no tira abajo la corrida: lo nuevo ya está guardado y no
  // falta nada, sólo quedan de más unas cotizaciones que la planilla ya no
  // tiene. Se avisa y la próxima limpia.
  //
  // Las cargadas desde la app no corren riesgo acá aunque su celda sea nueva:
  // el POST escribe primero la fila en la planilla y guarda esa celda, así que
  // la corrida siguiente la lee y la pisa.
  const { error: errorBorrado } = await admin
    .from("os_comparativas")
    .delete()
    .neq("synced_at", cuando);

  const sobrantes = errorBorrado
    ? `Quedaron cotizaciones que la planilla ya no tiene, sin borrar (${errorBorrado.message}). ` +
      "Se van a ver de más hasta la próxima sincronización."
    : null;

  // Una celda leída dos veces no se resuelve en silencio: se dice cuál, porque
  // el problema está en la planilla y ahí hay que ir a mirarlo.
  const celdasRepetidas = repetidos.length > 0
    ? `Se leyeron ${repetidos.length} celda(s) más de una vez: ${repetidos.join(", ")}. ` +
      "Quedó la última de cada una."
    : null;

  // Las filas que la planilla tiene y no se pudieron leer van al registro, no
  // sólo a la respuesta: la respuesta la ve quien apretó el botón, el registro
  // queda para el día que alguien pregunte por qué falta una cotización.
  const noEntraron = sinParsear.length > 0
    ? `${sinParsear.length} fila(s) quedaron a medias —tienen N° de OS o proveedor, no los dos—: ` +
      `${sinParsear.slice(0, 20).join(", ")}${sinParsear.length > 20 ? "…" : ""}.`
    : null;

  const avisoPestanas = pestanasNuevas.length > 0
    ? `La planilla tiene ${pestanasNuevas.length} pestaña(s) que el sistema no conoce: ` +
      `${pestanasNuevas.join(", ")}. Sus cotizaciones no se leen, y una cargada desde ` +
      "la app para esos sectores va a parar a «Otros». Hay que sumarlas a " +
      "COMPARATIVA_PESTANAS."
    : null;

  const aviso =
    [sobrantes, celdasRepetidas, noEntraron, avisoPestanas].filter(Boolean).join(" ") || null;

  const ordenes = new Set(unicos.map((c) => c.os_number)).size;
  await registrarSincronizacion({
    modulo: "mantenimiento", recurso: "comparativas", ok: true, filas: guardadas,
    error: aviso ?? undefined,
  });
  return logra({
    leidas, guardadas, ordenes,
    sin_leer: sinLeer, sin_proveedor: [...sinProveedor],
    ...(sinParsear.length > 0 ? { sin_parsear: sinParsear } : {}),
    ...(sobrantes ? { sobrantes } : {}),
    ...(celdasRepetidas ? { celdas_repetidas: repetidos } : {}),
    ...(pestanasNuevas.length > 0 ? { pestanas_nuevas: pestanasNuevas } : {}),
  });
}

/** Las cuatro, en el orden en que conviene traerlas. */
export const SINCRONIZACIONES = [
  // Los equipos y sectores ya están; lo demás cuelga de ellos. Las órdenes de
  // servicio antes que sus comparativas, para que una cotización nunca quede
  // apuntando a una OS que todavía no existe.
  //
  // Las cuatro se envuelven con la misma firma para que el reloj pueda decir
  // quién es: sin eso, un borrado hecho por el cron de las 6 queda en la
  // auditoría indistinguible del que hizo alguien apretando el botón, que es
  // justo la diferencia para la que existe la columna `actor`. Comparativas
  // acepta las opciones y no las usa: su borrado es anterior a todo esto.
  { recurso: "avisos", correr: (o?: OpcionesDeCorrida) => sincronizarAvisos(o) },
  { recurso: "ordenes", correr: (o?: OpcionesDeCorrida) => sincronizarOrdenes(o) },
  { recurso: "ordenes-servicio", correr: (o?: OpcionesDeCorrida) => sincronizarOrdenesDeServicio(o) },
  { recurso: "comparativas", correr: (_o?: OpcionesDeCorrida) => sincronizarComparativas() },
  // ── Y AL FINAL, LAS PERIÓDICAS ────────────────────────────────────────────
  //
  // Va **después** de `ordenes` y no antes, y es la única razón por la que
  // tiene un lugar fijo en esta lista: una OT recién creada todavía no está en
  // el master —su fila llega por `IMPORTRANGE`—, así que si la importación
  // corriera después la encontraría ausente. No la borra, porque `app_created`
  // con `sheets_row` en null la protege, pero igual no tiene sentido crear algo
  // y leer la planilla sin eso adentro en la misma corrida.
  //
  // No tira: `generarLasPeriodicas` devuelve qué pasó con cada programado y
  // esto lo pasa a `Resultado`. Un programado que no se pudo crear no frena al
  // siguiente, y ninguno frena las cuatro sincronizaciones de arriba.
  {
    recurso: "periodicas",
    correr: async (_o?: OpcionesDeCorrida): Promise<Resultado> => {
      const r = await generarLasPeriodicas();
      return logra({
        generadas: r.generadas.length,
        ot: r.generadas.map((g) => g.ot_number),
        incompletos: r.incompletos,
        fallaron: r.fallaron,
        cerrados: r.cerrados,
      });
    },
  },
] as const;
