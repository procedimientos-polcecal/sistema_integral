/**
 * El alta de un requerimiento, escrita donde la planilla la puede recibir.
 *
 * Está aparte de `sheets.ts` porque es **otra planilla**: la de respuestas del
 * formulario de Google (`FORM PEDIDO DE COMPRA POLCECAL - POLYSAN`), con otro
 * id, otra hoja y otro encabezado. `sheets.ts` espeja PEDIDOS DE COMPRA y ya
 * tiene 1.100 líneas haciendo eso.
 *
 * POR QUÉ ACÁ Y NO EN EL MASTER
 *
 * En el master las columnas del alta no son datos: `A2` es un
 * `QUERY(IMPORTRANGE(...))` de esta hoja de respuestas, y su salida ocupa A:J.
 * Las pestañas por área son a su vez un `FILTER` del master. O sea que el alta
 * no se puede escribir ni en el master ni en la pestaña del área: se escribe
 * una planilla más arriba y baja sola.
 *
 * Ver `docs/COMPRAS-SINCRONIZACION.md` y el spec del 09/09/2026.
 */

import { norm } from "@/lib/compras/texto";
import { serialDelDia, serialDelInstante } from "@/lib/core/fechaDeSheets";
import { letraDeColumna } from "@/lib/core/columnaDeSheets";
import { createAdminClient } from "@/lib/supabase/admin";
import { leerValores, escribirCeldas, filaSiguienteSegunLaColumna } from "@/lib/core/sheets";
import { empresaParaPlanilla } from "@/lib/compras/sheets";

/**
 * Cómo se llama cada columna en la hoja. La primera que exista gana.
 *
 * Sólo entran alias que `clave()` distingue entre sí. `"N° RI"` (grado),
 * `"AREA"` sin tilde, `"CÓDIGO"` con tilde y `"DESCRIPCION"` sin tilde no
 * están: `clave()` ya les saca el acento y el `°`/`º`, así que quedan idénticas
 * a la anterior de su misma lista y nunca se pueden alcanzar. Tenerlas no
 * cambiaba qué columna se encuentra — sólo ensuciaba los motivos con un alias que
 * la comparación real ya había descartado (`"area (ÁREA o AREA)"`, que se
 * contradice solo).
 */
const ALIAS = {
  nro_ri: ["Nº RI", "NRO RI"],
  marca: ["Marca temporal", "Timestamp"],
  nombre: ["Nombre"],
  apellido: ["Apellido"],
  area: ["ÁREA"],
  descripcion: ["DESCRIPCIÓN DEL PEDIDO", "DESCRIPCIÓN"],
  codigo: ["CODIGO"],
  cantidad: ["CANTIDAD A PEDIR", "CANTIDAD", "CAN"],
  ubicacion: ["PARA DONDE SE NECESITA", "DONDE SE NECESITA"],
  fecha_necesidad: ["PARA CUANDO SE NECESITA", "FECHA DE REQUERIMIENTO"],
  detalle_extra: ["DETALLES EXTRA", "DETALLE EXTRA"],
  imagen: ["ARCHIVO COMPLEMENTARIO", "IMAGEN COMPLEMENTARIA", "IMAGEN"],
} as const;

type Clave = keyof typeof ALIAS;

/**
 * Sin qué columnas no se escribe.
 *
 * Son las que hacen que el pedido exista y aparezca donde tiene que aparecer:
 * el número —que lo calcula la fórmula—, la marca temporal —de la que depende
 * esa fórmula—, el área —con la que el `FILTER` de cada pestaña compara letra
 * por letra— y la descripción, que es el pedido. Sin una de ésas, escribir
 * sería dejar una fila que nadie va a poder leer.
 */
const IMPRESCINDIBLES: Clave[] = ["nro_ri", "marca", "area", "descripcion"];

export interface DatosDelAlta {
  nro_ri: number;
  nombre: string;
  apellido: string;
  area: string;
  descripcion: string;
  codigo: string | null;
  cantidad: number | null;
  ubicacion: string | null;
  /** ISO `2026-09-10`, o null si no la pidieron para una fecha. */
  fecha_necesidad: string | null;
  detalle_extra: string | null;
  imagen_url: string | null;
  creado: Date;
}

export interface Celda {
  /** Desde cero, como la espera `escribirCeldas` del núcleo. */
  columna: number;
  valor: string;
}

