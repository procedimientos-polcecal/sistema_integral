-- ============================================================
-- SdG — Envases: el stock de seguridad es de un grupo, no de un artículo
--
-- POR QUÉ
--
-- En el listado de la planilla, la columna `STOCK DE SEGURIDAD` está en **celdas
-- combinadas** que abarcan varias filas, y el faltante compara el mínimo contra
-- la **suma del stock de todas esas filas**. Son los bolsones: no importa de qué
-- proveedor sea cada uno, importa cuántos de 1,20 hay en total.
--
-- El espejo leía esa columna fila por fila. Una celda combinada sólo trae su
-- valor en la primera fila del bloque, así que el mínimo caía en el primer
-- artículo y los demás quedaban en cero — y el `faltante` de cada uno se
-- calculaba contra su propio stock. Medido el 13/10/2026 en la planilla real:
--
--   G10:G18 → 00009…00026, suma 905,  seguridad 2000 → falta 1095
--   G19:G25 → 00013…00022, suma 1192, seguridad 1500 → falta 308
--   G26:G27 → 00024, 00025, suma 600,  seguridad 500  → falta 0
--
-- El SdG mostraba, por ejemplo, "al 00013 le faltan 1500" —su mínimo contra su
-- stock de cero— cuando lo que falta de bolsones 1,20 son 308.
--
-- Las bolsas (filas 2 a 9) NO están combinadas: cada una tiene su mínimo. Así
-- que la regla no es "todo va por grupo": **el grupo lo define la combinación**,
-- y un artículo suelto es un grupo de uno. Con eso la cuenta es una sola y no
-- hay caso especial.
--
-- QUÉ ES `grupo_seguridad` Y QUÉ NO ES
--
-- Es el **código del primer artículo del bloque combinado**, repetido en todos
-- sus miembros. Se recalcula en cada sincronización, así que si alguien cambia
-- las combinaciones, cambia solo.
--
-- **No es lo mismo que `grupo`**, aunque hoy casi coincidan. `grupo` sale de la
-- columna K del kardex —una fórmula sobre el código— y sirve para el informe por
-- período; `grupo_seguridad` sale de las combinaciones del listado. Se separan
-- porque ya difieren: el `00011` no tiene un solo movimiento, así que no tiene K
-- ni `grupo`, y sin embargo está adentro del bloque de 2,10. Usar `grupo` para
-- esto lo habría dejado afuera de su propia suma.
-- ============================================================

alter table calidad_envases_articulos
  add column if not exists grupo_seguridad text;

create index if not exists calidad_envases_articulos_grupo_seg_idx
  on calidad_envases_articulos (grupo_seguridad);

comment on column calidad_envases_articulos.grupo_seguridad is
  'Código del primer artículo del bloque combinado del listado, repetido en todos sus miembros: contra la SUMA del grupo se compara stock_seguridad. Un artículo sin combinar es un grupo de uno (grupo_seguridad = su propio código). No confundir con `grupo`, que sale de la columna K del kardex y es para el informe por período.';

comment on column calidad_envases_articulos.stock_seguridad is
  'El mínimo del GRUPO, repetido en cada miembro — es el valor de la celda combinada. No se compara contra el stock de este artículo sino contra la suma de su grupo_seguridad.';

-- La columna generada `faltante` queda, pero **ya no se usa y no se puede
-- arreglar en su lugar**: una columna generada sólo ve su propia fila, y el
-- faltante es un agregado del grupo. Se calcula en
-- `lib/calidad/envases/seguridad.ts`, que está probado.
--
-- No se borra en esta migración a propósito: el código que hoy está en
-- producción la selecciona, así que borrarla antes del deploy rompe la pantalla
-- de stock. Se borra en una migración posterior, cuando esto ya esté arriba.
comment on column calidad_envases_articulos.faltante is
  'EN DESUSO desde el 13/10/2026: compara contra el stock de la propia fila y el mínimo es del grupo. El bueno lo calcula faltantesPorGrupo() en lib/calidad/envases/seguridad.ts. Se borra en una migración posterior.';
