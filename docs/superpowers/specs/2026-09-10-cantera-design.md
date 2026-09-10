# Cantera — perforación, voladura y bochones dejan de vivir en una planilla de fórmulas

Diseño acordado el 10 de septiembre de 2026. Es el octavo módulo del SdG y el
tercero que se diseña **de cero** —después de Producción y Despacho—: no hay app
de origen que portar. Lo que hay son cuatro planillas de Google encadenadas por
fórmulas, con varias pestañas que arma un Apps Script.

Este spec cubre **sólo la fase 1**: perforación, voladura, bochones y sus
consumos, más el informe mensual que hoy genera el script. Balanza / transporte,
destape de frente y cubicación de yacimientos quedan para fases siguientes, con
su propio relevamiento (ver [Fases siguientes](#fases-siguientes)).

## De dónde sale esto

Cuatro planillas, relevadas el 10/09/2026 (dump completo en la sesión):

| Planilla | Id | Qué tiene |
|---|---|---|
| **Control de perforaciones, voladuras y bochones** | `1npg2BczhDN4MF49-fNG6kceSn4BINpUkF1ftFebVn9k` | Lo de esta fase |
| Balanza / transporte / fleteros | `1E8mA7RPRPU3sXR0G0m9Oiwk7yBt0mo0rMTRFlX9ZHuw` | Fase 2 |
| Costos de destape de frente | `1SvF0HK3Zu6Mi5Z_tTokJAypWvHHHp9oEomucqJudE3Y` | Fase 3 |
| Cubicación de yacimientos | `17yui8Gpp_BRuwRXyavepFScID_jvqguPSL6vsAjXxKc` | Fase 4 |

### La planilla de esta fase, pestaña por pestaña

**`PARAMETROS`** — la malla de **diseño** de cada cantera:

| Cantera | Burden (m) | Espaciamiento (m) | Densidad (t/m³) | Factor t/m |
|---|---|---|---|---|
| D1 | 2,8 | 2,5 | 2,65 | 18,55 |
| D6 | 2,8 | 2,5 | 2,65 | 18,55 |
| C1 | 2,8 | 2,5 | 2,7 | 18,90 |
| C3 | 2,8 | 2,5 | 2,7 | 18,90 |
| Alcancía | 2,8 | 2,5 | 2,75 | 19,25 |

D1 y D6 son **Dolomita**; C1 y C3, **Chocolata**; la densidad va con el tipo de
piedra. Su propia nota dice: *"Estas son mallas de DISEÑO, no medidas en campo.
Si una voladura usó otra malla, cargala en las columnas P/Q/R de VOLADURAS."*

**`PERFORACIÓN`** (96 filas) — una fila por voladura, la etapa de barrenado:
código (`V01D625`), inicio y fin de perforación, cantera, profundidad por pozo
(m), cantidad de pozos, metros perforados, TC USD (pesos por dólar), precio USD
(por metro), total en pesos, N° de factura, y una columna "Coincide".

**`VOLADURAS`** (98 filas) — la voladura primaria: código, fecha de carga de
explosivo, fecha de voladura, cantera, pozos, metros, **toneladas voladas**,
**explosivos en texto libre** (`"emulex x 60 mm: 48,5"`), TC USD, total en
pesos, N° factura, "Coincide", observaciones, y el override de malla real
(burden / espaciamiento / densidad) más el factor t/m aplicado.

**`BOCHONES`** (157 filas) — la voladura **secundaria**, para romper los bloques
(bochones) que quedaron grandes: código (`B01D625`), fechas, precio USD/m,
cantera, voladura asociada (casi siempre vacía), metros perforados, cantidad de
pozos, TC, pesos, factura, "Coincide".

**`CONSUMOS`** (1.128 filas) — el detalle de insumos de cada voladura: código,
tipo (`Detonador` / `Otros insumos` / `Voladura`), insumo (texto libre),
cantidad, precio USD, total USD, total ARS. Es la fuente del monto de la
voladura. Vocabulario que aparece: emulex x 60/70 mm, anfo premium, booster
225/250/450 grs, detonadores x 4,8 / x 12 / x 18, retardos de superficie, mecha
lenta, det. n°8, cordón 5 grs, servicio de voladura.

**`INFORME <MES> <AÑO>`** — una pestaña por mes, **generada por un Apps Script**.
Los cuatro bloques del mes más indicadores por cantera: USD/ton, gr explosivo/ton,
ton/m perforado, y el costo abierto en perforación / explosivo / servicio /
accesorios.

## Lo que está roto o es frágil hoy

**Las canteras y los insumos están clavados como texto en cada celda.** `"D6"`,
`"Detonadores x 4,80"` vs `"Detonadores x 4,8"` vs `"detonadores x 4,80 mts"` —
el mismo insumo escrito de tres formas en `CONSUMOS`. Cualquier indicador que
agrupe por insumo suma peras con manzanas.

**La toneladas volada de la planilla no sale de ninguna fórmula estable.**
`V01D625`: 108 m perforados, 36 pozos × 3 m, D6. La cuenta que definió cantera
—`pozos × m/pozo × densidad × burden × espaciamiento`— da `36 × 3 × 2,65 × 2,8 ×
2,5 = 2.003 t`, pero la planilla dice 1.686,96. `V06C325` da 1.512 calculado
contra 950,4 en la planilla. **La columna histórica no se recalcula**: se
importa como viene. De la fecha de arranque en adelante, el SdG calcula con la
fórmula de cantera y ese número manda.

**`#VALUE!` viajando como dato.** `V04C325` tiene el texto *"NO SE PUDO
VERIFICAR…"* en la celda de metros, y de ahí para abajo la fila es `#VALUE!`.
Fechas con `inicio > fin` (`V09C325`). Errores de carga que la planilla no marca.

**El informe mensual es un script sin fuente controlada.** Corre a las 5 AM,
arma una pestaña nueva, y nadie revisa si el mes anterior quedó completo.

## Quién manda sobre el dato

**Manda el SdG. La planilla queda como respaldo de una sola vía y no se carga
más desde ahí.** Es la misma decisión de Producción y Despacho, y la pidió el
usuario explícitamente: *"quiero que las planillas queden como base de datos
pero que no se cargue más la información desde ahí; se carga directamente desde
el SdG"*.

De eso se desprende:

- **El Apps Script del informe mensual desaparece.** El SdG arma el informe de
  sus propias filas.
- **Las planillas se pueden simplificar.** Al no ser más el lugar de carga, se
  les pueden sacar las columnas de fórmula, las pestañas derivadas y los
  `INFORME <MES>`. Lo que queda es una pestaña por entidad —perforaciones,
  voladuras, bochones, consumos— que el SdG reescribe. El detalle de qué se
  poda va en un apéndice cuando se toque la planilla; no bloquea el módulo.
- **El espejo escribe, nunca lee** (salvo la importación inicial, abajo).
- **El riesgo asumido**, como en `docs/PRODUCCION.md`: si alguien igual edita la
  planilla a mano, el SdG no se entera y la pisa la próxima vez que se guarde
  esa fila.

### La importación inicial — sólo el año en curso

Una única corrida (`POST /api/cantera/importar`, sólo `admin`) trae las filas de
**2026** de `PERFORACIÓN`, `VOLADURAS`, `BOCHONES` y `CONSUMOS`. Lo anterior a
2026 queda sólo en la planilla vieja. Es una importación puntual con el molde
del importador del histórico de Despacho: `upsert` por `codigo`, fechas por
`fechaDeSheets()`, `#VALUE!` y textos en campo numérico caídos a `null` con el
motivo anotado, y un reporte de qué entró y qué no. Después de esa corrida la
ruta puede quedar o borrarse; no es parte del funcionamiento normal.

## Las decisiones

**El catálogo de canteras es una tabla, con su malla de diseño y su tipo de
piedra.** `D1, D6, C1, C3, Alcancía` hoy; el día que se abra un frente nuevo es
una fila. Cada una lleva su `codigo` corto (`D1`, `D6`, `C1`, `C3`, `A` —
Alcancía entra como `A` en el código de voladura), el material (`Dolomita` /
`Chocolata` / …), la densidad, y la malla nominal (burden, espaciamiento).

**El código de voladura se genera solo.** Al elegir el yacimiento, el SdG arma
`V{NN}{codigo_yac}{AA}`:

- `NN` — el correlativo de ese yacimiento **en ese año**, con cero a la
  izquierda. `V01D625`, `V02D625`, … cuentan aparte de `V01C325`, …
- `codigo_yac` — el código corto de la cantera (`D6`, `C3`, `A`).
- `AA` — los dos últimos dígitos del **año de la voladura**. Si al crear el
  registro todavía no hay fecha de voladura, se usa el año en curso.

El bochón es igual con `B`. El código se fija al crear y **no persigue** cambios
posteriores de la fecha: si una voladura cargada en diciembre se dispara en
enero, el código sigue diciendo el año viejo — es lo que ya pasa en la planilla.
Se guardan `anio` y `correlativo` como columnas propias, no sólo dentro del
string, para calcular el siguiente sin parsear.

**Perforación y voladura son un solo registro, con dos facturas.** El `codigo`
es una identidad: la misma voladura tiene una etapa de perforación (barrenado) y
una etapa de voladura (carga y disparo). Son dos montos y dos facturas de Odoo
por conciliar —cualquiera de los dos contratistas puede haber facturado
cualquiera de las dos etapas—, pero una fila. El bochón sí es un evento aparte,
con su propio código.

**Cada etapa registra su propia malla.** Burden y espaciamiento se guardan en el
registro —prellenados con la malla de diseño del yacimiento, editables— porque
la voladura real puede haber usado otra. La densidad sale del yacimiento (va con
el tipo de piedra) y no se tipea por fila.

**El monto de la perforación se calcula; el de la voladura sale de los
insumos.**

```
monto perforación = pozos × metros_por_pozo × precio_usd_m × tc_usd
monto voladura    = Σ (renglón.cantidad × renglón.precio_usd) × tc_usd
```

El `precio_usd_m` de la perforación se tipea en cada registro (se puede
prellenar con el de la perforación anterior del mismo yacimiento). Los renglones
de consumo de la voladura son la pestaña `CONSUMOS` cargada en el SdG: cada uno
es un `insumo_id` + cantidad + precio (del catálogo, pisable en el renglón).

**Las toneladas estimadas se calculan y no se guardan.**

```
toneladas = pozos × metros_por_pozo × densidad × burden × espaciamiento
```

Con la densidad del yacimiento y la malla del registro. Es función pura de la
fila, así que se despeja al leer —como la producción en Producción y los tiempos
en Despacho— y vive en `lib/cantera/toneladas.ts` con tests. La columna histórica
importada de 2026 se guarda aparte (`toneladas_planilla`) y se muestra al lado
para comparar, sin recalcularse.

**FINANZAS es una lista aparte, no un nivel.** Con el molde exacto de
`os_aprobadores`: una tabla `cantera_finanzas`, pertenecer a ella *es* el
permiso, y a propósito no alcanza con ser admin del módulo ni del sistema.
Cargar una voladura y conciliar su factura las hacen personas distintas.
Finanzas entra a `/cantera` sólo para eso: ver los montos calculados sin
conciliar y **vincular cada etapa a la factura real del proveedor en Odoo**
(ver la sección siguiente). No edita metros, pozos ni malla.

### El control cruzado con Odoo

El SdG ya habla con el Odoo del grupo (`lib/odoo/client.ts`,
[docs/ODOO-INTEGRACION.md](../../ODOO-INTEGRACION.md)). Los dos contratistas de
cantera —**Canobe** (Canobe Carlos Fabián, CUIT `23224987439`) y **Voladuras
Olavarría S.A.** (CUIT `30716046482`)— facturan **indistintamente** perforación,
voladura o bochones, y **a cualquiera de las dos empresas**. Sus facturas viven
en Odoo como `account.move` de tipo `in_invoice`. La regla de la integración no
se toca: **la contabilidad la escribe Odoo, el SdG sólo lee.** Un `account.move`
posteado es inmutable; acá ni siquiera se crea un borrador.

Confirmado contra Odoo staging el 10/09/2026: cada contratista es **dos
partners**, uno por empresa (Canobe: 815 en Polcecal, 1955 en Polysan; Voladuras
Olavarría: 1055 y 2340) — el mismo patrón de `proveedores_odoo`. Sólo en agosto
Canobe tiene ~10 `in_invoice` posteadas repartidas en las dos empresas.

Lo que hace el módulo es **cruce de lectura**:

- Cada etapa (perforación, voladura) y cada bochón guarda, cuando finanzas lo
  vincula, el `id` del `account.move`, más su `name`, la empresa, y
  **`amount_untaxed`** (el neto) — cacheados para mostrar y comparar sin volver a
  Odoo en cada pantalla.
- **El SdG compara** el monto que calculó (`pozos × m/pozo × precio USD × TC`, o
  la suma de consumos) contra `amount_untaxed` de la factura vinculada —el monto
  de la planilla es **neto**, confirmado con el usuario— y muestra la diferencia
  con una lectura: `coincide` (≤ 2%), `revisar` (> 2%). Es la columna "Coincide"
  de la planilla, ahora contra el dato real de Odoo.
- **El picker de factura** sale de Odoo en vivo: al abrir el bloque de
  conciliación, el SdG lista los `in_invoice` **posteados** de **los dos
  contratistas, de las dos empresas**, en un rango de fecha, que todavía no
  estén vinculados a ningún registro de cantera, con fecha, empresa, `name` e
  importe neto. Finanzas elige el que corresponde. El `name` de Odoo es su
  secuencia interna (`BILL/2026/08/0204`), no el número del proveedor —y el
  campo `ref` viene vacío—, así que el match lo hace la persona por contratista
  + fecha + importe, y anota el número de papel en `*_odoo_ref` del lado del SdG.
- **El cruce inverso es un aviso**: facturas de Canobe / Olavarría en Odoo de
  los últimos meses que **no** están vinculadas a ninguna perforación, voladura
  ni bochón — o sea, algo que se está pagando sin una voladura que lo respalde.
  Es la misma lógica del "SI NO CIERRA" de la planilla de cubicación.
- Finanzas puede marcar `conforme` (revisado y aceptado aunque difiera) con una
  observación. Y hay un `ref` de texto para anotar el número del proveedor
  **antes** de que la factura exista en Odoo.

Quiénes son los contratistas de cantera sale de una tabla chica,
`cantera_contratistas`: sólo `proveedor_id` del SdG (hoy dos filas). No hay
`rol` — cualquiera de los dos factura cualquier etapa. Cada `proveedor_id` se
resuelve a sus `partner_id` de Odoo (hasta dos, uno por empresa) por la tabla
`proveedores_odoo` que ya existe. El cruce con Odoo **nunca es por nombre** —
trampa nº4 del README de migraciones y regla de toda la integración.

`ODOO_DB` hoy apunta a **staging**; el cruce tiene que leer la instancia donde
están las facturas reales. `dondeApuntaOdoo()` ya distingue y lo muestra en
pantalla.

**Sin enums del módulo más allá de `modulo`.** Los campos controlados —`tipo` de
consumo, el material del yacimiento— son `text` con el vocabulario en
`lib/cantera/`. Lección de Despacho: un valor de enum nuevo obliga a una
migración sola (`55P04`) y estos crecen. El único `alter type` es el que mete
`'cantera'` en `modulo`, y **viaja solo**.

**Una pantalla por vista, más el mes y el informe.** No hay estado de "voladura
cerrada": se carga, se corrige, y la conciliación de facturas la agrega finanzas
por su lado.

## Lo que se construye

### 1. El módulo en el núcleo — dos migraciones

La primera **viaja sola**:

```sql
alter type modulo add value if not exists 'cantera';
```

Trampa #1 del [README de migraciones](../../../supabase/migrations/README.md)
(`55P04`), precedentes 015 / 045 / `20260907154332` / `20260908104728`.

La segunda trae tablas (incluida `cantera_contratistas`), índices, la lista
`cantera_finanzas`, las funciones de permiso (`tiene_acceso_cantera()`,
`puede_editar_cantera()`, `es_admin_cantera()`, `puede_facturar_cantera()`) y las
policies de RLS, con el molde de `20260908104729_despacho_schema.sql` y
`20260904140041_os_aprobadores.sql`.

`cantera_contratistas` tiene FK a `proveedores` — hay que revisar los embeds de
`proveedores` antes de dar la migración por buena, que es la trampa de PostgREST
que `compras_odoo_ordenes` ya activó (un segundo camino a una tabla rompe
`.select("*, proveedores(...)")` con `PGRST201`, sin avisar). Está en la sección
"Cuidados" de la doc de integración. La tabla se puede sembrar por `select` de
`proveedores` por CUIT (`23224987439`, `30716046482`), con el molde del sembrado
de `os_aprobadores`; si esos proveedores todavía no existen en el SdG, queda
vacía y la llena admin desde `/cantera/configuracion`.
Las funciones de la base y `lib/cantera/auth.ts` tienen que decir lo mismo —
cuando no coincidieron, en la 029, un `admin_sistema` veía los botones y RLS le
devolvía listas vacías.

Los tres niveles: `lectura` mira y usa el informe, `edicion` carga y corrige
perforación / voladura / bochones / consumos, `admin` además toca los catálogos
y administra la lista de finanzas. `puede_facturar_cantera()` es ortogonal: sale
de estar en `cantera_finanzas`.

### 2. Las tablas

```sql
create table cantera_yacimientos (
  id              uuid primary key default gen_random_uuid(),
  codigo          text not null unique,   -- 'D1','D6','C1','C3','A' — el que va en el código de voladura
  nombre          text not null,          -- 'Alcancía'
  material        text not null,          -- 'Dolomita' | 'Chocolata' | ... (vocabulario en lib)
  densidad_t_m3   numeric not null,
  burden_m        numeric,                -- malla de diseño, prellena el registro
  espaciamiento_m numeric,
  activo          boolean not null default true,
  orden           int not null default 0
);

create table cantera_insumos (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  tipo        text not null,              -- 'detonador' | 'otros_insumos' | 'voladura'
  precio_usd  numeric,                    -- vigente; el renglón puede pisarlo
  activo      boolean not null default true,
  orden       int not null default 0
);

create table cantera_finanzas (
  usuario_id uuid primary key references usuarios(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Los contratistas de cantera (hoy Canobe y Voladuras Olavarría). Sin rol:
-- cualquiera factura cualquier etapa. Se resuelven a partner(s) de Odoo por
-- proveedores_odoo.
create table cantera_contratistas (
  proveedor_id uuid primary key references proveedores(id) on delete restrict
);

-- Perforación + voladura: un registro, dos facturas.
create table cantera_voladuras (
  id                  uuid primary key default gen_random_uuid(),
  codigo              text not null unique,          -- 'V01D625'
  yacimiento_id       uuid not null references cantera_yacimientos(id) on delete restrict,
  anio                int  not null,                 -- año de la voladura usado en el código
  correlativo         int  not null,                 -- NN por (yacimiento, anio)

  -- ── etapa perforación ──
  perf_inicio         date,
  perf_fin            date,
  pozos               numeric,
  metros_por_pozo     numeric,
  burden_m            numeric,                       -- prellenado del yacimiento, editable
  espaciamiento_m     numeric,
  perf_precio_usd_m   numeric,
  perf_tc_usd         numeric,
  -- monto perf = pozos * metros_por_pozo * perf_precio_usd_m * perf_tc_usd  (derivado, lib)
  -- ── conciliación de la factura de perforación (finanzas) ──
  perf_odoo_move_id   int,                           -- el account.move que finanzas vinculó
  perf_odoo_move_name text,                          -- 'BILL/2026/08/0204', cacheado
  perf_odoo_empresa   text,                          -- 'POLCECAL' | 'POLYSAN' — texto, no FK, para no abrir un 2º camino de PostgREST a empresas
  perf_odoo_ref       text,                          -- el nro de papel del proveedor ('FC A 0001-00000340')
  perf_odoo_importe   numeric,                       -- amount_untaxed (neto) cacheado, para el cruce
  perf_odoo_leido_en  timestamptz,
  perf_conforme       boolean,                       -- null = sin revisar
  perf_conforme_obs   text,
  perf_conforme_por   uuid references usuarios(id),
  perf_conforme_en    timestamptz,

  -- ── etapa voladura ──
  vol_fecha_carga     date,
  vol_fecha           date,
  vol_pozos           numeric,                       -- pozos efectivamente volados (puede diferir de `pozos`)
  vol_metros_por_pozo numeric,
  vol_burden_m        numeric,
  vol_espaciamiento_m numeric,
  vol_tc_usd          numeric,
  explosivos_raw      text,                          -- VOLADURAS!Explosivos, verbatim (importación)
  toneladas_planilla  numeric,                       -- la columna histórica; no se recalcula
  -- monto voladura = Σ(consumo) * vol_tc_usd   (derivado, lib)
  -- toneladas       = vol_pozos * vol_metros_por_pozo * densidad * vol_burden * vol_espaciam  (derivado, lib)
  -- ── conciliación de la factura de voladura (finanzas) ──
  vol_odoo_move_id   int,                            -- el account.move que finanzas vinculó
  vol_odoo_move_name text,
  vol_odoo_empresa   text,
  vol_odoo_ref       text,
  vol_odoo_importe   numeric,                        -- amount_untaxed (neto)
  vol_odoo_leido_en  timestamptz,
  vol_conforme       boolean,
  vol_conforme_obs   text,
  vol_conforme_por   uuid references usuarios(id),
  vol_conforme_en    timestamptz,

  observaciones       text,
  origen              text not null default 'sdg',   -- 'sdg' | 'importacion'
  sheets_pendiente    text,
  sheets_pendiente_en timestamptz,
  cargado_por         uuid references usuarios(id),
  cargado_en          timestamptz not null default now(),
  actualizado_por     uuid references usuarios(id),
  actualizado_en      timestamptz,

  unique (yacimiento_id, anio, correlativo)
);

create table cantera_bochones (
  id                  uuid primary key default gen_random_uuid(),
  codigo              text not null unique,          -- 'B01D625'
  yacimiento_id       uuid not null references cantera_yacimientos(id) on delete restrict,
  anio                int not null,
  correlativo         int not null,
  voladura_codigo     text references cantera_voladuras(codigo) on delete set null,
  inicio              date,
  fin                 date,
  pozos               numeric,
  metros_perforados   numeric,
  precio_usd_m        numeric,
  tc_usd              numeric,
  -- monto = metros_perforados * precio_usd_m * tc_usd
  odoo_move_id        int,                            -- el account.move que finanzas vinculó
  odoo_move_name      text,
  odoo_empresa        text,
  odoo_ref            text,
  odoo_importe        numeric,                         -- amount_untaxed (neto)
  odoo_leido_en       timestamptz,
  conforme            boolean,
  conforme_obs        text,
  conforme_por        uuid references usuarios(id),
  conforme_en         timestamptz,
  observaciones       text,
  origen              text not null default 'sdg',
  sheets_pendiente    text,
  sheets_pendiente_en timestamptz,
  cargado_por         uuid references usuarios(id),
  cargado_en          timestamptz not null default now(),
  actualizado_por     uuid references usuarios(id),
  actualizado_en      timestamptz,
  unique (yacimiento_id, anio, correlativo)
);

create table cantera_consumos (
  id              uuid primary key default gen_random_uuid(),
  voladura_codigo text not null references cantera_voladuras(codigo) on delete cascade,
  insumo_id       uuid references cantera_insumos(id),
  insumo_raw      text,                  -- lo que decía CONSUMOS!Insumo; fuente si insumo_id es null
  tipo            text,                  -- 'detonador' | 'otros_insumos' | 'voladura'
  cantidad        numeric not null,
  precio_usd      numeric,               -- del catálogo salvo que se lo pise
  orden           int not null default 0
);
```

- **`unique` como constraint, no índice parcial** (código y la terna
  yacimiento/año/correlativo): son destinos de `ON CONFLICT` de la importación —
  trampa #2 del README, que ya mordió en la 033 y la 046.
- Nada de `total_usd` / `total_ars` / `metros_perforados` calculados guardados en
  voladuras: se despejan en `lib`. La misma decisión que Producción y Despacho.
- `vol_pozos` / `vol_metros_por_pozo` separados de los de perforación: la
  planilla ya distingue "pozos" de "pozos volados". Al crear la etapa de
  voladura se prellenan con los de perforación.
- `odoo_move_id` es un `int` suelto, no un FK: apunta a Odoo, no a una tabla de
  Supabase, así que no abre un segundo camino de PostgREST. Índice único parcial
  `where perf_odoo_move_id is not null` (y los otros dos) para no vincular dos
  registros a la misma factura.
- Índices: `(yacimiento_id, vol_fecha desc)` y equivalente en bochones para los
  listados por yacimiento; parciales de `sheets_pendiente`; y para el tablero de
  finanzas, parcial `where perf_conforme is null or vol_conforme is null`.

### 3. La lógica pura — `lib/cantera/`

| Archivo | Qué decide |
|---|---|
| `codigos.ts` | Armar `V{NN}{yac}{AA}` / `B…` a partir de yacimiento + año; parsear uno existente; el próximo correlativo libre de `(yacimiento, año)` |
| `costos.ts` | `monto perforación`, `monto voladura` (suma de consumos), `monto bochón`; la diferencia contra el importe de la factura vinculada y la lectura `coincide` / `revisar` (umbral 2%) |
| `toneladas.ts` | `pozos × m/pozo × densidad × burden × espaciamiento`; el desvío contra `toneladas_planilla` |
| `odoo.ts` | Traer los `in_invoice` posteados de los contratistas (por partner, rango de fecha, las dos empresas) sin los ya vinculados; el cruce inverso (facturas sin registro de cantera). La parte de red es fina; la decisión —umbral, lectura— vive en `costos.ts` con tests |
| `contratistas.ts` | La lista de `proveedor_id` de `cantera_contratistas` → todos sus `partner_id` de Odoo (hasta dos por contratista) por `proveedores_odoo` |
| `consumos.ts` | Totales USD/ARS de una voladura; el cotejo entre `explosivos_raw` y la suma de los renglones |
| `informe.ts` | La agregación mensual y los KPIs: USD/ton, USD/ton por cantera, gr explosivo/ton, ton/m perforado, costo abierto en perforación/explosivo/servicio/accesorios. **Es el módulo**: es el Apps Script reescrito con tests |
| `planilla.ts` | El mapeo fila ↔ celdas para las cuatro pestañas del espejo |
| `importar.ts` | Parsear las filas 2026 de cada pestaña → registros; fechas por `fechaDeSheets()`; `#VALUE!` y textos en campo numérico → `null` con motivo |
| `espejo.ts` | La escritura de vuelta. Fino: arma celdas con `planilla.ts` y llama a `escribirCeldas` / `agregarFila` de `lib/core/sheets.ts` |
| `auth.ts` | Los tres niveles + `puedeFacturarCantera()`, espejando la base; `finanzasDeCantera()` para la pantalla de administración |

Del núcleo se reusan `traerTodo()` (`lib/core/paginado.ts` — `CONSUMOS` ya pasa
las 1.000 filas), `fechaDeSheets()` / `fechas.ts`, `columnaDeSheets.ts`,
`leerValores` / `escribirCeldas` / `agregarFila` de `lib/core/sheets.ts`, y
`catalogo.ts` (`indiceDeCatalogo` / `elQueNombra`) para reconocer el insumo
escrito a mano en la importación — sin `catalogo.ts` propio.

### 4. El espejo

Al guardar en el SdG se reescribe la fila del código en su pestaña, ubicada por
`codigo` en la columna A. Reglas del repo, sin excepción:

- La fila se busca por el código, no contando. Si el código no está, se agrega
  con `agregarFila` usando la columna del código como "columna que manda".
- Las fechas en d/m, con el helper del núcleo.
- Un fallo de escritura va a `sheets_pendiente` / `sheets_pendiente_en` **con lo
  que dijo Google sin traducir**, se muestra a quien guardó, y se lista con un
  botón de reintentar. Igual que Compras, Inventario, Producción y Despacho.

Escribir es la planilla de producción: el espejo se prueba en el deploy.

### 5. Las pantallas

| Ruta | Qué es |
|---|---|
| `/cantera` | El tablero: selector de yacimiento y, debajo, sus perforaciones/voladuras y sus bochones. Arriba los avisos — toneladas fuera del ±15% de `toneladas_planilla`, montos sin conciliar, cruce que da `revisar`, **facturas de Canobe/Olavarría en Odoo sin registro de cantera**, filas que no llegaron a la planilla, perforado sin volar. Para finanzas, el foco son los tres del medio |
| `/cantera/voladuras/[codigo]` | Alta/edición: elegir yacimiento (genera el código), etapa perforación (fechas, pozos, m/pozo, malla, precio USD/m, TC → monto), etapa voladura (fecha, pozos volados, malla, TC, renglones de consumo → monto, toneladas calculadas). El bloque de conciliación de cada etapa —picker de factura de Odoo, cruce, marca `conforme`— sólo lo ve y edita finanzas |
| `/cantera/bochones/[codigo]` | Alta/edición de un bochón |
| `/cantera/informes` | El informe mensual con los KPIs. Reemplaza las pestañas `INFORME <MES>` del script |
| `/cantera/insumos` | Catálogo de insumos con precio USD. Sólo `admin` |
| `/cantera/yacimientos` | Catálogo de canteras: código, material, densidad, malla de diseño. Sólo `admin` |
| `/cantera/configuracion` | La lista de finanzas y el mapeo `cantera_contratistas` (qué proveedor factura cada etapa). Sólo `admin` |

Más la tarjeta del inicio, con el molde de la de Inventario: **montos sin
conciliar** y **filas que no llegaron a la planilla**. El módulo entra en
`MODULOS_ORDEN` y `modulosVisibles` de `lib/core/access.ts`, en `NAV` de
`lib/core/nav.ts` (con un ítem gateado por estar en `cantera_finanzas`, como
`soloAprobadorCompras`), y `'cantera'` en el type `Modulo` de `lib/core/types.ts`.

La carga es **mobile-first**: el capataz cierra una voladura desde el frente, en
el celular, con señal intermitente. El listado y el informe se miran después
desde la PC.

`CONSUMOS` crece ~40 filas por voladura: todo lo que las barra usa `traerTodo()`
desde el primer día, y los filtros van por rango de fecha, nunca por un `.in()`
de muchos ids.

## Tests

Vitest sobre las funciones puras:

- **`codigos.ts`** — `V01D625` ↔ `{V, 1, D6, 2025}`; `B03C126`; el próximo
  correlativo de `(D6, 2026)` con huecos; año tomado de la fecha de voladura vs
  año en curso cuando falta.
- **`costos.ts`** — monto perforación con los números de la planilla
  (`V01D625`: 108 × 13,43 × 1515 ≈ 2.197.417); monto voladura como suma de
  consumos; la diferencia contra `amount_untaxed` de la factura y el umbral del
  2% (`coincide` / `revisar`); el cruce inverso: una factura sin registro.
- **`contratistas.ts`** — la lista → partners de las dos empresas; un contratista
  sin enlace en `proveedores_odoo`, que devuelve el motivo, no una lista vacía.
- **`toneladas.ts`** — la fórmula de cantera; el desvío del 15% que dispara el
  amarillo contra `toneladas_planilla`.
- **`consumos.ts`** — totales USD/ARS; una voladura con `explosivos_raw` pero
  sin renglones (avisa, no rompe); un renglón con `insumo_id` en `null` y
  `insumo_raw` cargado, que se suma igual.
- **`informe.ts`** — con datos de juguete: los cuatro bloques del mes, USD/ton y
  gr explosivo/ton, y el mes sin voladuras (0 toneladas, sin dividir por cero —
  el error que el % de rotura tiene hoy en Producción).
- **`importar.ts`** — una fila con `#VALUE!` en metros → `null` con motivo;
  `inicio > fin`, que entra pero se marca; el `upsert` por código; sólo filas de
  2026.
- **`planilla.ts`** — el orden de las columnas de cada pestaña; fila que se
  agrega vs fila que se reescribe.

Las rutas y las pantallas no llevan tests, como en el resto del repo.

## Lo que hace falta de una persona

Nada de esto frena escribir el código ni los tests. Frena **cargar datos de
verdad** y **prender el espejo**.

De cantera:

1. **El catálogo de insumos canónico** — un renglón por insumo real, con su tipo
   (detonador / otros / voladura) y su precio USD, para colapsar las tres formas
   en que hoy está escrito `"detonadores x 4,8"`.
2. **Confirmar la fórmula de toneladas.** Cantera la dio como `pozos × m/pozo ×
   densidad × burden × espaciamiento`, pero no reproduce la columna histórica
   (`V01D625` da 2.003 calculado vs 1.687 en la planilla). ¿Está bien la
   fórmula y mal la planilla vieja, o falta un factor (altura de banco, pasador)?
3. **Qué es cada número en `BOCHONES`.** Las columnas "Metros perf." (siempre 1)
   y "Perforaciones" (67, 197, 384…) parecen estar al revés: el costo usa la
   segunda como metros. Confirmar antes de importar.
4. **Los cinco yacimientos**: código corto, material y densidad — la tabla de
   `PARAMETROS` de arriba, a confirmar o corregir. En especial el código y el
   material de Alcancía.
5. **Confirmar los contratistas del lado del SdG.** Canobe (CUIT `23224987439`)
   y Voladuras Olavarría (`30716046482`) ya están en Odoo, uno por empresa. Falta
   que estén en `proveedores` del SdG y **enlazados en `proveedores_odoo`** — si
   no lo están, hay que darlos de alta y correr el enlace por CUIT (el preview de
   `/api/odoo/proveedores` lo calcula). Sin eso `contratistas.ts` no resuelve
   partners y el picker queda vacío.

Del usuario:

6. ~~El id de la planilla y si el Total es neto~~ **resuelto**:
   `GOOGLE_SHEETS_CANTERA_ID` en `.env.local`, hoja compartida como **editor**, y
   el monto de la planilla es **neto** (se cruza contra `amount_untaxed`). Falta
   cargar la variable en Vercel para el deploy.
7. **`ODOO_DB` apuntando a la instancia con las facturas reales.** Hoy es
   staging (`polcecal-staging-37495859`). El cruce necesita producción.
8. **Quiénes son finanzas** — los `usuario_id` para sembrar `cantera_finanzas`.
9. **Correr las dos migraciones** en el editor SQL de Supabase. La del enum va
   sola.

## Fases siguientes

Cada una con su propio spec y su propio relevamiento — acá sólo el encuadre:

- **Fase 2 · Balanza / transporte / fleteros.** Las pesadas cantera → planta
  (`Datos`, 7.458 filas importadas del software de balanza), las tarifas $/ton
  por material, y el análisis por fletero. Falta decidir cómo entra el dato de
  balanza. Toca la frontera con Despacho, que también pesa camiones — pero
  Despacho es producto terminado a cliente y esto es material interno a planta.
- **Fase 3 · Destape de frente.** El registro de inversión en abrir frente: mano
  de obra propia, fleteros externos, horas de equipo (EM2–EM9), con tarifas $/h
  por mes. El más chico y aislado.
- **Fase 4 · Cubicación de yacimientos.** El cierre mensual por yacimiento:
  `existencia inicial + voladuras − acarreo = stock teórico` contra la
  existencia final medida, con la lectura `CIERRA / ACEPTABLE / REVISAR`.
  Depende de las fases 1 y 2 cargando en el SdG.

## Lo que este spec no incluye

- **Los diagramas de voladura.** Croquis de malla —generado por el sistema o
  adjuntado como archivo— queda para más adelante, decisión del usuario.
- **Crear o postear nada en Odoo.** El cruce es de lectura: se vincula a un
  `account.move` que ya existe y se compara. No se genera la factura ni un
  borrador — eso es del spec de facturación, si algún día cantera entra ahí.
- **La caché incremental de facturas de Odoo por cron.** La fase 1 consulta en
  vivo al abrir el picker; son pocas facturas por contratista y por mes. Un
  `cantera_facturas_odoo` alimentado por `lib/core/cron.ts` es optimización
  posterior.
- **El histórico previo a 2026.** Queda en la planilla vieja.
- **La simplificación de las planillas.** Se puede y conviene, pero el detalle
  de qué columnas y pestañas se podan va en un apéndice cuando se toque la
  planilla; no bloquea el módulo.
- **Paradas del equipo de perforación como dato de Mantenimiento.** Las
  observaciones son texto libre, igual que en la planilla.
