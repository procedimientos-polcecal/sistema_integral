-- ============================================================
-- SdG — Cantera/Destape: la mano de obra y la máquina propia dejan de ser
-- una tarifa cargada a mano
--
-- A pedido explícito del usuario (21/09/2026):
--
-- 1. La mano de obra propia pasa a valer lo que cobra ESE operario
--    (empleados.valor_hora_normal, ya existe en el núcleo desde
--    038_rrhh_al_dia_con_apprrhh) en vez de una tarifa "mo_propia" única
--    cargada aparte, que además nunca se cargó (la categoría siguió vacía
--    en producción).
--
-- 2. La máquina propia pasa a calcularse: gasto asociado a ese equipo en
--    Odoo (facturas con distribución analítica a su cuenta) + un estimado
--    de combustible (litros cargados en Taller Vial × precio implícito
--    del combustible ese mes, resuelto de las facturas de las cisternas)
--    — todo dividido las horas de uso del mes (de los horómetros de Taller
--    Vial). Vive en lib/cantera/costoMaquinaDestape.ts. Ya no es una
--    tarifa $/h tipeada por equipo.
--
-- Las dos categorías se sacan del check de `categoria`: sólo queda
-- "fletero_externo" (por tipo de camión, la única que sigue siendo una
-- tarifa cargada a mano — verificado que depende del camión y no del
-- fletero). La tabla estaba VACÍA en producción (nadie había cargado
-- ninguna tarifa de ninguna categoría todavía), así que no hay datos que
-- migrar ni que perder.
--
-- `cantera_capacidades_fletero` se elimina entera: no había forma de
-- relevarla (el usuario no tiene esa información por fletero, sólo
-- cantidad de viajes) y en la práctica quedaba en 0 para casi todos los
-- fletero+camión. También estaba vacía. Se reemplaza por un promedio
-- calculado de lo que cada fletero transportó realmente en Acarreo
-- (`cantera_pesadas`, ya poblada con miles de pesadas reales), en
-- lib/cantera/destape.ts — mismo criterio de "despejar, no guardar" que el
-- resto del sistema.
-- ============================================================

alter table cantera_tarifas_destape
  drop constraint if exists cantera_tarifas_destape_categoria_check;
alter table cantera_tarifas_destape
  add constraint cantera_tarifas_destape_categoria_check
  check (categoria in ('fletero_externo'));

drop table if exists cantera_capacidades_fletero;