export type ResultadoCeldas =
  | { ok: true; fila: number; celdas: Celda[] }
  /**
   * `motivos` y no `faltan`: casi siempre es una columna que no está, pero
   * también puede ser una fecha de creación inválida. Un campo con ese nombre
   * obliga a quien lo muestra a mentir —"falta la columna: la marca temporal no
   * es una fecha válida"—, y ese texto va a parar a `sheets_pendiente`, que es
   * lo que alguien lee para saber qué ir a arreglar.
   */
  | { ok: false; motivos: string[] };

/**
 * Compara nombres de columna sin distinguir acentos, mayúsculas ni el signo de
 * grado/ordinal: `norm` ya saca acentos y colapsa `°`/`º`/`.`, y este filtro de
 * más saca lo que le sobreviva (comas, dos puntos) para que sólo queden letras,
 * números y espacios en ambos lados de la comparación.
 */
const clave = (s: string) => norm(s).replace(/[^A-Z0-9 ]/g, "");

/**
 * La primera columna que un alta no puede tocar: donde empieza lo que el
 * `QUERY` del master ignora.
 *
 * No es un conteo (`Object.keys(ALIAS).length`, "las 12 de ALIAS"): eso tenía
 * dos dueños que no se hablaban entre sí. Agregar una pregunta al formulario
 * corre las columnas reales pero no ese número, así que lo que quedaba después
 * de la pregunta nueva caía fuera de la ventana y se omitía sin aviso —medido:
 * una pregunta antes de `ARCHIVO COMPLEMENTARIO` pierde la imagen; cuatro
 * antes de `DESCRIPCIÓN DEL PEDIDO` pierden ubicación, fecha, detalle e
 * imagen, con `ok: true` los dos casos—. Y al revés, agregar un campo a
 * `ALIAS` por una razón sin relación con el ancho de la hoja ensanchaba la
 * ventana y metía en alcance la `M`, que es de Google y no se toca.
 *
 * El borde real es el encabezado mismo: `DIRECCIÓN EMAIL ENVIADA` es la
 * primera columna ajena al `QUERY`, se llame donde se llame. Con un formulario
 * que sólo agrega preguntas, esa columna se corre pero sigue estando, así que
 * el borde se corre con ella y nada de lo anterior se pierde.
 *
 * La comparación es sensible a acentos y mayúsculas —a propósito, sin pasar
 * por `clave()`—: es la misma razón por la que el bug original existía. Si se
 * comparara sin acento, `ÁREA` (columna `E`, la que hay que llenar) y `Area`
 * (columna `O`, la que hay que ignorar) serían el mismo texto, que es
 * exactamente el "enlazar al que se le parece" que el repo prohíbe.
 *
 * Riesgo asumido: si el día de mañana renombran esa columna (o la borran),
 * este borde no aparece y `celdasDelAlta` se niega a escribir en vez de
 * adivinar un ancho. Es la respuesta correcta —negarse deja el problema a la
 * vista—, pero significa que un alta se cae hasta que alguien actualice esta
 * constante o la hoja vuelva a tener la columna con este nombre exacto.
 */
const COLUMNA_BORDE = "DIRECCIÓN EMAIL ENVIADA";

function indiceBorde(encabezado: string[]): number {
  return encabezado.findIndex((h) => h.trim() === COLUMNA_BORDE);
}

/** En qué columna está cada cosa, por nombre y no por posición. */
function indexar(encabezado: string[], borde: number): Record<Clave, number> {
  const normalizado = encabezado.slice(0, borde).map(clave);
  const idx = {} as Record<Clave, number>;

  for (const [c, alias] of Object.entries(ALIAS) as [Clave, readonly string[]][]) {
    idx[c] = -1;
    for (const a of alias) {
      const i = normalizado.indexOf(clave(a));
      if (i >= 0) { idx[c] = i; break; }
    }
  }
  return idx;
}

/**
 * Qué escribir en la fila `fila` de la hoja de respuestas.
 *
 * El N° de RI va como **la misma fórmula que tienen las otras 1.955 filas** y
 * no como número. Dos razones: el que numera sigue siendo uno solo —la
 * planilla—, y la fila que Google agrega en la próxima respuesta copia la
 * fórmula de la de arriba; si arriba encuentra un literal, la serie se corta.
 * Por eso `fila` también vuelve en el resultado cuando `ok: true`: queda
 * horneada en esa fórmula, y si quien escribe usara otra fila por error la
 * fórmula apuntaría al lugar equivocado sin que nada lo note.
 *
 * Las columnas que el `QUERY` del master ignora no se tocan: `DIRECCIÓN EMAIL
 * ENVIADA` la escribe el Apps Script de los avisos, y ponerle algo sería decir
 * que se avisó cuando no se avisó.
 */
