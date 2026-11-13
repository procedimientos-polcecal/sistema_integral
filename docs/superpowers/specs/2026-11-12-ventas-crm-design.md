# Ventas — CRM

**Fecha:** 12/11/2026
**Estado:** construido, sin aplicar las migraciones (ver «Lo que falta»)

## Qué es y por qué ahora

El módulo **Ventas** es el decimocuarto del SdG, y el CRM es su primer frente.
Guarda a quién se le vende y a quién se le quiere vender, qué se habló con cada
uno y **qué hay que hacer después**.

Hoy eso no está en ninguna parte. El cliente existe en Odoo cuando ya hay algo
que facturarle, y en `despacho_ordenes_carga.cliente_raw` como texto cacheado
del remito. Lo que no existe en ningún sistema es el tramo de antes: el llamado,
el precio que se pasó, la visita, el prospecto al que había que volver a llamar
en marzo.

El pedido fue explícito: el CRM va **dentro del módulo de ventas**, que se
desarrolla en paralelo en otra sesión. Como `ventas` no existía todavía, este
trabajo lo crea.

## Intención

Que a la mañana alguien abra el SdG y vea **qué tiene pendiente**, y que seis
meses después se pueda contestar «¿qué pasó con este cliente?» sin preguntarle
a nadie.

## Objetivos

- Un padrón propio de clientes **y prospectos**, con su semáforo de contacto.
- El registro de lo que se habló, con quién y cuándo.
- El próximo paso con fecha, que es lo único que convierte un cuaderno en
  una agenda.
- Un embudo que diga qué hay en juego y dónde está el tapón.

## No objetivos

- **No reemplaza a Odoo.** El pedido, el remito y la factura siguen allá.
- **No importa el padrón de Odoo.** Ver abajo.
- **No manda notificaciones.** Ver «Lo que se dejó afuera».
- No tiene planilla de Google, como Ensayos y Seguridad e Higiene: el SdG es el
  único lugar.

## Anti-objetivos

Cosas que harían fracasar esto aunque funcionen:

- **Que haya que cargar mucho para cargar algo.** Un prospecto nace de un
  llamado donde lo único claro es el nombre de la empresa. Por eso lo único
  obligatorio de un cliente es la razón social, y lo único obligatorio de una
  actividad es el resumen.
- **Que mande avisos que se repiten.** El spec de avisos al instante
  (18/10/2026) ya midió lo que pasa: de 13 personas, las dos únicas que
  probaron las notificaciones en serio tenían los 13 avisos descartados. Un
  semáforo con cortes inventados que llega al teléfono todas las mañanas es
  exactamente eso.
- **Que enlace clientes con Odoo o con Despacho «por parecido».** Un enlace
  equivocado no se nota nunca: el dato aparece en el lugar que no es, y acá el
  precio sería facturarle a otro.

## Las decisiones

### El cliente es una tabla propia, no un espejo de Odoo

Odoo tiene los clientes facturables; el CRM tiene además los **prospectos**, que
por definición todavía no están en Odoo. Por eso `ventas_clientes` es propia y
el enlace vive aparte, en `ventas_clientes_odoo` —por empresa, calcada de
`proveedores_odoo`—, y admite no existir.

**El enlace lo hace una persona.** La tabla está creada y vacía: es lo que va a
permitir cruzar con Despacho y con Facturación por `odoo_partner_id` y no por
texto. Mientras no esté cargada, la ficha del cliente **no muestra cargas** —
decirlo es mejor que inventarlo.

### Lo que no es una columna

| Qué | Dónde sale | Por qué no se guarda |
|---|---|---|
| Probabilidad de una oportunidad | `etapas.ts` | Guardarla permite «Ganada» con probabilidad 30 |
| Si una oportunidad está abierta | `etapas.ts` | Lo mismo |
| Hace cuánto que no se toca a un cliente | `seguimiento.ts` sobre `ventas_actividades` | Una columna se desincroniza al corregir la fecha de una actividad vieja, y nada avisa |

**La excepción es `estado` del cliente** (prospecto / activo / inactivo), y es
deliberada: no se deduce de los datos, es un juicio de quien vende. Un cliente
que no compra hace seis meses puede estar activo porque hay una orden en camino.

### La probabilidad es una ponderación, no un pronóstico

10/25/50/75 son los números de manual. **No hay histórico todavía**, así que no
salen de ninguna medición: están para ordenar las oportunidades entre sí. Por
eso el embudo muestra **siempre** el monto sin ponderar al lado, que es el único
número que no depende de ese supuesto.

### El monto no se convierte nunca

Se suma por moneda y se muestran las dos. Convertir pide una cotización del día:
con la de hoy, el embudo del mes pasado cambia cada vez que se lo mira; guardada
junto al monto, envejece sin avisar. Compras ya resolvió esto igual
(`040_cotizaciones_en_dolares`).

### Los dos cortes del semáforo son un supuesto, y está dicho

30 y 60 días. No salen de ningún dato —no hay dato todavía— y viven con nombre
en `seguimiento.ts` (`DIAS_AL_DIA`, `DIAS_A_DESTIEMPO`) para que el día que
alguien mire los números de verdad se cambien en una línea.

**«Nunca» no es «sin contacto».** Un cliente cargado ayer sin actividades no
está abandonado: está recién entrado, y lo que hay que hacer con él es distinto.
Unificarlos haría que el rojo deje de querer decir algo.

### Todo el que tiene Ventas ve todos los clientes

No hay «mi cartera». Son catorce personas y dos plantas: una cartera por vendedor
esconde datos de los compañeros y hace que el que atiende el teléfono no sepa con
quién está hablando. `vendedor_id` dice **quién atiende**, no quién puede ver.

