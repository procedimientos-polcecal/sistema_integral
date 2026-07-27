# Fase 3 — Migrar Remises — Design Spec

**Fecha:** 2026-07-27
**Estado:** Diseño aprobado — pendiente de plan de implementación

## Objetivo

Portar `remisgest` (repo `github.com/procedimientos-polcecal/remisgest`, single-file
vanilla JS + Firebase) al SdG, bajo `app/(app)/remises/`, reapuntando su modelo de
datos al núcleo compartido (`empleados`), normalizando el estado (hoy un blob JSON
único por org en Firestore) a tablas relacionales reales en Supabase, y migrando
notificaciones push fuera de Firebase Cloud Messaging.

## Punto de partida

`remisgest` gestiona el transporte en remis de empleados entre su domicilio y la
fábrica: asistencia diaria, generación automática de rutas (clustering + TSP contra
OSRM/Nominatim, ambos servicios públicos gratuitos sin API key), tarjetas de ruta
imprimibles/exportables, planificación semanal, plantillas reutilizables e historial.
Es, con diferencia, la fase de mayor riesgo de las tres: es la única app de origen sin
backend propio (todo el "servidor" es un documento Firestore por admin, reescrito
entero en cada guardado) y sin ningún test.

Hallazgos relevantes de la exploración (ver reporte de investigación completo en el
historial de la sesión; resumen aquí):

- **Bug real en producción**: la vista de empleado ("¿en qué remis voy?") y la Cloud
  Function de notificación nocturna leen `route.seats`, pero la generación de rutas
  solo escribe `route.stops`. `seats` nunca se completa — ambas features están rotas
  contra datos reales. Se **corrige** en el port (decisión del usuario), no se
  reproduce el bug.
- **No existe entidad "chofer"** en el original: `driver`/`phone` son dos campos de
  texto plano sobre `vehicles`. El pedido original de la fase ya anticipa una tabla
  `choferes` propia — se normaliza en el port.
- **Denormalización total**: cada ruta generada guarda una copia completa (snapshot)
  del vehículo y de cada empleado-parada, no referencias. Es deliberado (las rutas
  históricas no cambian si después se edita/borra un empleado o vehículo), pero impide
  cualquier análisis relacional real.
