# Presupuestos en dólares

Diseño acordado el 27 de agosto de 2026.

## El problema

Hay proveedores que cotizan en dólares. Hoy eso se resuelve en la planilla: una
celda trae el valor del día con `=dolarBNA()`, cada planilla de comparativa lo
importa con `IMPORTRANGE` y las fórmulas convierten. En el sistema no hay forma
de cargar un presupuesto en dólares, así que quien carga tiene que convertir a
mano antes — y ese número queda viejo al día siguiente.

## Las decisiones

**Se muestra al dólar de hoy, y se congela al elegirlo.** Mientras el
presupuesto está en comparativa se convierte con la cotización del día, igual
que el `IMPORTRANGE`: es lo que permite comparar dos presupuestos cargados en
semanas distintas con la misma vara. Cuando se elige uno, queda grabada la
cotización de ese momento, porque lo que se pagó no puede cambiar después.

**El valor es el de venta del BNA.** Es lo que cuesta conseguir los dólares para
pagarle a un proveedor, así que es el que refleja el costo real. Hoy son 1535
contra 1485 de la compra: cincuenta pesos por dólar de diferencia.

**La moneda es del presupuesto entero**, no de cada campo. Si el proveedor
cotiza en dólares, el envío también.

## 1. De dónde sale la cotización

De `https://dolarapi.com/v1/dolares/oficial`, campo `venta`.

Cada valor que se obtiene se guarda en una tabla nueva, `cotizaciones_dolar`,
una fila por día. Eso resuelve tres cosas de una vez:

- no hay que pegarle a la API en cada carga de pantalla
- hay con qué congelar y con qué reconstruir un histórico
- **sigue funcionando cuando la API no responde**: un fin de semana largo, un
  feriado, o el servicio caído

Si no hay valor de hoy, se usa el último conocido **y la pantalla dice de qué
día es**. Una cotización vieja sin avisar es peor que ninguna: quien carga un
presupuesto de USD 5.000 no tiene cómo saber que el número que ve es de hace
cinco días.

La búsqueda es perezosa: cuando alguien pide la cotización y la de hoy no está,
se la busca y se la guarda. Sin cron nuevo.

## 2. Qué se guarda

Dos columnas en `compras_cotizaciones` (migración `040`):

| Columna | |
|---|---|
| `moneda` | `ARS` por defecto, así los 311 presupuestos que ya están no cambian |
| `cotizacion` | el dólar con el que se congeló. Nulo mientras sigue en comparativa |

**`precio_total` sigue siendo el total en la moneda original.** Es una columna
generada en Postgres y no puede depender de un valor que cambia todos los días:
guarda lo que el proveedor cotizó —USD 1.000 son 1.000— y la conversión a pesos
se hace al mostrar.

La cuenta vive en una función pura, `totalEnPesos()`, al lado de
`totalCotizacion()`, con sus tests. Un presupuesto en pesos devuelve su total
sin tocarlo; uno en dólares lo multiplica por `cotizacion` si está congelada, y
por la del día si no.

## 3. El formulario

Junto al precio unitario, un selector de moneda: `$` o `USD`. Con USD elegido,
mientras se escribe el precio se muestra el equivalente en pesos y a qué
cotización — para que nadie tenga que confiar a ciegas en una conversión que no
ve.

## 4. La comparativa

Muestra **todos los totales en pesos**, que es la única forma de comparar peras
con peras, y marca cuáles vienen de un presupuesto en dólares con el valor
original al lado. La diferencia porcentual contra el más barato se calcula sobre
los pesos.

Al elegir uno se graba la cotización del momento, en el mismo lugar donde ya se
marca `elegida`. De ahí en adelante ese número no se mueve, y es el que viaja al
pedido.

## Pruebas

Sobre `totalEnPesos()`, que es donde está la plata:

- un presupuesto en pesos devuelve su total sin tocarlo, aunque le pasen una
  cotización
- uno en dólares se multiplica por la del día mientras no está congelado
- uno congelado usa **su** cotización y no la de hoy, aunque hayan cambiado
- sin cotización disponible y en dólares, no inventa un número: devuelve nulo y
  la pantalla lo dice

Y sobre la lectura de la API: que un valor que no es un número no pise el último
bueno guardado.

## Alcance

Es para los presupuestos que se cargan **en el sistema**. Los que viven en una
planilla de Drive ya llegan convertidos por el `IMPORTRANGE`, así que el sistema
los recibe en pesos y no hay nada que hacer con ellos.

Queda afuera: cotizar en otras monedas (euro, real). La estructura lo permitiría
—`moneda` es texto— pero nadie lo pidió y cada moneda nueva necesita su fuente.