### Niveles

| Nivel | Puede |
|---|---|
| `lectura` | ver todo |
| `edicion` | cargar y corregir clientes, contactos, oportunidades y actividades; mover de etapa |
| `admin` | además borrar, reasignar el vendedor y enlazar con Odoo |

**No hay trigger de columnas**, al revés que Seguridad e Higiene: allá la
diferencia entre niveles es por columna y RLS no sabe de columnas. Acá es por
fila entera (borrar) y por un solo campo (`vendedor_id`), que lo cuida la ruta.

### Borrar un cliente se audita

Se lleva en cascada sus contactos, sus oportunidades y **todo su registro de
actividades**. Es el segundo `borrar` que escribe una persona —el primero fue
sacar un renglón del cuaderno de un contratista, el 03/11/2026— y hay una
diferencia que importa: **allá el archivo de origen seguía en el bucket**, así
que «qué decía» se contestaba sin la tabla. Acá no hay archivo de origen.

Por eso el registro lleva en el contexto la razón social, el CUIT y cuántas filas
colgaban, y **se escribe antes del borrado**: si no entra, no se borra.

Las otras dos formas de borrar —una oportunidad, una actividad— son de `admin` y
**no** se auditan: lo que desaparece ahí es una previsión o una nota, no un
agujero en un número. La cascada de la actividad no existe (`on delete set null`
desde la oportunidad), así que el registro de la conversación queda.

### De una oportunidad cerrada no se vuelve

Es la única transición prohibida. `cerrada_el` ya alimentó el informe del mes:
reabrirla dejaría una fecha de cierre sobre algo que no está cerrado. Si el
cliente volvió, se abre una oportunidad nueva — que además es lo que pasó.

**La pantalla no ofrece la vuelta**: el desplegable se dibuja con la misma
función que la ruta usa para rechazar (`sePuedePasarDe`). Ofrecer algo que el
servidor va a rechazar es cómo se consigue que la gente deje de confiar en los
botones.

### Perder pide el motivo

Es la única cosa obligatoria del módulo que no hace falta para guardar la fila.
El porqué de una venta perdida es el único dato del CRM que no se reconstruye
mirando los números, y es justo el que nadie carga si no se lo piden. La tabla
**no** lo exige —una fila vieja corregida desde el editor SQL no tiene por qué
saberlo—, así que la regla vive en la ruta, que es por donde entra lo que carga
la gente.

### La fecha de una actividad se tipea

La visita se registra a la mañana siguiente, igual que los cuatro horarios de una
orden de carga. Poner la fecha del servidor obligaría a mentir o a no cargar.
`creada_en` guarda aparte cuándo se tipeó.

### El CUIT nunca se rechaza

Se normaliza a once dígitos con `normalizarCuit` del núcleo y, si el dígito
verificador no cierra, **se guarda igual y se avisa**. Descartarlo en silencio es
cómo el dato desaparece sin que nadie se entere — el mismo criterio que
`cuitEsValido`, que existe para informar y no para frenar.

## Lo que se dejó afuera, a propósito

| Qué | Por qué |
|---|---|
| **Avisos y push** | Los cortes del semáforo son un supuesto. Un aviso mal calibrado ya no es una campanita de más: es una notificación en el teléfono de alguien, y el spec del 18/10/2026 midió adónde lleva. Primero que los cortes se midan contra datos reales |
| **Enlace automático con Odoo** | «Enlazar al que se le parece» es lo que el repo prohíbe. La tabla está, la carga la hace una persona |
| **Última carga del cliente, desde Despacho** | `cliente_raw` es texto libre del remito. Cuando `ventas_clientes_odoo` esté cargado, el cruce es por id y es exacto |
| **Hilo de mensajería interna** | Las actividades **son** la conversación. Un segundo lugar donde escribir sobre el mismo cliente es un lugar donde no se va a buscar |
| **Planilla de Google** | Como Ensayos y Seguridad e Higiene: el SdG es el único lugar. No existen `sheets_fila` ni `sheets_pendiente` |
| **Carga sin señal** | El CRM es trabajo de escritorio y de teléfono con señal. Si algún día se carga una visita desde la ruta, `lib/ventas/auth.ts` ya distingue 403 de 503, que es lo que esa cola necesita |

## Lo que falta

- **Las dos migraciones no están aplicadas.** Las corre una persona en el editor
  SQL de Supabase, en orden: primero el enum, confirmado, y después el esquema.
  Un valor de enum nuevo no se puede usar en la misma transacción (55P04).
- **Nadie tiene el módulo concedido todavía.** Se concede desde
  `/administracion/usuarios`.
- **Ninguna pantalla se abrió en un navegador**, porque todo está detrás del
  login. Lo que se verificó es lo de abajo.

## Qué se verificó

- `npm test` — la lógica pura: etapas, embudo, seguimiento, cuerpos, formato.
- `npx tsc --noEmit`, `npm run build`.
- `node scripts/revisar-responsive.mjs` y `node scripts/revisar-exportaciones.mjs`.

## Archivos

- Migraciones: `20261112105021_ventas_enum_del_modulo.sql`,
  `20261112105023_ventas_crm_schema.sql`
- Permisos: `lib/ventas/auth.ts`
- Lógica pura: `lib/ventas/crm/{etapas,seguimiento,embudo,cuerpos,formato}.ts`
- Rutas: `app/api/ventas/{clientes,contactos,oportunidades,actividades}`
- Pantallas: `app/(app)/ventas`
- Documento del módulo: `docs/VENTAS-CRM.md`