- **`empleados` del núcleo no inicia sesión** (comentario explícito del schema de la
  Fase 0: "salvo enlace opcional futuro"). `remisgest` sí requiere que el empleado
  inicie sesión para ver su asignación y registrar su token de notificación — hay que
  extender el modelo de auth (ver decisión #3 abajo).
- **Servicios externos**: Nominatim (geocoding) y OSRM (ruteo/matriz de distancias) son
  instancias públicas compartidas, gratuitas, sin SLA ni API key. Leaflet solo dibuja
  (no geocodifica). `xlsx-js-style` para import/export de Excel.
- **Auth admin/empleado hoy es implícito**: cualquier email que NO tenga un doc en
  `empAccounts` es tratado como admin (dueño de su propio `orgs/{uid}`); no hay rol
  explícito. No existe `firestore.rules` en el repo — el control de acceso real de hoy
  es una incógnita, no algo a replicar tal cual.

## Decisiones tomadas

1. **Se arregla el bug `seats`/`stops`.** En vez de portar dos conceptos paralelos
   (paradas denormalizadas para el admin + asientos que nunca se llenan para el
   empleado), el port usa una única tabla `asientos` con FK real a `empleados`, que
   alimenta tanto las tarjetas de ruta del admin como la vista "Mi remis" del empleado
   y la notificación push. Un solo dato, dos vistas — elimina la clase de bug del
   original de raíz.
2. **Notificaciones: Vercel Cron + Web Push nativo (VAPID), sin Firebase.** El sistema
   se deploya en Vercel. Se reemplaza Firebase Cloud Messaging por la Web Push API
   estándar del navegador (`PushManager`, ya sin dependencia de ningún SDK de Firebase)
   con un par de claves VAPID propias del SdG. Un cron job de Vercel
   (`vercel.json` → `crons`) golpea una Route Handler a las 22:00 UTC (19:00 Argentina)
   que recorre las hojas de ruta del día siguiente y envía los pushes vía la librería
   `web-push` de Node. El *service worker* ya compartido del SdG (si no existe uno
   global, se crea `public/sw.js`) agrega el manejador `push`/`notificationclick`.
3. **Geocoding/ruteo: se mantienen Nominatim y OSRM públicos**, sin costo adicional.
   Mismo comportamiento y mismos límites que hoy (riesgo de reliability heredado y
   documentado, no resuelto en esta fase — queda como nota para una fase futura si da
   problemas).
4. **Acceso de empleados: cuenta completa en `usuarios`.** Se agrega
   `usuarios.empleado_id uuid null references empleados(id)` — un login del núcleo
   puede estar *vinculado* a un empleado. Estas cuentas se crean con
   `rol = 'operario'` y **sin** fila en `usuario_modulos` para `remises` (eso sería
   acceso al panel de administración completo, que no les corresponde). En cambio, la
   ruta de auto-servicio (`/remises/mi-remis`) se gatea únicamente por
   `usuarios.empleado_id is not null` — devuelve solo los datos de ESE empleado, nunca
   una lista. El panel de administración (Hoy/Semana/Vehículos/Choferes/Turnos/
   Historial/Configuración) sigue gateado por `usuario_modulos(modulo='remises')`,
   igual que RRHH/Mantenimiento.
5. **Los datos reales de producción se migran** (Firestore de `remisgest`, proyecto
   `remisgest` en Firebase). Requiere credenciales de solo lectura (service account
   con permiso de lectura sobre Firestore, o exportar un dump). **Bloqueada hasta
   conseguir esa credencial**; el resto de la fase no depende de ella y se hace en
   paralelo, igual que se manejó en la Fase 2.
6. **"Historial" deja de ser una tabla separada.** En el original, `history[]` es una
   copia snapshot auto-guardada cada vez que se generan rutas (porque el blob completo
   se reescribe y si no se guardara aparte, se perdería). En el port, cada hoja de ruta
   generada ya es una fila persistida real — "historial" es simplemente
   "hojas de ruta pasadas", consultadas por rango de fecha. Se elimina una tabla entera
   sin perder funcionalidad; simplificación directa de normalizar el blob.
7. **Estructura de navegación**: Remises pasa a ser un grupo de nivel superior en
   `NAV` (como Mantenimiento), no un ítem anidado dentro de RRHH — aunque comparte
   `empleados` del núcleo, es un módulo de permisos independiente
   (`modulo: "remises"` ya existe desde la Fase 0) y tiene entidad propia (vehículos,
   choferes, rutas). El placeholder actual (`{ label: "Remises", href: "/rrhh/remises"
   }`) se corrige.

## Reconciliación de esquema

### Empleados

`employees` de `remisgest` reconcilia contra `empleados` del núcleo por lo que ya
existe (`nombre`... el núcleo separa `nombre`/`apellido`, `remisgest` tiene un único
campo `name` — se resuelve en la migración de datos, no en el schema). Lo que
`remisgest` necesita y el núcleo no tiene (`address` propia de recogida —
**puede diferir del domicilio de RRHH si en algún caso el punto de encuentro no es la
casa**, `lat`/`lng`, `defaultShiftId`) va a una tabla de extensión, mismo criterio que
`rrhh_empleados_datos`:

```
remises_empleados_datos (
  empleado_id       uuid primary key references empleados(id) on delete cascade,
  direccion         text,
  lat               numeric,
  lng               numeric,
  turno_default_id  uuid references remises_turnos(id) on delete set null
)
```

`empleados.domicilio` (núcleo, ya existe desde la Fase 0 — comentario explícito
"usado por Remises") se usa como valor inicial al geocodificar por primera vez, pero
`remises_empleados_datos.direccion` puede corregirse independientemente si el punto de
recogida real no coincide.

### Choferes (entidad nueva)

```
choferes (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  telefono   text,
  activo     boolean not null default true,
  created_at timestamptz not null default now()
)
```

### Vehículos

```
vehiculos (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  capacidad   integer not null default 8,
  chofer_id   uuid references choferes(id) on delete set null,
  activo      boolean not null default true,
  created_at  timestamptz not null default now()
)
```

### Turnos (ex `shifts` — nombre `remises_turnos`, no `jornadas`, para no colisionar
conceptualmente con los turnos de asistencia de RRHH aunque el dominio es distinto)

