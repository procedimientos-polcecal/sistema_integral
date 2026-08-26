/**
 * Cuánto pasó desde una fecha, en castellano.
 *
 * Existe para el cartel de "Actualizado hace…" de las pantallas que espejan una
 * planilla. La pregunta que contesta no es qué hora era, sino si lo que estoy
 * mirando es de recién o de ayer, y para eso "hace 3 horas" se lee de un
 * vistazo y "26/08/2026 09:00" hay que calcularlo.
 *
 * La fecha exacta no se pierde: va en el `title` del cartel.
 */
export function haceCuanto(valor: string | Date | null | undefined, ahora = new Date()): string {
  if (!valor) return "nunca";

  const d = valor instanceof Date ? valor : new Date(valor);
  if (isNaN(d.getTime())) return "nunca";

  const segundos = Math.round((ahora.getTime() - d.getTime()) / 1000);

  // Una fecha futura no es un error a mostrar: pasa cuando el reloj del
  // servidor y el de la base no coinciden por unos segundos. Decir "hace -3
  // minutos" sería peor que redondear a recién.
  if (segundos < 60) return "recién";

  const minutos = Math.floor(segundos / 60);
  if (minutos < 60) return `hace ${minutos} ${minutos === 1 ? "minuto" : "minutos"}`;

  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `hace ${horas} ${horas === 1 ? "hora" : "horas"}`;

  const dias = Math.floor(horas / 24);
  if (dias < 30) return `hace ${dias} ${dias === 1 ? "día" : "días"}`;

  const meses = Math.floor(dias / 30);
  if (meses < 12) return `hace ${meses} ${meses === 1 ? "mes" : "meses"}`;

  const anios = Math.floor(meses / 12);
  return `hace ${anios} ${anios === 1 ? "año" : "años"}`;
}
