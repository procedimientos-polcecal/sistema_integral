-- ============================================================
-- SdG — Asistente: el permiso
--
-- Quién puede usar el asistente de IA. Es una columna y no un valor más del
-- enum `app_module` por dos razones.
--
-- La conocida: un valor de enum nuevo tiene que viajar solo en su propia
-- migración (55P04), y ya costó dos veces. Pero además arrastraría al
-- asistente a `MODULOS_ORDEN` y al sidebar, donde no va: no es una sección.
--
-- La conceptual: los módulos responden *qué parte del sistema ves*; esto
-- responde *con qué herramienta la mirás*. Son ejes distintos, y mezclarlos
-- ensucia `modulosVisibles`, que hoy se entiende entera de una lectura.
--
-- Arranca en false para todos, a propósito: la barrera no es de seguridad
-- —de eso se ocupa RLS, que es quien ejecuta la consulta— sino de costo. Se
-- abre de a poco y se mide con `asistente_consultas`.
-- ============================================================

alter table usuarios
  add column if not exists puede_usar_asistente boolean not null default false;

comment on column usuarios.puede_usar_asistente is
  'Si puede usar el asistente de IA. No es un permiso de datos: lo que ve al '
  'preguntar sale de RLS igual que en las pantallas. Es un permiso de gasto.';
