/**
 * Las formas que devuelve la API de Lenox, tal como vienen. No se adaptan ni
 * se renombran acá a propósito: cuando algo no cierre, lo que se compara
 * contra la doc tiene que ser esto y no una traducción nuestra.
 *
 * Los campos están verificados contra la API real el 07/10/2026, no sólo
 * contra la doc — que resultó estar incompleta en los dos tipos.
 *
 * Doc: https://postman.lenoxhr.com/
 */

export interface MarcacionLenox {
  nombre: string;
  apellido: string;
  legajo: string;
  marcacion: string; // "2026-10-23 07:00:00"
  marcacionFecha: string; // "2026-10-23"
  marcacionHora: string; // "07:00:00"

  /**
   * Medido: `"Por Reloj"` o `"GeoCerca"` — no `"Manual"`/`"GEOLOCALIZADA"`
   * como dicen los ejemplos de la doc. O sea que hay gente fichando por
   * geocerca desde el teléfono y no sólo en el reloj de portería.
   *
   * La reconciliación no lo mira: una marca es una marca, venga de donde
   * venga. Está acá para que se pueda responder por qué un fichaje no tiene
   * reloj asociado.
   */
  tipoMarcacion: string | null;

  /** `"porteria"` para el reloj físico, `null` para una marca por geocerca. */
  reloj: string | null;

  comentario: string | null;

  // Los tres de abajo no están en los ejemplos de la doc y sí en los datos
  // reales. No se usan hoy; se declaran para que el tipo no mienta sobre lo
  // que llega.
  longitud: string | null;
  latitud: string | null;
  codigoNovedad: string | null;
  justificada: string | null; // "No" / "Si"
}

export interface EmpleadoLenox {
  nombre: string;
  apellido: string;
  legajo: string;
  sector: string | null;
  sucursal: string | null;
  fechaIngreso: string | null;
  fechaBaja: string | null; // no null ⇒ dado de baja en Lenox
}
