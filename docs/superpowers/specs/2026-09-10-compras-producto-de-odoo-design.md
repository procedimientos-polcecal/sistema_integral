# Compras — La orden de compra elige el producto de Odoo

Hoy toda orden generada desde el SdG lleva **`ART. VARIOS`** como producto. No
está mal —la descripción del requerimiento va en el `name` de la línea, que es
lo que se ve e imprime— pero el producto es lo que aporta la **cuenta contable**,
así que todo el gasto del módulo cae en la misma bolsa.

Esto hace que la orden proponga el producto del catálogo que corresponde según
lo que dice el RI, y que Compras lo confirme antes de mandarla.

## Lo que se midió antes de diseñar

Contra Odoo (staging) y contra 300 requerimientos reales, el 10/09/2026.

**El catálogo de Odoo no son SKUs, son rubros.** 432 productos, **378
comprables**, todos compartidos entre las dos empresas, todos en la categoría
`All`, y sólo **51 con `default_code`** —de los cuales uno solo parece un código
de verdad—. Los nombres son `GUANTES`, `CABLES`, `ABRAZADERAS`, `ACEITES`,
`BUJES`. Emparejar por código no sirve; emparejar por nombre sí.

**Las 378 unidades de compra son `Unidades`.** O sea que hoy la unidad no cambia
con el producto. Igual se toma la del producto elegido, para que siga bien el día
que alguien cargue uno en kilos.

**Existe un producto `FLETE`** (id 6954 en staging) además de `ENVIOS` (6944).

### Qué tan emparejables son las descripciones

El criterio que funciona es **la cabeza**: la primera palabra significativa de la
descripción tiene que ser también la primera del nombre del producto.

| | sobre 300 RI | |
|---|---|---|
| El nombre del producto entra **entero** en la descripción | **160 (53%)** | se sugiere |
| Comparten la cabeza pero el resto no | 29 (10%) | **no se sugiere** |
| Ni la cabeza | 111 (37%) | `ART. VARIOS`, como hoy |

De los 160 exactos, 29 tienen **empate** entre dos productos.

Los exactos aciertan: `Guantes de grasa → GUANTES`, `Ficha Macho 32A → FICHAS`,
`Cable tipo TPR 3x4 → CABLES`, `Botines de seguridad talle 42 → BOTINES`,
`SELLADOR SILICONADO ACETICO TUBO → SELLADOR SILICONADO ACÉTICO`.

**Los parciales están mayormente mal**, y por eso se rechazan:

```
Llave combinada fija 13mm     → LLAVE DE IMPACTO      ✗
Rollo de Papel Higiénico      → ROLLO PAPEL FILM      ✗
Tubo estructural 1"           → TUBO DE ENCASTRE      ✗
Tarjeta de bloqueo de equipos → TARJETAS PLC          ✗
Bolsas de cal Moreno          → BOLSAS CAL GÜEMES     ✗ (otra marca)
MASCARILLA N-95 CON VÁLVULA   → MASCARILLA UCU N95    ✓
```

Un primer prototipo puntuaba por "qué proporción del nombre del producto aparece
en la descripción", sin exigir la cabeza. Daba la misma cobertura y **fallaba con
confianza**: `Guantes de grasa → GRASAS`, `MASCARILLA CON VÁLVULA → VÁLVULAS`. La
cabeza es lo que lo arregla.

## Por qué esto se confirma y no se manda solo

**Un producto equivocado no se nota.** La descripción sigue yendo en el `name` de
la línea, así que la orden se lee bien; lo único que cambia es la cuenta
contable, que nadie mira al momento de comprar. Es la misma forma de las
trampas que este módulo ya pagó: el dato aparece en el lugar que no es y se
descubre meses después.

Con 29 empates sobre 160 aciertos, mandar automático significa mandar ~18% de las
sugerencias sin que nadie las haya visto. Por eso **la pantalla propone y Compras
confirma**, que además es lo que permite aprender.

## El diseño

### 1. El emparejador — `lib/compras/productoOdoo.ts`

Puro, sin I/O, con tests. Tres reglas **en orden**:

1. **Aprendido.** La descripción normalizada está en la tabla de lo aprendido →
   ese producto. Motivo: `aprendido`.
2. **Cabeza + nombre entero.** La primera palabra significativa de la descripción
   es también la primera del producto, **y todos** los tokens del producto
   aparecen en la descripción. Motivo: `sugerido`. Si empatan varios, gana el
   nombre más corto —el más genérico— y los demás viajan como `alternativas`.
3. **Nada.** `ART. VARIOS`. Motivo: `sin_sugerencia`.

**No acepta parciales**, y ésa es la decisión que sostiene el resto.

Normalización: mayúsculas, sin acentos, sin puntuación, plural tosco (saca la `S`
final de palabras de 4+ letras) y una lista de palabras vacías (`DE`, `PARA`,
`CON`, `MM`, `KG`, …). La misma para las dos puntas.