export function celdasDelAlta(
  encabezado: string[],
  datos: DatosDelAlta,
  fila: number
): ResultadoCeldas {
  const borde = indiceBorde(encabezado);
  if (borde < 0) {
    return {
      ok: false,
      motivos: [
        `el borde del alta ("${COLUMNA_BORDE}", que separa lo que un alta puede ` +
          `llenar de lo que escribe Google) no está en el encabezado`,
      ],
    };
  }

  const idx = indexar(encabezado, borde);

  const sinColumna = IMPRESCINDIBLES.filter((c) => idx[c] < 0).map(
    (c) => `${c} (${ALIAS[c].join(" o ")})`
  );
  if (sinColumna.length > 0) return { ok: false, motivos: sinColumna };

  // `serialDelInstante` no valida —lo dice su propio docstring, la
  // responsabilidad es de quien llama—: un `creado` inválido da `NaN`, que
  // como texto es "NaN", no vacío para la fórmula del RI (`=IF(B<>"",...)`) y
  // numeraría un pedido con una marca basura, escrita para siempre.
  const serialMarca = serialDelInstante(datos.creado);
  if (!Number.isFinite(serialMarca)) {
    return {
      ok: false,
      motivos: [`marca temporal (datos.creado no es una fecha válida: ${String(datos.creado)})`],
    };
  }

  const marca = letraDeColumna(idx.marca);
  const nro = letraDeColumna(idx.nro_ri);
  const serialNecesidad = datos.fecha_necesidad ? serialDelDia(datos.fecha_necesidad) : null;

  const valores: Partial<Record<Clave, string>> = {
    nro_ri: `=IF(${marca}${fila}:${marca}<>"",${nro}${fila - 1}+1,"")`,
    marca: String(serialMarca),
    nombre: datos.nombre,
    apellido: datos.apellido,
    area: datos.area,
    descripcion: datos.descripcion,
    codigo: datos.codigo ?? "",
    cantidad: datos.cantidad !== null ? String(datos.cantidad) : "",
    ubicacion: datos.ubicacion ?? "",
    fecha_necesidad: serialNecesidad !== null ? String(serialNecesidad) : "",
    detalle_extra: datos.detalle_extra ?? "",
    imagen: datos.imagen_url ?? "",
  };

  const celdas: Celda[] = [];
  for (const [c, valor] of Object.entries(valores) as [Clave, string][]) {
    const columna = idx[c];
    // Una columna que esta hoja no tiene y no es imprescindible: se omite en
    // silencio. No se escribe en una posición inventada.
    if (columna < 0) continue;
    celdas.push({ columna, valor });
  }
  return { ok: true, fila, celdas };
}

/**
 * A qué fila del master corresponde una fila de la hoja de respuestas.
 *
 * El `QUERY` del master lee `A4:L10000` y su salida arranca en la fila 2, así
 * que son dos menos. Es una cuenta y no una búsqueda porque la fórmula conserva
 * el orden de las respuestas y sólo agrega al final; pero la fila del master
 * puede no existir todavía —`IMPORTRANGE` tarda en refrescar—, y por eso quien
 * escribe **verifica antes de escribir** en vez de confiar en la cuenta.
 */
export function filaDelMaster(filaDeRespuestas: number): number | null {
  const fila = filaDeRespuestas - 2;
  return fila >= 2 ? fila : null;
}

const HOJA_RESPUESTAS = "Respuestas de formulario 1";
const HOJA_MASTER = "Requerimientos internos";

const idFormulario = () => process.env.GOOGLE_SHEETS_COMPRAS_FORMULARIO_ID ?? "";

export interface ResultadoAlta {
  /** En qué fila de la hoja de respuestas quedó. */
  fila: number | null;
  /** Qué anotar en `sheets_pendiente`, o null si salió todo bien. */
  pendiente: string | null;
}

