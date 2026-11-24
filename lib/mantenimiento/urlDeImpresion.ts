/**
 * La URL de una hoja impresa del mes de órdenes, de las dos puntas: la pantalla
 * la arma y la hoja la vuelve a leer.
 *
 * Están juntas a propósito. Es un contrato entre un botón y una página, y
 * mientras viva en dos archivos distintos nada avisa el día que uno escriba
 * `quien` y el otro lea `responsable`: el síntoma sería una hoja que ignora un
 * filtro en silencio, que es justo lo que no se nota al mirarla.
 *
 * **`taller` es un pedido y no un permiso.** Decir `taller=1` en la URL es
 * pedir la franja de rotación del taller; quién puede verla lo decide
 * `esAdminMantenimiento` del lado del servidor, en la página. Cualquiera con el
 * módulo puede tipear esa URL, así que las dos condiciones van juntas: la hoja
 * dibuja la franja sólo si la pidieron **y** quien mira está autorizado.
 */
import { esFechaIso, sumarDias } from "@/lib/core/fechas";
import { SIN_FILTROS, type Filtros } from "./filtrosDelCalendario";

export type Periodo = "mes" | "semana" | "dia";

const PERIODOS: Periodo[] = ["mes", "semana", "dia"];

/**
 * El mismo tope que `/api/mantenimiento/calendario`, y la misma expresión para
 * comprobarlo: la hoja tiene que rechazar exactamente lo que la ruta
 * rechazaría, o manda a pedir datos que vuelven con un 400 que nadie mira.
 *
 * Un mes con las semanas parciales de los bordes llega a 42 días; 62 deja
 * margen para dos meses corridos. Admite `hasta` = `desde` + 62, o sea 63 días
 * contando los dos extremos.
 */
export const MAXIMO_DE_DIAS = 62;

export interface PedidoDeHoja {
  periodo: Periodo;
  desde: string;
  hasta: string;
  filtros: Filtros;
  taller: boolean;
}

/** La ruta relativa de la hoja. Un filtro vacío no se escribe: la URL es lo que una persona lee. */
export function armarUrlDeImpresion(p: PedidoDeHoja): string {
  const params = new URLSearchParams();
  params.set("periodo", p.periodo);
  params.set("desde", p.desde);
  params.set("hasta", p.hasta);
  if (p.filtros.especialidad) params.set("especialidad", p.filtros.especialidad);
  if (p.filtros.tipo) params.set("tipo", p.filtros.tipo);
  if (p.filtros.quien) params.set("quien", p.filtros.quien);
  if (p.taller) params.set("taller", "1");
  return `/mantenimiento/ordenes/imprimir?${params.toString()}`;
}

/**
 * Lo que la hoja entendió, o el error que se le muestra a quien la abrió.
 *
 * El error es un texto en castellano y no un código: esto lo lee una persona
 * que llegó a una página en blanco, y «400» no le dice qué corregir.
 */
export function leerParametros(params: URLSearchParams): PedidoDeHoja | { error: string } {
  const periodo = params.get("periodo") ?? "";
  if (!PERIODOS.includes(periodo as Periodo)) {
    return { error: "El período tiene que ser mes, semana o día" };
  }

  const desde = params.get("desde") ?? "";
  const hasta = params.get("hasta") ?? "";
  if (!esFechaIso(desde) || !esFechaIso(hasta)) {
    return { error: "desde y hasta tienen que ser AAAA-MM-DD" };
  }
  if (desde > hasta) {
    return { error: "desde no puede ser posterior a hasta" };
  }
  if (sumarDias(desde, MAXIMO_DE_DIAS) < hasta) {
    return { error: `El rango no puede pasar de ${MAXIMO_DE_DIAS} días` };
  }

  return {
    periodo: periodo as Periodo,
    desde,
    hasta,
    filtros: {
      ...SIN_FILTROS,
      especialidad: params.get("especialidad") ?? "",
      tipo: params.get("tipo") ?? "",
      quien: params.get("quien") ?? "",
    },
    taller: params.get("taller") === "1",
  };
}