### 2. Lo aprendido — una tabla chica

`compras_producto_odoo`:

| columna | |
|---|---|
| `descripcion_normalizada` | única, es la clave |
| `odoo_product_id` | |
| `odoo_product_nombre` | copia, para mostrarlo sin ir a Odoo |
| `veces` | cuántas órdenes lo usaron |
| `created_by`, `created_at`, `updated_at` | |

Se escribe **al generar la orden**, con el producto que quedó confirmado: aprende
de las confirmaciones y no sólo de las correcciones. La última pisa a la
anterior, porque si alguien corrigió, ésa es la buena.

**Aprende sólo la descripción exacta y nunca generaliza por la cabeza.** En el
catálogo hay cabezas ambiguas —`LLAVE` es `LLAVE DE IMPACTO` o `LLAVES ALLEN`,
`TUBO` es `TUBO DE ENCASTRE` o un caño estructural—, así que atar la cabeza a lo
último que se eligió haría sugerir mal seguido, y una sugerencia mala que se
confirma sin mirar es peor que no sugerir.

Necesita **migración**, que corre el usuario a mano.

### 3. La pantalla

El `GET` de `/api/compras/requerimientos/[id]/odoo` suma a lo que ya devuelve:
el producto sugerido, el motivo, las alternativas y el catálogo comprable (378
nombres) para el selector.

La ficha del RI muestra `Producto en Odoo: [GUANTES ▾] · sugerido por la
descripción` y deja cambiarlo por cualquiera del catálogo.

El `POST` **recibe el producto elegido**. Sin él, `ART. VARIOS`: nada regresiona,
y una orden generada por una pantalla vieja sigue funcionando.

### 4. Validación

El id que llega en el `POST` se comprueba contra Odoo —existe, activo,
`purchase_ok`— antes de usarlo. Un id que no cumple haría fallar la orden entera
con un error de Odoo que no dice nada útil; acá se rechaza con un motivo.

### 5. El flete

La línea de flete pasa a usar el producto `FLETE` en vez de `ART. VARIOS`. No
hay nada que decidir: es determinístico y ya existe.

### 6. Lo que no cambia

La descripción sigue yendo en el `name` de la línea. El producto aporta cuenta y
unidad, nada más. El reparto entre empresas, los impuestos y el flete sin IVA
quedan como están.

## Riesgo asumido

**El 37% que no engancha sigue en `ART. VARIOS`.** No es una regresión: es lo que
hoy pasa con el 100%, y la tabla de lo aprendido lo baja con el uso.

**El catálogo se lee de Odoo en cada previsualización.** Son 378 nombres, una
llamada. Si Odoo no responde, la pantalla ofrece `ART. VARIOS` y lo dice, en vez
de trabar la generación de la orden.

## Etapa 2 — confirmar la orden y bajar el PDF

Pedido después de acordar lo anterior. Se documenta acá lo que se midió, porque
**una de las dos mitades tiene un obstáculo real**.

**Confirmar: alcanzable.** `button_confirm` es un método público de
`purchase.order` y en staging ya hay órdenes en estado `purchase`. Lo que hay que
decidir es si la orden se confirma **automáticamente al generarla** —lo pedido—
o con un botón aparte: confirmar deja de ser un borrador y ya no se puede
editar ni borrar desde Odoo, así que saltea la revisión que hoy alguien hace
allá.

**El PDF: no alcanzable con las credenciales de hoy.** Medido contra staging el
10/09/2026:

| camino | resultado |
|---|---|
| `ir.actions.report._render_qweb_pdf` por RPC | **bloqueado**: "Private methods cannot be called remotely" |
| `ir.actions.report.render_qweb_pdf` (el público viejo) | **no existe** en esta versión |
| `/web/session/authenticate` con la API key → `/report/pdf/...` | **`AccessError`**, no devuelve cookie |

El cliente del SdG habla JSON-RPC con API key y no tiene sesión web, que es lo
único que abre el endpoint de reportes. Las salidas posibles, ninguna gratis:

1. **Guardar una contraseña de usuario de Odoo** (no una API key) para abrir
   sesión web y bajar `/report/pdf/purchase.report_purchaseorder/<id>`. Es el PDF
   oficial, igual al que imprime Odoo. Cuesta guardar una contraseña.
2. **Leer el PDF como adjunto.** Si se consigue que Odoo materialice el reporte
   como `ir.attachment` —los adjuntos sí se leen por RPC—, se baja de ahí. Hay
   que confirmar si en esta instancia el reporte guarda adjunto.
3. **Generar el PDF en el SdG** con los datos de la orden, que ya los tenemos.
   No depende de Odoo, y no es el documento oficial: si el proveedor espera el
   formato de Odoo, no sirve.

Queda pendiente de decisión antes de implementarla.