/**
 * Escribe el alta de un requerimiento en la hoja de respuestas del formulario.
 *
 * Sin la variable de entorno no hace nada y **no es un error**: se omite, igual
 * que la sincronización sin `GOOGLE_SHEETS_COMPRAS_ID`. Mientras la planilla no
 * esté configurada, el sistema funciona solo.
 *
 * Lo que puede fallar queda en `pendiente` en vez de lanzar: el pedido ya está
 * guardado y perderlo por no poder escribir la planilla sería peor.
 */
export async function exportarAltaAlFormulario(
  requerimientoId: string
): Promise<ResultadoAlta> {
  if (!idFormulario() || !process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return { fila: null, pendiente: null };
  }

  const admin = createAdminClient();
  const { data: r } = await admin
    .from("compras_requerimientos")
    .select("id, nro_ri, descripcion, codigo, cantidad, fecha_necesidad, detalle_extra, imagen_url, created_at, solicitante_id, solicitante_nombre, compras_areas(nombre), compras_ubicaciones(nombre)")
    .eq("id", requerimientoId)
    .single();

  if (!r) return { fila: null, pendiente: null };

  const area = (r.compras_areas as unknown as { nombre: string } | null)?.nombre;
  if (!area) {
    // El área es con lo que el FILTER de cada pestaña compara: sin ella el
    // pedido aparecería en el master y en ninguna pestaña.
    return { fila: null, pendiente: "el pedido no tiene área, y la planilla la necesita" };
  }

  // El nombre y el apellido van en columnas separadas. `solicitante_nombre` los
  // trae pegados, así que se prefiere el usuario.
  let nombre = "";
  let apellido = "";
  if (r.solicitante_id) {
    const { data: u } = await admin
      .from("usuarios")
      .select("nombre, apellido")
      .eq("id", r.solicitante_id as string)
      .single();
    nombre = (u?.nombre as string) ?? "";
    apellido = (u?.apellido as string) ?? "";
  }
  if (!nombre && r.solicitante_nombre) {
    const partes = String(r.solicitante_nombre).trim().split(/\s+/);
    nombre = partes[0] ?? "";
    apellido = partes.slice(1).join(" ");
  }

  try {
    const encabezado = (await leerValores(idFormulario(), `${HOJA_RESPUESTAS}!1:1`))[0] ?? [];

    // La fila libre se busca por la marca temporal y NO por la columna del N°
    // de RI: esa columna tiene una fórmula en todas las filas de la grilla, y
    // aunque hoy devuelva vacío para las filas sin marca, depender de eso es
    // depender de que la fórmula siga escrita igual.
    //
    // `sinFormato: true` acá y no en el encabezado: a `filaSiguienteSegunLaColumna`
    // sólo le importa si la celda tiene algo, no qué dice. Con el texto formateado
    // se corre el mismo riesgo que ya pasó en Despacho con una columna de fecha:
    // un formato particular puede mostrar vacía una celda que sí tiene serial, y
    // ahí la cuenta de la fila libre se corre y una respuesta nueva pisa a otra. El
    // valor crudo no tiene ese problema y no cuesta nada pedirlo así.
    const marcas = await leerValores(idFormulario(), `${HOJA_RESPUESTAS}!B:B`, { sinFormato: true });
    const fila = filaSiguienteSegunLaColumna(marcas);

    const armado = celdasDelAlta(
      encabezado,
      {
        nro_ri: r.nro_ri as number,
        nombre,
        apellido,
        area,
        descripcion: r.descripcion as string,
        codigo: (r.codigo as string | null) ?? null,
        cantidad: (r.cantidad as number | null) ?? null,
        ubicacion: (r.compras_ubicaciones as unknown as { nombre: string } | null)?.nombre ?? null,
        fecha_necesidad: (r.fecha_necesidad as string | null) ?? null,
        detalle_extra: (r.detalle_extra as string | null) ?? null,
        imagen_url: (r.imagen_url as string | null) ?? null,
        creado: new Date((r.created_at as string) ?? Date.now()),
      },
      fila
    );

    if (!armado.ok) {
      return {
        fila: null,
        pendiente: "no se pudo armar la fila del alta: " + armado.motivos.join("; "),
      };
    }

    // Se escribe en la fila que devolvió `celdasDelAlta`, no en la de acá: la
    // fórmula del N° de RI la lleva horneada adentro.
    await escribirCeldas(
      idFormulario(),
      armado.celdas.map((c) => ({
        pestana: HOJA_RESPUESTAS,
        columna: c.columna,
        fila: armado.fila,
        valor: c.valor,
      }))
    );

    // Qué número calculó la planilla. Si no es el que asignó el sistema, hay un
    // hueco o una fila de más: se dice, en vez de dejar dos números para el
    // mismo pedido.
    const escrito = await leerValores(idFormulario(), `${HOJA_RESPUESTAS}!A${armado.fila}`);
    const numeroDeLaPlanilla = Number(String(escrito[0]?.[0] ?? "").replace(/[^0-9]/g, ""));
    if (numeroDeLaPlanilla !== r.nro_ri) {
      return {
        fila: armado.fila,
        pendiente:
          `la planilla numeró esa fila como ${numeroDeLaPlanilla || "(vacío)"} y el sistema ` +
          `la había dado de alta como ${r.nro_ri}: hay que revisar la numeración a mano`,
      };
    }

    await admin
      .from("compras_requerimientos")
      .update({
        hoja_origen: HOJA_MASTER,
        sheets_fila: filaDelMaster(armado.fila),
        sheets_sincronizado_en: new Date().toISOString(),
      })
      .eq("id", requerimientoId);

    return {
      fila: armado.fila,
      pendiente: await escribirPrioridadYEmpresa(admin, r.id as string, armado.fila),
    };
  } catch (e) {
    return { fila: null, pendiente: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Prioridad y empresa, en las columnas a mano del master.
 *
 * Las elige quien pide, en el alta, y en la planilla son dos columnas que no
 * salen de ninguna fórmula. Si no se escriben, quien mira la planilla no las ve.
 *
 * **Se verifica la fila antes de escribir.** La cuenta `fila − 2` vale mientras
 * el `QUERY` conserve el orden, y además `IMPORTRANGE` tarda en refrescar: si la
 * fila del master todavía no dice este N° de RI, no se escribe nada y queda
 * pendiente. Escribir a ciegas sería ponerle la prioridad de este pedido a otro.
 */
async function escribirPrioridadYEmpresa(
  admin: ReturnType<typeof createAdminClient>,
  requerimientoId: string,
  filaDeRespuestas: number
): Promise<string | null> {
  const idMaster = process.env.GOOGLE_SHEETS_COMPRAS_ID;
  const fila = filaDelMaster(filaDeRespuestas);
  if (!idMaster || fila === null) return null;

  const { data: r } = await admin
    .from("compras_requerimientos")
    .select("nro_ri, prioridad, paga_ambas, empresas!empresa_id(nombre)")
    .eq("id", requerimientoId)
    .single();
  if (!r) return null;

  const prioridad = (r.prioridad as string | null) ?? "";
  const empresa = empresaParaPlanilla(
    (r.empresas as unknown as { nombre: string } | null)?.nombre,
    r.paga_ambas === true
  );
  // Una celda que no tenemos con qué llenar no se pisa con vacío. Es el mismo
  // criterio que la celda de comparativa, que borraba el link de la planilla.
  if (!prioridad && !empresa) return null;

  const encabezado = (await leerValores(idMaster, `${HOJA_MASTER}!1:1`))[0] ?? [];
  const columna = (nombres: string[]) => encabezado.findIndex((h) => nombres.includes(norm(h)));

  const colPrioridad = columna(["PRIORIDAD"]);
  const colEmpresa = columna(["EMPRESA", "PAGA"]);
  if (colPrioridad < 0 && colEmpresa < 0) {
    return "el master no tiene columnas de prioridad ni de empresa";
  }

  const enElMaster = await leerValores(idMaster, `${HOJA_MASTER}!A${fila}`);
  const nroEnLaFila = Number(String(enElMaster[0]?.[0] ?? "").replace(/[^0-9]/g, ""));
  if (nroEnLaFila !== r.nro_ri) {
    return (
      `la fila ${fila} del master todavía no dice el RI ${r.nro_ri} (dice ` +
      `${nroEnLaFila || "vacío"}): no se escribieron prioridad ni empresa`
    );
  }

  const celdas = [
    ...(colPrioridad >= 0 && prioridad
      ? [{ pestana: HOJA_MASTER, columna: colPrioridad, fila, valor: prioridad }]
      : []),
    ...(colEmpresa >= 0 && empresa
      ? [{ pestana: HOJA_MASTER, columna: colEmpresa, fila, valor: empresa }]
      : []),
  ];
  await escribirCeldas(idMaster, celdas);
  return null;
}
