# Fase 2 — Migrar RRHH — Design Spec

**Fecha:** 2026-07-24
**Estado:** Diseño aprobado — pendiente de plan de implementación

## Objetivo

Portar `gestion-operarios` (Express + Prisma/Postgres + Vite/React 18, repo
`github.com/delfinapuch3/APPRRHH`) al SdG, bajo `app/(app)/rrhh/`, reapuntando su
esquema al núcleo compartido, migrando el motor de cálculo a Supabase, y trayendo los
datos reales de producción.

## Punto de partida

`gestion-operarios` es la fase más grande del proyecto: 15 modelos Prisma, ~30
endpoints Express, ~20 pantallas React, y un motor de cálculo de horas/liquidaciones
con **54 tests, todos puros** (sin mocks de DB) — el mayor activo del repo según el
spec general, y la razón por la que se preservan casi literales.

Hallazgo relevante: el `README.md` está desactualizado (dice SQLite); el
`schema.prisma` real y `.env.example` confirman que la app **ya corre sobre
Postgres**. Auth es JWT propio (`bcryptjs` + `jsonwebtoken`, expira 12h), no Supabase
Auth — los `User` actuales no se pueden migrar tal cual, hace falta recrearlos como
usuarios de Supabase Auth (mismo patrón manual que se usó para crear el primer admin
de Mantenimiento).

## Decisiones tomadas

1. **Rol `ADMIN`/`ENCARGADO`** (enum `Role` de gestion-operarios, sin `OPERARIO` — los
   operarios de planta no loguean, son solo filas `Employee`) se resuelve con el mismo
   patrón que Mantenimiento: `usuario_modulos(modulo='rrhh', nivel)`. `ADMIN` →
   `nivel='admin'`; sin nivel asignado → sin acceso. `admin_sistema` global sigue
   viendo/editando todo por su rol, como ya hace `nivelEnModulo()`.
2. **Alcance por sector del ENCARGADO se simplifica por ahora.** Hoy vive en una tabla
   propia (`UserSector`, muchos-a-muchos usuario↔sector) que acota qué empleados ve/edita
   cada encargado. Esta fase **no** replica esa granularidad: el acceso es a nivel de
   módulo completo (`lectura`/`edicion`/`admin` vía `usuario_modulos`, igual que
   Mantenimiento), dejando la puerta abierta a agregar un esquema de permisos más fino
   más adelante sin romper lo que se construye ahora. `UserSector` no se porta.
3. **Importación de Excel (fichadas/empleados) mantiene el flujo de dos pasos
   preview → confirmar**, pero el estado intermedio (hoy un `Map` en memoria del
   proceso Express, con TTL — no sobrevive a un entorno serverless con múltiples
   instancias) pasa a una tabla de staging en Supabase (`rrhh_import_staging`) con
   `token` + `expires_at`.
4. **Los datos reales de producción se migran como parte de esta fase** (a diferencia
   de Mantenimiento, donde se decidió diferir). Empleados, fichadas, ausencias,
   vacaciones, francos, liquidaciones y usuarios existentes se copian desde el Postgres
   de producción de gestion-operarios al Supabase del SdG. Requiere el `DATABASE_URL`
   de esa base (solo lectura desde ahí — nunca se escribe ni se borra nada en el
   origen). **Bloqueada hasta conseguir esa credencial**; el resto de la fase
   (esquema, motor, UI) no depende de ella y se hace en paralelo.

## Reconciliación de esquema

### Login y roles

`User` (gestion-operarios) desaparece como tabla propia — se reconcilia con
`usuarios` del núcleo (ya existe desde la Fase 0). El acceso al módulo se resuelve con
`usuario_modulos`, no con un campo de rol propio de RRHH.

### Empresas y sectores

`Empresa` (gestion-operarios) ya es `empresas` del núcleo — reconciliación directa por
nombre (POLCECAL/POLYSAN).