```
remises_turnos (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  hora_inicio text not null,
  hora_fin    text not null,
  color       text not null default '#059669',
  activo      boolean not null default true
)
```

Seed inicial: Mañana/Tarde/Noche (mismos horarios/colores del `DEFAULT_SHIFTS`
original), editable desde Configuración.

### Asistencia diaria

```
remises_asistencia (
  empleado_id uuid not null references empleados(id) on delete cascade,
  fecha       date not null,
  turno_id    uuid not null references remises_turnos(id) on delete cascade,
  primary key (empleado_id, fecha, turno_id)
)
```

Reemplaza `attendance[key][]` (array de IDs en el blob) por filas reales. Presencia =
existe la fila.

### Plan semanal

```
remises_plan_semana (
  empleado_id uuid not null references empleados(id) on delete cascade,
  fecha       date not null,
  turno_id    uuid not null references remises_turnos(id) on delete cascade,
  tipo        text not null check (tipo in ('ida', 'vuelta')),
  primary key (empleado_id, fecha, turno_id, tipo)
)
```

Reemplaza `weekPlan`. "Generar desde semana" copia estas filas a
`remises_asistencia` para la fecha elegida antes de generar rutas, igual que hoy.

### Hoja de ruta y asientos

```
create type remises_tipo_hoja as enum ('ida', 'vuelta');

hojas_ruta (
  id             uuid primary key default gen_random_uuid(),
  fecha          date not null,
  turno_id       uuid not null references remises_turnos(id),
  tipo           remises_tipo_hoja not null,
  vehiculo_id    uuid not null references vehiculos(id),
  chofer_id      uuid references choferes(id),   -- snapshot al generar; no sigue al vehículo si después cambia
  hora_salida    text,
  km             numeric(6,1),
  minutos        integer,
  geometria      jsonb,                          -- GeoJSON LineString de OSRM, null si no disponible
  created_at     timestamptz not null default now()
);

asientos (
  id           uuid primary key default gen_random_uuid(),
  hoja_ruta_id uuid not null references hojas_ruta(id) on delete cascade,
  empleado_id  uuid not null references empleados(id),
  orden        integer not null,                 -- posición en la parada (0 = primera parada real)
  unique (hoja_ruta_id, empleado_id)
);
```

`asientos` reemplaza tanto `route.stops` (denormalizado) como el `route.seats` roto
del original — es la única fuente para: tarjetas de ruta del admin, mapa, exportación,
vista "Mi remis" del empleado, y la notificación push. La dirección/coordenadas del
empleado en el momento de generar la ruta ya no necesita snapshot propio porque
`asientos` es una fila viva con FK — si de verdad hace falta el snapshot histórico de
la dirección (para que una ruta vieja no "cambie" si el empleado se muda), se agrega
`direccion_snapshot`/`lat_snapshot`/`lng_snapshot` nullable a `asientos` en
implementación si se decide preservar ese comportamiento; **por defecto se prefiere el
dato vivo** (más simple, más útil para reimprimir/reexportar), documentado como
desvío intencional del original.

La fábrica (`S.factory`) no es una parada en `asientos` — se resuelve en el momento de
renderizar/exportar a partir de `remises_config`, igual que hoy.

### Plantillas (presets)

```
remises_plantillas (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  tipo       remises_tipo_hoja not null,
  turno_id   uuid not null references remises_turnos(id),
  created_at timestamptz not null default now()
);

remises_plantillas_grupos (
  id            uuid primary key default gen_random_uuid(),
  plantilla_id  uuid not null references remises_plantillas(id) on delete cascade,
  vehiculo_id   uuid not null references vehiculos(id),
  empleado_id   uuid not null references empleados(id),
  unique (plantilla_id, vehiculo_id, empleado_id)
);
```

"Aplicar plantilla" a una fecha vuelve a correr OSRM contra los datos actuales de
empleados/vehículos, igual que el original.

### Configuración (singleton, `id = 1`, mismo patrón que `config_liquidacion`)

