# SdG — Sistema de Gestión unificado (Polcecal / Polysan)

**Fecha:** 2026-07-22
**Estado:** Diseño aprobado — pendiente de plan de implementación (Fase 0)

## Objetivo

Unificar tres aplicaciones hoy independientes en un único **Sistema de Gestión (SdG)**
para el grupo Polcecal / Polysan, con un solo login, una sola base de datos y un
núcleo de datos compartido:

1. **RRHH** (`APPRRHH` / `gestion-operarios`) — asistencia y liquidación de sueldos.
2. **Mantenimiento** (`mantenimiento-pwa`) — mantenimiento de equipos.
3. **Remises** (`remisgest`) — logística de transporte de empleados.

La decisión estratégica es **unificación real desde cero**: no un shell que aloja tres
apps separadas, sino un sistema único donde se reescribe/porta lo necesario para que
todo comparta stack, base de datos y núcleo de entidades.

## Punto de partida (estado actual de las 3 apps)

| App | Repo | Stack actual | Backend / Datos |
|-----|------|--------------|-----------------|
| RRHH | github.com/delfinapuch3/APPRRHH | Monorepo npm: Express + Prisma (server) + Vite/React 18 (web) | Postgres (Prisma) |
| Mantenimiento | github.com/procedimientos-polcecal/mantenimiento | Next.js 16 + React 19 + Tailwind 4 (PWA) | Supabase (+ Dexie offline) |
| Remises | github.com/procedimientos-polcecal/remisgest | 1 archivo `index.html` (~3.900 líneas) vanilla JS + PWA | Firebase (Firestore blob JSON + Functions + push) |

Las tres son del mismo grupo empresario y **duplican** las mismas entidades base
(usuarios, empleados, empresas, sectores), hoy desconectadas entre sí.

## Decisiones tomadas

1. **Estrategia:** unificación real desde cero (una sola base de datos, un solo sistema).
2. **Stack destino:** Next.js 16 (App Router) + Supabase (Postgres + Auth + Storage +
   Realtime + RLS). Deploy en Vercel. Es el stack que ya usa Mantenimiento.
3. **Estructura de módulos:** RRHH y Mantenimiento como módulos de primer nivel;
   **Remises como submódulo dentro de RRHH** (gestiona transporte de empleados).
   Un módulo de Administración expone el núcleo compartido.

## Arquitectura general

Monolito modular en Next.js 16 sobre Supabase. Una base Postgres, un login, permisos
por rol con RLS.

Mapa de navegación:

```
SdG (Polcecal / Polysan)
│
├── Inicio (dashboard global según rol)
│
├── RRHH
│   ├── Empleados
│   ├── Asistencia (fichadas, cálculo diario, ausencias)
│   ├── Vacaciones y francos
│   ├── Liquidaciones
│   └── Remises  ← submódulo (transporte de empleados)
│         ├── Vehículos y choferes
│         ├── Turnos y rutas
│         └── Hojas de ruta
│
├── Mantenimiento  ← módulo aparte
│   ├── Equipos / Plantas
│   ├── Mantenimientos programados
│   ├── Ejecuciones y checklists
│   ├── Órdenes de trabajo
│   └── Planificación diaria
│
└── Administración (núcleo compartido)
      ├── Usuarios y roles
      ├── Empresas (Polcecal / Polysan)
      └── Sectores / Plantas
```

**Idea central:** el núcleo compartido (`usuarios`, `empleados`, `empresas`,
`sectores`) vive una sola vez y lo consumen los tres dominios. Un empleado de RRHH es
el mismo que se asigna a un remis; un sector de RRHH es la misma planta de
Mantenimiento.

**Capas por módulo:** cada módulo tiene sus tablas, su carpeta de rutas en
`app/(app)/<modulo>/` y sus componentes aislados. Comparten núcleo, layout, auth y
helpers de Supabase.

## Modelo de datos

### Núcleo compartido

| Tabla | Unifica | Reconciliación |
|-------|---------|----------------|
| `empresas` | RRHH `Empresa` + Mant. `plants` | POLCECAL / POLYSAN. El `AMBOS` de Mantenimiento pasa a ser un flag, no una empresa. |
| `sectores` | RRHH `Sector` + Mant. `sectors` | Cada sector pertenece a una empresa (modelo de Mantenimiento). El "sector transversal" de RRHH se resuelve permitiendo el mismo nombre en ambas empresas. |
| `usuarios` | RRHH `User` + Mant. `app_users` + admin de Remises | Extiende `auth.users` de Supabase. Un solo login para todo el SdG. |
| `empleados` | RRHH `Employee` + Remises `employees` | Ficha rica de RRHH (legajo, empresa, sector, valor hora, ingreso). Remises agrega datos de transporte (domicilio/parada, turno). |

