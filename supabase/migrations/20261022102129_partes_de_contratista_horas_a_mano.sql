-- ============================================================
-- SdG — Mantenimiento: las horas del parte se escriben a mano
--
-- Hasta hoy las horas de cada renglón salían de leer la expresión del papel
-- —"2 P. x 8H + 1 P. x 2H"— y repartir el primer término en partes iguales
-- entre los renglones que no eran riego. Esa regla suponía que todos los
-- frentes del día llevaron lo mismo, y quien tiene la hoja delante sabe que a
-- veces no: una limpieza de horno se lleva la mañana entera mientras el bajo
-- cintas lleva una hora.
--
-- Desde el 22/10/2026 **las horas las escribe quien carga el parte**, renglón
-- por renglón. La pantalla propone el reparto parejo y se corrige encima.
--
-- LO QUE NO CAMBIA, Y ES PARA LO QUE EXISTE TODO ESTO: la suma de los
-- renglones tiene que dar `horas_declaradas`, el total escrito a mano en la
-- casilla "HORAS". Ése sigue siendo el control de la factura.
--
-- POR QUÉ LA COLUMNA NO SE BORRA. `horas_expresion` deja de escribirse, pero
-- el parte 1301 —el único cargado con la regla vieja— la tiene, y es lo que
-- decía su papel. Borrar la columna tiraría esa prueba para ahorrar nada: una
-- columna que nadie escribe no cuesta. Pasa a aceptar null y se queda.
--
-- Ver `docs/superpowers/specs/2026-10-20-mantenimiento-partes-de-contratista-design.md`,
-- sección «Las horas las escribe quien carga el parte (22/10/2026)».
-- ============================================================

alter table public.mant_partes_contratista
  alter column horas_expresion drop not null;

comment on column public.mant_partes_contratista.horas_expresion is
  'La suma tal como estaba escrita en el papel. HISTÓRICA: desde el 22/10/2026 no se escribe más — las horas de cada renglón las carga a mano quien tiene la hoja delante, y el control sigue siendo horas_declaradas.';
