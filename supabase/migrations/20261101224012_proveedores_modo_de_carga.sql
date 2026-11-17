-- ============================================================
-- SdG — Proveedores: cómo entrega el trabajo cada contratista
--
-- Candia entrega partes diarios con número y total; PIPARO entrega un cuaderno
-- manuscrito. Son dos papeles distintos y dos pantallas distintas sobre la
-- misma ruta de Mantenimiento, y hace falta saber de cuál es cada contratista
-- para abrirle la que corresponde.
--
-- POR QUÉ ES UNA COLUMNA DE `proveedores` Y NO UNA LISTA EN EL CÓDIGO. El
-- modo es un dato del contratista, no del programa: el día que aparezca un
-- tercero que entregue de una u otra manera, se cambia una fila y no se
-- despliega nada. `proveedores` es un catálogo del núcleo que comparten los
-- módulos; esto agrega una columna con default y **no cambia lo que ya se
-- lee**, así que a los demás módulos no les pasa nada.
--
-- Default `parte_diario`: es lo que ya hacen todos los contratistas hoy, así
-- que ninguno cambia de pantalla hasta que alguien lo ponga a mano.
--
-- Va sola en su archivo: tocar una tabla del núcleo no tiene por qué caer
-- junto con las tablas nuevas del cuaderno.
-- ============================================================

alter table public.proveedores
  add column if not exists modo_de_carga text not null default 'parte_diario';

comment on column public.proveedores.modo_de_carga is
  'Cómo entrega el trabajo un contratista. parte_diario: hojas sueltas con número y total (Candia), abre la pantalla de partes. cuaderno: cuaderno manuscrito que entra por fotos (PIPARO), abre la del cuaderno. Texto y no enum a propósito: un valor de enum nuevo viaja solo en su propio archivo.';
