/**
 * Las formas que devuelve la API de Lenox, tal como vienen. No se adaptan ni
 * se renombran acá a propósito: cuando algo no cierre, lo que se compara
 * contra la doc tiene que ser esto y no una traducción nuestra.
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
  tipoMarcacion: string | null;
  comentario: string | null;
  reloj: string | null;
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
