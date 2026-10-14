import { addUtcDays, diaIso, fechaArgentinaDe } from "../dates";

/**
 * Cuántos días muestra la lista de marcaciones al entrar.
 *
 * Siete, que es una semana completa: alcanza para ver el fin de semana desde
 * el lunes y para comparar un día con el mismo día de la semana anterior. No
 * se ata al tamaño de la ventana del cron de Lenox aunque hoy coincidan: si
 * aquél cambia, lo que se ve en pantalla no tiene por qué cambiar con él.
 */
export const DIAS_DE_LA_LISTA = 7;

/**
 * El rango que trae la lista de marcaciones si nadie eligió otro.
 *
 * Existe porque antes no había ninguno: la pantalla pedía las últimas 500
 * fichadas y dibujaba las primeras 50, sin filtro y sin paginado. Con 60 o 70
 * personas fichando por día, esas 50 filas no llegan a cubrir dos jornadas —
 * el 14/10/2026 tapaban el 14 y parte del 13— así que las marcaciones del
 * 10, 11 y 12 **estaban cargadas y no había forma de verlas desde ahí**. No
 * era un dato que faltara; era una pantalla que no sabía mirar atrás.
 *
 * El día se toma en Argentina y no en UTC: a las 21:30 de acá ya es mañana en
 * UTC, y un rango que termina "mañana" y empieza siete días después de lo que
 * corresponde se lleva puesto el día más viejo justo cuando alguien revisa la
 * semana de noche.
 */
export function rangoDeLista(ahora: Date): { desde: string; hasta: string } {
  const hoy = fechaArgentinaDe(ahora);
  return { desde: diaIso(addUtcDays(hoy, -(DIAS_DE_LA_LISTA - 1))), hasta: diaIso(hoy) };
}

/**
 * El rango agrandado para que una fecha entre.
 *
 * Cargar una fichada a mano para un día fuera del rango la guardaba bien y la
 * dejaba invisible, que se lee igual que "no se guardó". En vez de avisar, el
 * rango se corre para incluirla.
 */
export function rangoQueIncluye(
  rango: { desde: string; hasta: string },
  fecha: string
): { desde: string; hasta: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return rango;
  return {
    desde: fecha < rango.desde ? fecha : rango.desde,
    hasta: fecha > rango.hasta ? fecha : rango.hasta,
  };
}
