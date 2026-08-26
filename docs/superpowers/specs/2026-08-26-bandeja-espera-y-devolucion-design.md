# Dos salidas más en la bandeja de aprobación

Diseño acordado el 26 de agosto de 2026.

## El problema

Quien aprueba una compra sólo puede empujarla hacia adelante: elegir un
presupuesto, o aprobar sin comparativa. Si lo que le llegó no está listo para
decidirse, no tiene qué hacer con eso.

Y hay dos motivos distintos por los que no está listo:

- **No es el momento.** El pedido no corre, o espera otra cosa. Frenarlo es una
  decisión de quien aprueba, para sí mismo.
- **Falta información.** Un presupuesto vencido, uno solo cuando hacen falta
  tres, un flete sin cotizar. Eso no se frena: se devuelve a Compras.

Hoy las dos terminan igual — el pedido se queda en la bandeja — y por eso once
de los veinticuatro requerimientos más viejos del sistema llevan entre 200 y 290
días parados ahí.

## La decisión

Dos salidas más al pie del bloque desplegado, junto a «Aprobar sin elegir
ninguno». Aparecen sólo en los pedidos que le tocan a quien mira: la bandeja ya
separa lo propio de lo ajeno y las acciones siguen esa misma división.

### Poner en espera

Reusa entero el estado `EN_ESPERA`: un clic con confirmación, sin motivo.
`etapa_previa` queda en `PARA_COMPRAR`, así que al sacarlo vuelve a la bandeja
con su aprobador asignado intacto.

### Devolver a comparativa

Abre un campo con el motivo, **obligatorio**, y avisa que el pedido sale de la
bandeja y vuelve a Compras.

**Por qué el motivo se exige acá y no en la espera.** Poner algo en espera es
una decisión que quien aprueba toma para sí mismo; devolver le manda trabajo a
otra persona. Una devolución sin motivo llega a Compras sin decir qué corregir,
y lo más probable es que el pedido vuelva igual que como se fue.

El motivo viaja como `nota` del cambio de estado. Ese mecanismo ya existe: el
PATCH lo guarda en `compras_historial` junto con el autor y la fecha, y la ficha
del requerimiento ya muestra las notas del historial. No hace falta ningún campo
nuevo ni ninguna migración.

**La asignación no se toca.** `compra_asignada_a` queda como está: cuando
Compras reenvíe el pedido, el diálogo va a sugerir a la misma persona, y si hay
que cambiarla se cambia ahí. Borrarla sería perder un dato que casi siempre
sigue siendo el correcto.

## La regla vive en la ruta, no en el formulario

Devolver a comparativa desde `PARA_COMPRAR` sin nota se rechaza con 400.

Una validación que existe sólo en el botón deja de existir apenas alguien llame
a la API de otra forma, y acá el punto entero de la devolución es que no sea
muda. Es la misma lección que dejó la regla de quién puede aprobar: estaba
escrita en dos rutas por separado y una se olvidó la mitad.

La condición es específica y no genérica: se exige la nota sólo cuando el
requerimiento **viene** de `PARA_COMPRAR` y **va** a `EN_COMPARATIVA`. Volver a
comparativa desde cualquier otro lado no es una devolución y no tiene a quién
explicarle nada.

## Pruebas

Sobre la única regla nueva:

- devolver de `PARA_COMPRAR` a `EN_COMPARATIVA` sin nota se rechaza
- con nota se acepta
- pasar a `EN_COMPARATIVA` desde otro estado no exige nota
- avanzar de `PARA_COMPRAR` a `APROBADO` tampoco

## Alcance

Sin migraciones y sin campos nuevos. Queda afuera lo que ya estaba anotado: el
aviso de requerimiento repetido, y la antigüedad visible en la bandeja — que es
lo que haría ver de una que esos once pedidos llevan nueve meses parados.
