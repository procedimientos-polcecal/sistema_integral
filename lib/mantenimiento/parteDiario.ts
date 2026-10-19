/**
 * El parte diario de mantenimiento: varias OT en una hoja.
 *
 * POR QUÉ EXISTE, Y EN QUÉ SE DIFERENCIA DEL OTRO IMPRESO
 *
 * La planificación ya se imprime, pero **una OT por página**: una hoja grande
 * por orden, para llevar al lado de la máquina. Esto es lo otro que se usa en
 * planta — el papel `PARTE DIARIO DE MANTENIMIENTO`, con las OT del turno como
 * renglones de una tabla y un recuadro de observaciones abajo.
 *
 * Son dos cosas distintas y conviven: la de una por página es para hacer el
 * trabajo, ésta es para ver el turno entero de un vistazo.
 *
 * LAS CINCO COLUMNAS SON LAS DEL PAPEL
 *
 * `Nro OT · SECTOR · EQUIPO · TRABAJO REALIZADO · REPUESTOS UTILIZADOS`, en ese
 * orden, porque la hoja impresa tiene que poder apilarse con las que ya están
 * archivadas. Salen de lo que el plan ya sabe de cada OT.
 *
 * POR QUÉ SE PAGINA Y SE RELLENA
 *
 * El papel tiene una cantidad fija de renglones, llenos o vacíos. Un plan de
 * treinta OT en una sola hoja no se puede leer, y uno de dos dejaría media hoja
 * sin la grilla que la gente espera. Entonces: se corta cada
 * `FILAS_POR_HOJA` y la última se completa con renglones vacíos — que además
 * sirven para anotar a mano lo que apareció durante el turno, que es
 * exactamente para lo que los deja el papel.
 */

/** Lo que la hoja necesita de cada ítem del plan. */
export interface ItemDelPlan {
  id: string;
  ot_number: number | null;
  sector_raw: string | null;
  equipo_raw: string | null;
  descripcion: string | null;
  repuesto: string | null;
  orden: number;
}

/** Un renglón de la tabla, con las cinco columnas del papel. */
export interface FilaDelParte {
  /** El id del ítem, o `""` cuando es un renglón de relleno. */
  id: string;
  nroOt: string;
  sector: string;
  equipo: string;
  trabajo: string;
  repuestos: string;
}

/**
 * Cuántos renglones entran en una hoja A4.
 *
 * Ocho, contra el papel: con los márgenes de 10 mm, el encabezado y el recuadro
 * de observaciones, es lo que queda sin que un renglón de descripción larga
 * empuje la tabla a una segunda página. Si se cambia, hay que mirar el impreso
 * de verdad y no sólo la pantalla: el salto se nota recién en papel.
 */
export const FILAS_POR_HOJA = 8;

/** Un renglón vacío, de los que el papel trae para completar a mano. */
const VACIA: FilaDelParte = { id: "", nroOt: "", sector: "", equipo: "", trabajo: "", repuestos: "" };

const texto = (v: string | null | undefined) => (v ?? "").trim();

/**
 * El día, el mes y el año, cada uno en su casillero.
 *
 * Se parte la cadena `aaaa-mm-dd` en vez de construir un `Date`. No es
 * preferencia: un `new Date("2026-10-19")` se interpreta en UTC y en Argentina
 * —UTC−3— se lee como el 18 a las 21, así que la hoja saldría fechada el día
 * anterior. El otro impreso lo esquiva sumando `T12:00:00`; acá directamente no
 * hay ninguna zona horaria de por medio.
 */
export function diaMesAnio(fecha: string | null | undefined): { dia: string; mes: string; anio: string } {
  const m = String(fecha ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return { dia: "", mes: "", anio: "" };
  return { dia: m[3], mes: m[2], anio: m[1] };
}

/**
 * Los renglones de las OT elegidas, en el orden del plan.
 *
 * El orden es el del plan y no el de la selección: la hoja tiene que salir
 * igual sin importar en qué orden se fueron tildando las casillas, porque es
 * el mismo orden en que se va a trabajar.
 */
export function filasDelParte(
  items: readonly ItemDelPlan[],
  elegidos: ReadonlySet<string>
): FilaDelParte[] {
  return [...items]
    .filter((i) => elegidos.has(i.id))
    .sort((a, b) => a.orden - b.orden)
    .map((i) => ({
      id: i.id,
      nroOt: i.ot_number === null ? "" : String(i.ot_number),
      sector: texto(i.sector_raw),
      equipo: texto(i.equipo_raw),
      trabajo: texto(i.descripcion),
      repuestos: texto(i.repuesto),
    }));
}

/**
 * Las hojas, con la última completada con renglones vacíos.
 *
 * Sin ninguna fila elegida devuelve **una hoja vacía** y no ninguna: alguien
 * que entra a imprimir y todavía no tildó nada tiene que ver la grilla, no una
 * página en blanco que parece un error.
 */
export function paginasDelParte(
  filas: readonly FilaDelParte[],
  porHoja: number = FILAS_POR_HOJA
): FilaDelParte[][] {
  const tamano = Math.max(1, Math.floor(porHoja));
  if (filas.length === 0) return [Array.from({ length: tamano }, () => ({ ...VACIA }))];

  const hojas: FilaDelParte[][] = [];
  for (let i = 0; i < filas.length; i += tamano) {
    const hoja = filas.slice(i, i + tamano).map((f) => ({ ...f }));
    while (hoja.length < tamano) hoja.push({ ...VACIA });
    hojas.push(hoja);
  }
  return hojas;
}

/**
 * El pie de la hoja cuando son varias: "Hoja 1 de 3".
 *
 * Con una sola no se escribe nada. Un "Hoja 1 de 1" en un papel que se archiva
 * sólo agrega ruido, y lo que hace falta saber —que no falta ninguna— ya lo
 * dice que no haya número.
 */
export function pieDeHoja(numero: number, total: number): string | null {
  return total > 1 ? `Hoja ${numero} de ${total}` : null;
}
