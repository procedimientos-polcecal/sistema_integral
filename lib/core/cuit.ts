/**
 * El CUIT, una sola vez para todo el sistema.
 *
 * Vivía en `lib/odoo/proveedores.ts`, que fue quien lo necesitó primero para
 * cruzar el padrón con Odoo. Se muda al núcleo ahora que lo necesita el segundo
 * módulo —Facturación, para leer el emisor del QR de una factura— siguiendo el
 * mismo camino que `fechaDeSheets`: la regla se comparte cuando aparece el
 * segundo consumidor.
 *
 * Que esté en un solo lugar importa más de lo que parece: los dos padrones
 * escriben el CUIT distinto —Odoo sin guiones, el SdG con guiones— y una segunda
 * copia de la normalización que se quedara atrás haría que un cruce devuelva
 * cero coincidencias sin ningún error.
 */

/**
 * Deja un CUIT en sus once dígitos, o `null` si no es un CUIT.
 *
 * Saca guiones, puntos, espacios y cualquier otra cosa: los dos padrones se
 * cargaron a mano en momentos distintos y no hay garantía de un solo formato.
 */
export function normalizarCuit(valor: string | null | false | undefined): string | null {
  if (!valor) return null;
  const digitos = valor.replace(/\D/g, "");
  return digitos.length === 11 ? digitos : null;
}

/**
 * ¿El dígito verificador del CUIT cierra?
 *
 * Sirve para **informar**, no para rechazar: un CUIT mal tipeado en el SdG se
 * puede corregir, pero descartarlo en silencio sería otra vez el error de que el
 * dato desaparezca sin que nadie se entere. Los 145 CUITs del SdG los cargó
 * alguien a mano, así que vale la pena chequearlos.
 */
export function cuitEsValido(cuit: string): boolean {
  const digitos = normalizarCuit(cuit);
  if (!digitos) return false;

  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const suma = pesos.reduce((acc, peso, i) => acc + peso * Number(digitos[i]), 0);
  const resto = suma % 11;

  // 11 - resto, con las dos convenciones del padrón de AFIP: 11 → 0 y 10 → 9.
  const esperado = resto === 0 ? 0 : resto === 1 ? 9 : 11 - resto;
  return Number(digitos[10]) === esperado;
}
