-- ============================================================
-- SdG — Facturación: la bandeja del correo
--
-- El lector del buzón llegó al 98% —184 de las 187 facturas de septiembre se
-- leen solas— pero **no se usa**: hay una sola factura cargada en tres semanas.
-- El motivo no es el lector: las facturas llegan por mail y alguien tiene que
-- bajar el PDF y arrastrarlo. Mientras ese paso dependa de una persona, el 98%
-- no vale nada.
--
-- Esta tabla es la bandeja: lo que llegó por correo y **todavía no se cargó**.
-- Un Apps Script en la casilla que recibe las facturas se la va llenando
-- —mismo patrón que la planilla de Compras: un disparador por tiempo, un POST
-- con secreto, y el SdG hace el trabajo— y el buzón la muestra con un botón
-- para cargar cada una.
--
-- ## Lo que esta bandeja NO hace
--
-- No lee el QR. **Eso sigue corriendo en el navegador**, y es a propósito: el
-- archivo se lee en la máquina de quien está cargando, así los datos aparecen
-- en pantalla antes de subir nada y se corrigen ahí mismo. Es la decisión que
-- llevó al 98% y no se toca. Esta tabla sólo acerca el archivo.
--
-- ## Por qué guarda su propia copia del PDF
--
-- La copia de la bandeja es **la evidencia de lo que llegó**, con su remitente
-- y su fecha. La de la factura es lo que administración cargó. Pueden no ser el
-- mismo archivo —alguien puede cargar otro adjunto del mismo mail, o el bueno
-- de un reenvío— y entonces tener las dos es lo que permite notarlo. Son unos
-- cientos de KB por factura.
-- ============================================================

create table if not exists facturacion_correo (
  id              uuid primary key default gen_random_uuid(),

  /*
   * La llave contra el duplicado. El Apps Script corre cada quince minutos y
   * vuelve a ver los mismos mensajes, así que sin esto la bandeja se llenaría
   * de copias en una tarde.
   *
   * Es el par y no sólo el mensaje porque un mail puede traer varias facturas
   * adjuntas, y cada una es una fila. Va como UNIQUE entero y no como índice
   * parcial, justamente para poder usarlo de destino de un ON CONFLICT: un
   * índice parcial no sirve para eso, y ya costó una vez.
   */
  mensaje_id      text not null,
  adjunto         text not null,

  /* Lo que el mail dice de sí mismo. Sirve para reconocer de quién es la
     factura antes de abrirla, y para encontrarla en la casilla si hace falta. */
  remitente       text,
  asunto          text,
  recibido_en     timestamptz,

  /** La ruta en el bucket `facturas-proveedor`, bajo el prefijo `correo/`. */
  archivo_url     text not null,
  tamano_bytes    integer,
  tipo            text,

  /*
   * `pendiente` es lo que la bandeja muestra. `cargada` cuando ya se convirtió
   * en una factura, y ahí `factura_id` dice en cuál. `descartada` para lo que
   * llegó por mail y no es una factura —una firma, un logo, un remito—: se
   * saca de la lista sin borrar el rastro, porque el Apps Script lo volvería a
   * traer y porque conviene saber qué se descartó.
   */
  estado          text not null default 'pendiente'
                  check (estado in ('pendiente', 'cargada', 'descartada')),

  factura_id      uuid references facturas_proveedor(id) on delete set null,

  descartado_por  uuid references usuarios(id) on delete set null,
  descartado_en   timestamptz,
  motivo          text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint facturacion_correo_unico unique (mensaje_id, adjunto)
);

-- La consulta de la bandeja es siempre "qué hay pendiente, lo más nuevo
-- arriba". Va parcial porque las cargadas se acumulan y nunca se listan.
create index if not exists facturacion_correo_pendientes_idx
  on facturacion_correo (recibido_en desc)
  where estado = 'pendiente';

create trigger facturacion_correo_updated_at
  before update on facturacion_correo
  for each row execute function set_updated_at();

comment on table facturacion_correo is
  'Adjuntos que llegaron por mail y esperan que alguien los cargue en el buzón. Los trae un Apps Script desde la casilla de facturas; ver docs/FACTURACION.md.';
comment on column facturacion_correo.mensaje_id is
  'El id del mensaje en Gmail. Junto con el nombre del adjunto es lo que evita que el script traiga dos veces lo mismo.';
comment on column facturacion_correo.archivo_url is
  'Ruta en el bucket, no un link: el bucket es privado y los links se firman al pedirlos.';

-- ── Permisos: los mismos del módulo ──────────────────────────
--
-- Leer, cualquiera con acceso a Facturación. Escribir, quien puede editar. El
-- webhook del correo no pasa por acá: entra con la clave de servicio, que es
-- lo que le permite escribir sin un usuario sentado del otro lado.

alter table facturacion_correo enable row level security;

create policy facturacion_correo_select on facturacion_correo
  for select to authenticated using (tiene_acceso_facturacion());

create policy facturacion_correo_update on facturacion_correo
  for update to authenticated
  using (puede_editar_facturacion())
  with check (puede_editar_facturacion());