```
remises_config (
  id                integer primary key default 1 check (id = 1),
  fabrica_nombre    text not null default 'Fábrica',
  fabrica_direccion text,
  fabrica_lat       numeric,
  fabrica_lng       numeric,
  velocidad_kmh     numeric(5,1) not null default 40,
  ciudad_referencia text
)
```

### Notificaciones push

```
remises_push_tokens (
  usuario_id uuid primary key references usuarios(id) on delete cascade,
  endpoint   text not null,
  p256dh     text not null,
  auth       text not null,
  updated_at timestamptz not null default now()
)
```

Estructura estándar de una `PushSubscription` de la Web Push API (reemplaza
`fcmTokens`, que guardaba un solo `token` de FCM).

### RLS

Mismo patrón que RRHH/Mantenimiento: `puede_editar_remises()`/`es_admin_remises()`
sobre `usuario_modulos(modulo='remises')`, lectura abierta a
`tiene_acceso_remises()`. La ruta de auto-servicio del empleado (`/remises/mi-remis`
y su API) **no** pasa por estas funciones — verifica directamente
`usuarios.empleado_id = auth.uid()-vinculado` y solo puede leer sus propios
`asientos`/`hojas_ruta` (policy propia, acotada por `empleado_id`, no por nivel de
módulo).

## Alcance de esta fase

**Entra:** esquema relacional completo (con RLS) + algoritmo de generación de rutas
(clustering con capacidad + TSP contra OSRM, con fallback Haversine) portado casi
literal + todas las pantallas del panel admin (Hoy, Semana, Vehículos, Choferes,
Turnos, Plantillas/Historial, Configuración) + import/export de Excel (mismo formato
de columnas) + impresión de hoja de ruta (reutilizando el patrón ya existente de
`mantenimiento/planificacion/[id]/imprimir` en vez del popup `window.open` del
original, que los navegadores bloquean cada vez más) + vista de auto-servicio del
empleado ("Mi remis") + notificaciones push migradas a Web Push/Vercel Cron +
migración de datos reales de producción desde Firestore.

**No entra (documentado como pendiente explícito):**
- Reemplazar Nominatim/OSRM públicos por un proveedor pago (decisión explícita del
  usuario: se mantienen gratuitos por ahora).
- Multi-org / multi-tenant: el SdG ya es un solo tenant (el grupo Polcecal/Polysan),
  así que el concepto de "un `orgs/{adminUid}` por admin" del original directamente
  desaparece — todos los admins de Remises comparten las mismas tablas, acotados por
  `usuario_modulos`, no por un doc propio por usuario.
- Recurrencia real basada en calendario (ej. "todos los lunes"): se mantiene el patrón
  plantilla + reaplicar, igual que el original (no hay motor de reglas de calendario
  ni en el original ni en esta fase).
- Snapshot histórico de dirección/coordenadas en `asientos` (ver nota en esa sección):
  se implementa solo si durante el desarrollo se decide que hace falta preservarlo.

## Riesgos a vigilar durante el port

- **Servicios externos compartidos y gratuitos** (Nominatim, OSRM): sin SLA, pueden
  fallar o rate-limitear en producción. El original ya tiene fallbacks (Haversine +
  velocidad configurable) — se preservan tal cual.
- **`web-push` (VAPID) requiere que el usuario dé permiso de notificaciones en el
  navegador**, y en iOS Safari solo funciona si la PWA está "instalada" (Add to Home
  Screen) — limitación de la plataforma, no del código; documentar en la UI de "Mi
  remis" si hace falta.
- **Vinculación `usuarios.empleado_id`**: un empleado que cambia de legajo/es dado de
  baja y reingresa como "nuevo" empleado deja huérfano el vínculo — mismo tipo de
  cuidado ya aplicado a los borrados "seguros" de RRHH/Mantenimiento (bloquear baja de
  empleado si tiene cuenta vinculada activa, o desvincular explícitamente).
- **Import CSV naive** (`split(',')`, sin manejo de comillas) en el original: se
  reemplaza por un parser CSV real (o se restringe el import de `remisgest` a XLSX
  únicamente, ya que es el formato principal) para no heredar ese bug conocido.