**Distinción `usuarios` vs `empleados`:** `usuarios` = personas que inician sesión
(admins, encargados, técnicos). `empleados` = fuerza laboral gestionada (operarios que
se fichan y se transportan). Un empleado normalmente **no** tiene login; un usuario
puede enlazarse opcionalmente a su ficha de empleado.

### Roles y permisos

Hoy hay tres vocabularios distintos (RRHH `ADMIN/ENCARGADO`; Mant.
`gerente/administrador/operario/admin_sistema`; Remises admin por org). Se unifican:

- **Rol global** por usuario: `admin_sistema`, `admin`, `encargado`, `operario`.
- Tabla `usuario_modulos`: define a qué módulos accede cada usuario (RRHH,
  Mantenimiento, Remises) y con qué nivel. Permite combinaciones (p. ej. encargado solo
  de Mantenimiento, o RRHH + Remises) sin inventar roles nuevos.
- Todo aplicado con **RLS de Supabase**.

### Tablas por dominio (cuelgan del núcleo)

- **RRHH:** `fichadas`, `calculos_diarios`, `ausencias`, `vacaciones`, `francos`,
  `liquidaciones`, `jornadas`, `feriados`, `config_liquidacion`.
- **Mantenimiento:** `equipos`, `checklists`, `mantenimientos_programados`,
  `ejecuciones`, `ordenes_trabajo`, `planificacion_diaria`, logs de estado.
- **Remises:** `vehiculos`, `choferes`, `turnos`, `rutas`, `hojas_ruta` — reemplazando
  el blob JSON de Firestore por tablas reales que referencian `empleados`.

## Estrategia de migración por fases

Cada fase es un ciclo completo (spec → plan → implementación) que deja algo andando y
probado. El orden va de menor a mayor riesgo para validar la plataforma temprano.

### Fase 0 — Fundación (núcleo + shell)
Scaffold Next.js 16 + Supabase en `SdG PP`. Login único, esquema del núcleo
(`empresas`, `sectores`, `usuarios`, `empleados`, `usuario_modulos`) con RLS, y shell de
navegación con guardas por rol. Seed de Polcecal/Polysan, sectores y usuarios base.
**Resultado:** se entra al SdG y se ve el menú de módulos (vacíos) según rol.

### Fase 1 — Adoptar Mantenimiento
Es el de menor costo (ya es Next+Supabase). Portar sus páginas a
`app/(app)/mantenimiento/` y reapuntar sus tablas al núcleo (`plants`→`empresas`,
`sectors`→`sectores`, `app_users`→`usuarios`).
**Resultado:** un módulo completo funcionando; valida shell y núcleo.

### Fase 2 — Migrar RRHH
Portar el frontend Vite→Next a `app/(app)/rrhh/` y mover el motor de cálculo (horas
extra, francos, vacaciones, liquidaciones) de Express/Prisma a Supabase, conservando sus
tests. Migración de esquema y datos.
**Resultado:** asistencia y liquidaciones vivas sobre el núcleo unificado.

### Fase 3 — Reescribir Remises (submódulo de RRHH)
La más grande: pasar del archivo único + Firebase a tablas reales (`vehiculos`,
`choferes`, `turnos`, `rutas`, `hojas_ruta`) que referencian `empleados`. Rehacer la UI
en componentes (hojas de ruta, asignación por turno, geocoding, export PDF) y las
notificaciones push diarias (Firebase Functions → Supabase Edge Functions o cron de
Vercel). Migrar datos desde Firestore.
**Resultado:** los tres dominios unificados sobre una sola base.

### Fase 4 — Corte y pulido (opcional)
Dashboard global, apagado de las tres apps viejas, dominio propio.

## Alcance de este spec

Este documento cubre el **diseño global del SdG** y la **descomposición en fases**. La
implementación arranca por la **Fase 0**, que tendrá su plan detallado (skill
`writing-plans`). Las fases 1–4 tendrán su propio spec cuando se llegue a ellas.

## Fuera de alcance (por ahora)

- Migración de datos productivos de las apps viejas (se aborda dentro de cada fase de módulo).
- Apagado de las apps originales y configuración de dominio (Fase 4).
- Funcionalidad nueva no presente en las apps actuales.