`Sector` en gestion-operarios **ya es transversal a las empresas por diseño** (el
propio Prisma schema lo documenta: "agrupa empleados por función... sin importar si
son de Polcecal o Polysan"; no tiene FK a empresa). Esto calza casi exacto con
`sectores.transversal` que ya agregó la Fase 1 para el sector "AMBOS" de Mantenimiento:
cada sector de gestion-operarios se crea (o reconcilia por nombre, si ya existe) como
una fila `sectores` con `transversal = true, empresa_id = null`.
**Riesgo a auditar en la migración de datos:** si un sector de gestion-operarios
coincide en nombre con un sector no-transversal que ya haya creado Mantenimiento (poco
probable dado el seed actual — Calidad/Producción/Mantenimiento/Administración por
empresa — pero hay que revisarlo contra los sectores reales de gestion-operarios antes
de correr la migración de datos), el índice único parcial de sectores transversales no
lo detecta (solo compara entre transversales), y quedarían dos sectores "Calidad" con
significados distintos.

### Empleados

`Employee` ya calza casi 1:1 con `empleados` del núcleo (`legajo`, `empresa_id`,
`sector_id` nullable, `fecha_ingreso`, `valor_hora_normal`, `horas_teoricas_diarias`,
`activo` — todos ya existen desde la Fase 0). Los campos que **no** están en el núcleo
(`sindicato`, `fechaNacimiento`, `genero`, `escalaVacacionesOverride`) van a una tabla
de extensión propia de RRHH, no al núcleo (mismo criterio que Mantenimiento: lo
específico de un dominio no infla las tablas compartidas):

```
rrhh_empleados_datos (
  empleado_id uuid primary key references empleados(id) on delete cascade,
  sindicato text,
  fecha_nacimiento date,
  genero text,
  escala_vacaciones_override jsonb
)
```

### Tablas de dominio (nombres ya anticipados en el spec general del SdG)

Se portan con nombres/columnas en español, IDs `uuid` (en vez de los `cuid()` string de
Prisma — la migración de datos remapea todas las FKs), y enums propios en snake_case:

- `jornadas` (ex `Jornada`)
- `fichadas` (ex `TimeRecord`)
- `rrhh_import_batches` (ex `ImportBatch`)
- `rrhh_import_staging` (nueva — reemplaza el cache en memoria del preview de Excel)
- `feriados` (ex `Holiday`)
- `config_liquidacion` (ex `PayrollConfig`, singleton `id = 1`)
- `calculos_diarios` (ex `DailyCalculation`)
- `ausencias` (ex `Absence`)
- `vacaciones` (ex `VacationPeriod`)
- `francos` (ex `FrancoCompensatorio`)
- `liquidaciones` (ex `PayrollPeriod`)

Enums nuevos (sin colisión con los ya creados por el núcleo/Mantenimiento):
`origen_fichada`, `tipo_dia`, `tipo_ausencia` (12 valores), `estado_franco`,
`tipo_liquidacion`, `estado_liquidacion`, `tipo_feriado`.

### Motor de cálculo

Se porta en dos capas, igual que hoy:

- **Funciones puras** (`calcularDia`, `diasCorrespondientes`, `ajustarFichadasPorTurno`,
  `intervalsParaDia`, `detectarTurno`, `anclaTurno`, todo `dates.ts`, los parsers de
  Excel `parseDateString`/`parseMarcaciones`/`parseNumeroAR`, y
  `reconciliarMarcaciones`) **se portan casi literales** a `lib/rrhh/engine/` — son
  TypeScript sin Prisma, y sus **54 tests existentes se portan con cambios mínimos**
  (mismas firmas, mismos casos).
- **Funciones con I/O** (`recalcularEmpleadoPeriodo`, `recalcularSectorPeriodo`,
  lectura de `config_liquidacion`) se reescriben contra el cliente de Supabase —
  misma lógica de negocio (upsert idempotente en `calculos_diarios`, respeta
  `horas_manual`, preserva `extras_validadas` solo si las horas no cambiaron, genera
  `francos` idempotente), pero sin tests de integración previos (tampoco los tenía el
  original) — se agregan tests nuevos donde el riesgo lo justifique.

`SECTORES_LUNES_A_VIERNES` (constante fija por nombre de sector, determina si
sábado/domingo cuentan como falta) se porta literal a `lib/rrhh/constants.ts`.

### RLS

Mismo patrón que Mantenimiento: `puede_editar_rrhh()` (`es_admin()` o
`usuario_modulos(rrhh, nivel in ('edicion','admin'))`) y `es_admin_rrhh()`
(`es_admin()` o `usuario_modulos(rrhh, 'admin')`) para las operaciones que hoy exigen
`requireAdmin` (usuarios, liquidaciones, jornadas, feriados, configuración, alta/baja
de empleados). Lectura abierta a cualquier autenticado con acceso al módulo
(`tiene_acceso_rrhh()`), replicando el patrón de Mantenimiento.

## Alcance de esta fase

**Entra:** esquema reconciliado + RLS + motor de cálculo portado (con sus 54 tests) +
todas las pantallas (Dashboard/Analítico, Empleados, Fichadas, Asistencia,
Ausencias/Licencias, Vacaciones, Francos, Liquidaciones, Administración de
RRHH-específico: usuarios ya los gestiona el núcleo, jornadas, feriados,
configuración) + importación de Excel (fichadas y empleados) vía staging en Supabase +
migración de los datos reales de producción.

**No entra (documentado como pendiente explícito):**
- Permisos granulares por sector para encargados (queda para cuando se definan los
  roles/permisos específicos mencionados por el usuario).
- Reemplazo del paquete `xlsx`/SheetJS (vulnerabilidad conocida sin parche, riesgo
  aceptado igual que en el original — el admin sube desde su propio reloj biométrico).
- Cron/automatización de recálculo — se mantiene on-demand (con cache de resultado,
  igual que hoy) en vez de un job programado.

## Riesgos heredados a vigilar durante el port

- **Zona horaria**: `dates.ts` aplica UTC-3 fijo a mano (sin DST desde 2009) para
  evitar un bug real ya corregido en el original (horas corridas 3hs en contenedores
  con `TZ=UTC`). Postgres maneja `timestamptz` nativamente — hay que decidir, al portar
  cada función, si se delega el offset a la columna o se preserva el cálculo manual,
  sin mezclar ambos enfoques (mezclarlos reintroduciría el mismo bug).
- **`SECTORES_LUNES_A_VIERNES` matchea por nombre de sector**, no por ID — acoplamiento
  frágil que se hereda tal cual (documentado, no se arregla en esta fase).
- **Triplicación de labels de tipos de ausencia** (enum Prisma + `tiposAusencia.ts` del
  frontend + `LABELS_TIPO` en el export de Excel) — se puede consolidar en una sola
  fuente de verdad al portar, ya que TypeScript nuevo no tiene la misma restricción que
  tener el enum en un schema Prisma separado del código de la app.
- **Borrado "seguro"** (empleados/usuarios bloqueados si tienen historial asociado) y
  **guardas de auto-modificación de admin** son lógica de aplicación, no de RLS — se
  preservan explícitas en los Route Handlers/Server Actions, como ya se hizo con
  patrones similares en Mantenimiento (ej. `ordenes_trabajo` PATCH evita
  mass-assignment).
