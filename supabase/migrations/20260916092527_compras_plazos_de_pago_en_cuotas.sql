-- ============================================================
-- Un presupuesto puede pagarse en cuotas
-- ============================================================
-- La columna PLAZOS de las comparativas admite varios valores y la gente ya la
-- usa así: medido el 16/09/2026 sobre 25 de los 198 libros, hay 46 celdas con
-- más de un plazo —"30, 60" (18), "30, 60, 90" (12), "30, 45, 60" (8),
-- "0, 30, 60, 90" (7), "30, 60, 90, 120" (1)—, todas con valores del
-- desplegable, separadas por coma y espacio. Extrapolado a los 198 libros son
-- unas 350 celdas.
--
-- Significan CUOTAS: una parte a 30 días y otra a 60, no "elegí una".
--
-- ── Y ADEMÁS ARREGLA UN DATO INVENTADO ──────────────────────
--
-- `diasDePlazo` tenía una guarda contra varios plazos, pero escrita para barra
-- y pipe (`[/|]`). Con COMA no la esquivaba: `numeroArgentino` lee la coma como
-- separador decimal, así que "30, 60" entraba como 30,6 y se redondeaba a
--
--     "30, 60"  ->  31 días
--     "45, 60"  ->  46 días
--
-- Un plazo de 31 días es un número que nadie mira dos veces, y por eso estuvo
-- ahí sin que nadie lo notara. Con tres valores o más `numeroArgentino` se
-- rinde y devuelve null, que sí era correcto.
--
-- Los 11 registros afectados se comprobaron UNO POR UNO contra su celda de
-- origen antes de escribir esto: los nueve que dicen 31 vienen de "30, 60" (RI
-- 1651 a 1655 de REPUESTOS MÁQUINAS, 1685 y 1686 de PAÑO ZARANDA, 1874 y 1875
-- de PLACAS) y los dos que dicen 46 vienen de "45, 60" (RI 1602 y 1603 de
-- LADRILLOS REFRACTARIOS). No hay ningún 31 ni 46 legítimo: el desplegable no
-- los ofrece y el formulario de la app es un select cerrado sobre esa lista.
--
-- ── POR QUÉ SE RENOMBRA Y NO SE AGREGA UNA COLUMNA ──────────
--
-- Un `plazo_pago_dias` en singular sosteniendo un array es una mentira que se
-- paga cada vez que alguien lo lee. Y tener las dos columnas a la vez sería
-- guardar el mismo hecho dos veces, que es lo que la 019 ya dejó escrito que
-- termina mal: "dos copias del mismo hecho se pelean sin que nadie gane".
--
-- `proveedores.plazo_pago_dias` NO se toca: es el plazo por defecto de un
-- proveedor, otro dato y otra pregunta. Al prellenar el formulario se convierte
-- en un array de un elemento.

alter table compras_cotizaciones
  rename column plazo_pago_dias to plazos_pago_dias;

alter table compras_cotizaciones
  alter column plazos_pago_dias type integer[]
  using case
    -- Los once que el parseo inventó, devueltos a lo que dice su celda.
    when plazos_pago_dias = 31 then array[30, 60]
    when plazos_pago_dias = 46 then array[45, 60]
    when plazos_pago_dias is null then null
    else array[plazos_pago_dias]
  end;

comment on column compras_cotizaciones.plazos_pago_dias is
  'Cuotas en las que se paga el presupuesto, en días. {30,60} es "una parte a 30 días y otra a 60". Ordenado y sin repetidos. Null es "no se sabe"; un array vacío no se usa.';
