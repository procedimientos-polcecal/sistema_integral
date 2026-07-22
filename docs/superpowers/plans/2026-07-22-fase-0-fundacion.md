# Fase 0 — Fundación del SdG (núcleo + shell) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Levantar el esqueleto del SdG en Next.js 16 + Supabase con login único, el esquema del núcleo compartido (empresas, sectores, usuarios, empleados, usuario_modulos) protegido por RLS, y un shell de navegación que muestra los módulos según los permisos del usuario.

**Architecture:** Monolito modular Next.js (App Router) desplegable en Vercel. Postgres/Auth/RLS de Supabase. El núcleo de datos vive una sola vez y lo consumirán los módulos RRHH, Mantenimiento y Remises en fases posteriores. Esta fase NO trae ninguno de los tres dominios: deja la plataforma lista y validada.

**Tech Stack:** Next.js 16, React 19, TypeScript (strict), Tailwind CSS 4, `@supabase/ssr` + `@supabase/supabase-js`, Vitest para tests unitarios de lógica pura. Migraciones SQL en `supabase/migrations/`.

**Convenciones del repo:**
- Todo en la raíz: `app/`, `lib/`, `middleware.ts`, `supabase/`. Alias `@/*` → `./*`.
- Commits pequeños y frecuentes, en español, con `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- El repo ya está inicializado (git init hecho) con `docs/` commiteado.

**Prerrequisito externo (no bloquea escribir código, sí ejecutarlo):** un proyecto Supabase (nuevo o el de Mantenimiento). Se necesitan `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY`. Hasta tenerlos, las tareas de scaffold/SQL/tests se completan igual; solo las de "correr contra Supabase real" quedan pendientes de credenciales.

---

## Estructura de archivos (qué crea cada tarea)

```
SdG PP/
├── package.json                      # T1 — deps y scripts
├── tsconfig.json                     # T1
├── next.config.ts                    # T1 — headers de seguridad
├── postcss.config.mjs                # T1 — Tailwind 4
├── vitest.config.ts                  # T1
├── .env.example                      # T1
├── .env.local                        # T1 (no se commitea)
├── middleware.ts                     # T3 — refresco de sesión + guardas públicas
├── app/
│   ├── layout.tsx                    # T1 — root layout
│   ├── globals.css                   # T1 — Tailwind
│   ├── login/page.tsx                # T6 — login
│   ├── login/actions.ts              # T6 — server action de login/logout
│   └── (app)/
│       ├── layout.tsx                # T7 — shell con sidebar + guarda de sesión
│       ├── page.tsx                  # T7 — dashboard (inicio)
│       └── administracion/
│           ├── page.tsx              # T8 — índice de administración
│           ├── usuarios/page.tsx     # T8 — lista de usuarios + módulos
│           └── empresas/page.tsx     # T8 — empresas y sectores (lectura)
├── lib/
│   ├── supabase/client.ts            # T2 — cliente browser
│   ├── supabase/server.ts            # T2 — cliente server
│   ├── supabase/middleware.ts        # T2 — updateSession
│   ├── supabase/admin.ts             # T2 — cliente service-role
│   └── core/
│       ├── access.ts                 # T5 — resolver de módulos visibles (lógica pura)
│       ├── access.test.ts            # T5 — tests del resolver
│       ├── nav.ts                    # T7 — definición del árbol de navegación
│       └── types.ts                  # T4 — tipos del núcleo
├── components/
│   └── Sidebar.tsx                   # T7 — navegación lateral
└── supabase/
    └── migrations/
        ├── 001_nucleo_schema.sql     # T4 — enums + tablas del núcleo
        ├── 002_nucleo_rls.sql        # T4 — funciones helper + policies RLS
        └── 003_seed_nucleo.sql       # T5 — empresas + sectores base
```

---

### Task 1: Scaffold del proyecto Next.js + configuración

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `vitest.config.ts`, `.env.example`, `app/layout.tsx`, `app/globals.css`, `.gitignore` (ya existe, verificar)

- [ ] **Step 1: Crear `package.json`**

```json
{
  "name": "sdg",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@supabase/ssr": "^0.7.0",
    "@supabase/supabase-js": "^2.108.2",
    "next": "16.2.9",
    "react": "19.2.4",
    "react-dom": "19.2.4"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4",
    "@types/node": "^20",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "eslint": "^9",
    "eslint-config-next": "16.2.9",
    "tailwindcss": "^4",
    "typescript": "^5",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Instalar dependencias**

Run: `npm install`
Expected: crea `node_modules/` y `package-lock.json` sin errores de resolución.

- [ ] **Step 3: Crear `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Crear `next.config.ts`** (mismos headers de seguridad que Mantenimiento)

```ts
import type { NextConfig } from "next";

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
```

- [ ] **Step 5: Crear `postcss.config.mjs`**

```js
const config = {
  plugins: ["@tailwindcss/postcss"],
};
export default config;
```

- [ ] **Step 6: Crear `app/globals.css`**

```css
@import "tailwindcss";

:root {
  --background: #f9fafb;
  --foreground: #0a0f1c;
}

html, body {
  height: 100%;
}
body {
  background: var(--background);
  color: var(--foreground);
}
```

- [ ] **Step 7: Crear `app/layout.tsx`**

```tsx
import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SdG — Polcecal / Polysan",
  description: "Sistema de Gestión unificado: RRHH, Mantenimiento y Remises",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0A0F1C",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-full bg-gray-50">{children}</body>
    </html>
  );
}
```

- [ ] **Step 8: Crear `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
  },
});
```

- [ ] **Step 9: Crear `.env.example`**

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

- [ ] **Step 10: Verificar `.gitignore`** contiene `node_modules/`, `.next/`, `.env*`, `.vercel/`. (Ya fue creado en el commit de docs; agregar lo que falte.)

- [ ] **Step 11: Verificar el build de tipos**

Run: `npx tsc --noEmit`
Expected: sin errores (aún no hay código de app más allá del layout).

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js 16 + Tailwind 4 + Vitest para el SdG"
```

---

### Task 2: Helpers de Supabase (client / server / admin / middleware)

**Files:**
- Create: `lib/supabase/client.ts`, `lib/supabase/server.ts`, `lib/supabase/admin.ts`, `lib/supabase/middleware.ts`

- [ ] **Step 1: Crear `lib/supabase/client.ts`** (cliente para componentes de navegador)

```ts
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

- [ ] **Step 2: Crear `lib/supabase/server.ts`** (cliente para Server Components / actions)

```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Component — las cookies las setea el middleware
          }
        },
      },
    }
  );
}
```

- [ ] **Step 3: Crear `lib/supabase/admin.ts`** (cliente service-role, solo servidor — para seeds/gestión de usuarios)

```ts
import { createClient } from "@supabase/supabase-js";

// NUNCA importar esto en código de cliente. Usa la service-role key.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
```

- [ ] **Step 4: Crear `lib/supabase/middleware.ts`** (refresco de sesión + rutas públicas)

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublicPath =
    path === "/login" || path.startsWith("/reset-password") || path.startsWith("/auth");

  if (!user && !isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && path === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
```

- [ ] **Step 5: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add lib/supabase
git commit -m "feat: helpers de Supabase (client, server, admin, middleware)"
```

---

### Task 3: Middleware raíz

**Files:**
- Create: `middleware.ts`

- [ ] **Step 1: Crear `middleware.ts`**

```ts
import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
```

- [ ] **Step 2: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add middleware.ts
git commit -m "feat: middleware de sesión en la raíz"
```

---

### Task 4: Esquema del núcleo (migración SQL) + tipos TS

**Files:**
- Create: `supabase/migrations/001_nucleo_schema.sql`, `supabase/migrations/002_nucleo_rls.sql`, `lib/core/types.ts`

- [ ] **Step 1: Crear `supabase/migrations/001_nucleo_schema.sql`**

```sql
-- ============================================================
-- SdG — Núcleo compartido
-- Entidades base consumidas por RRHH, Mantenimiento y Remises.
-- ============================================================

create extension if not exists "pgcrypto";

-- Rol global del usuario dentro del SdG.
create type user_role as enum ('admin_sistema', 'admin', 'encargado', 'operario');

-- Módulos del sistema.
create type modulo as enum ('rrhh', 'mantenimiento', 'remises');

-- Nivel de acceso de un usuario a un módulo.
create type nivel_acceso as enum ('lectura', 'edicion', 'admin');

-- Empresas del grupo. El "AMBOS" de Mantenimiento NO es una empresa.
create table empresas (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null unique check (nombre in ('POLCECAL', 'POLYSAN')),
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);

-- Sectores. Cada sector pertenece a una empresa (modelo de Mantenimiento).
-- El "sector transversal" de RRHH se resuelve repitiendo el nombre por empresa.
create table sectores (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id) on delete restrict,
  nombre     text not null,
  activo     boolean not null default true,
  created_at timestamptz not null default now(),
  unique (empresa_id, nombre)
);

-- Usuarios que inician sesión. Extiende auth.users de Supabase.
create table usuarios (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null unique,
  nombre     text not null,
  apellido   text not null default '',
  rol        user_role not null default 'operario',
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);

-- Qué módulos puede ver/editar cada usuario.
create table usuario_modulos (
  id         uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references usuarios(id) on delete cascade,
  modulo     modulo not null,
  nivel      nivel_acceso not null default 'lectura',
  unique (usuario_id, modulo)
);

-- Fuerza laboral gestionada. NO inicia sesión (salvo enlace opcional futuro).
-- Reúne la ficha rica de RRHH + datos de transporte de Remises.
create table empleados (
  id                     uuid primary key default gen_random_uuid(),
  legajo                 text not null unique,
  nombre                 text not null,
  apellido               text not null,
  empresa_id             uuid not null references empresas(id) on delete restrict,
  sector_id              uuid references sectores(id) on delete set null,
  fecha_ingreso          date not null,
  valor_hora_normal      numeric(12,2) not null default 0,
  horas_teoricas_diarias numeric(5,2) not null default 8,
  -- Datos de transporte (usados por Remises)
  domicilio              text,
  activo                 boolean not null default true,
  created_at             timestamptz not null default now()
);

create index empleados_empresa_idx on empleados (empresa_id);
create index empleados_sector_idx on empleados (sector_id);
```

- [ ] **Step 2: Crear `supabase/migrations/002_nucleo_rls.sql`** (helpers SECURITY DEFINER para evitar recursión + policies)

```sql
-- ============================================================
-- SdG — RLS del núcleo
-- ============================================================

-- Rol del usuario actual (bypassa RLS vía security definer).
create or replace function public.rol_actual()
returns user_role
language sql stable security definer set search_path = public
as $$ select rol from usuarios where id = auth.uid() $$;

-- ¿El usuario actual es admin del sistema o admin general?
create or replace function public.es_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select rol in ('admin_sistema', 'admin') from usuarios where id = auth.uid()),
    false
  )
$$;

alter table empresas        enable row level security;
alter table sectores        enable row level security;
alter table usuarios        enable row level security;
alter table usuario_modulos enable row level security;
alter table empleados       enable row level security;

-- empresas: cualquier usuario autenticado lee; solo admin escribe.
create policy empresas_select on empresas for select to authenticated using (true);
create policy empresas_write  on empresas for all    to authenticated using (es_admin()) with check (es_admin());

-- sectores: igual.
create policy sectores_select on sectores for select to authenticated using (true);
create policy sectores_write  on sectores for all    to authenticated using (es_admin()) with check (es_admin());

-- usuarios: cada uno se ve a sí mismo; admin ve/escribe todos.
create policy usuarios_select_self  on usuarios for select to authenticated using (id = auth.uid() or es_admin());
create policy usuarios_write_admin  on usuarios for all    to authenticated using (es_admin()) with check (es_admin());

-- usuario_modulos: el usuario ve sus grants; admin gestiona todos.
create policy um_select on usuario_modulos for select to authenticated using (usuario_id = auth.uid() or es_admin());
create policy um_write  on usuario_modulos for all    to authenticated using (es_admin()) with check (es_admin());

-- empleados: autenticado lee; solo admin escribe (los módulos afinarán esto luego).
create policy empleados_select on empleados for select to authenticated using (true);
create policy empleados_write  on empleados for all    to authenticated using (es_admin()) with check (es_admin());
```

- [ ] **Step 3: Crear `lib/core/types.ts`** (espejo TS del esquema, fuente de verdad para el frontend)

```ts
export type Rol = "admin_sistema" | "admin" | "encargado" | "operario";
export type Modulo = "rrhh" | "mantenimiento" | "remises";
export type NivelAcceso = "lectura" | "edicion" | "admin";

export interface Empresa {
  id: string;
  nombre: "POLCECAL" | "POLYSAN";
  activo: boolean;
}

export interface Sector {
  id: string;
  empresa_id: string;
  nombre: string;
  activo: boolean;
}

export interface Usuario {
  id: string;
  email: string;
  nombre: string;
  apellido: string;
  rol: Rol;
  activo: boolean;
}

export interface UsuarioModulo {
  id: string;
  usuario_id: string;
  modulo: Modulo;
  nivel: NivelAcceso;
}
```

- [ ] **Step 4: Aplicar las migraciones al proyecto Supabase**

Run (con las credenciales cargadas): pegar el contenido de `001` y `002` en el **SQL Editor** de Supabase y ejecutar, o `supabase db push` si se usa la CLI.
Expected: las tablas `empresas`, `sectores`, `usuarios`, `usuario_modulos`, `empleados` existen y tienen RLS habilitado (verificable en Table Editor → cada tabla muestra "RLS enabled").
*(Si aún no hay credenciales: marcar como pendiente y continuar; las migraciones quedan versionadas.)*

- [ ] **Step 5: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations lib/core/types.ts
git commit -m "feat: esquema y RLS del núcleo compartido + tipos TS"
```

---

### Task 5: Resolver de módulos visibles (lógica pura, TDD) + seed

**Files:**
- Create: `lib/core/access.ts`, `lib/core/access.test.ts`, `supabase/migrations/003_seed_nucleo.sql`

- [ ] **Step 1: Escribir el test que falla — `lib/core/access.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { modulosVisibles } from "./access";
import type { UsuarioModulo } from "./types";

const grant = (modulo: UsuarioModulo["modulo"]): UsuarioModulo => ({
  id: "x",
  usuario_id: "u",
  modulo,
  nivel: "lectura",
});

describe("modulosVisibles", () => {
  it("admin_sistema ve todos los módulos sin importar los grants", () => {
    expect(modulosVisibles("admin_sistema", [])).toEqual([
      "rrhh",
      "mantenimiento",
      "remises",
    ]);
  });

  it("un rol no-admin ve solo los módulos concedidos, en orden canónico", () => {
    const grants = [grant("remises"), grant("rrhh")];
    expect(modulosVisibles("operario", grants)).toEqual(["rrhh", "remises"]);
  });

  it("sin grants y sin ser admin_sistema, no ve ningún módulo", () => {
    expect(modulosVisibles("encargado", [])).toEqual([]);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `npm test`
Expected: FAIL — "Cannot find module './access'" o "modulosVisibles is not a function".

- [ ] **Step 3: Implementar `lib/core/access.ts`**

```ts
import type { Modulo, Rol, UsuarioModulo } from "./types";

// Orden canónico en que se muestran los módulos en la navegación.
export const MODULOS_ORDEN: Modulo[] = ["rrhh", "mantenimiento", "remises"];

/**
 * Devuelve los módulos que un usuario puede ver, en orden canónico.
 * admin_sistema ve todo; el resto ve solo lo que tenga concedido en usuario_modulos.
 */
export function modulosVisibles(rol: Rol, grants: UsuarioModulo[]): Modulo[] {
  if (rol === "admin_sistema") return [...MODULOS_ORDEN];
  const concedidos = new Set(grants.map((g) => g.modulo));
  return MODULOS_ORDEN.filter((m) => concedidos.has(m));
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `npm test`
Expected: PASS — 3 tests verdes.

- [ ] **Step 5: Crear `supabase/migrations/003_seed_nucleo.sql`** (empresas + sectores base)

```sql
-- ============================================================
-- SdG — Seed del núcleo (empresas y sectores base)
-- Idempotente: se puede correr varias veces sin duplicar.
-- ============================================================

insert into empresas (nombre) values ('POLCECAL'), ('POLYSAN')
on conflict (nombre) do nothing;

-- Sectores base por empresa (ajustar a la realidad del grupo).
insert into sectores (empresa_id, nombre)
select e.id, s.nombre
from empresas e
cross join (values ('Calidad'), ('Producción'), ('Mantenimiento'), ('Administración')) as s(nombre)
on conflict (empresa_id, nombre) do nothing;
```

- [ ] **Step 6: Aplicar el seed** (con credenciales)

Run: ejecutar `003_seed_nucleo.sql` en el SQL Editor de Supabase.
Expected: `select nombre from empresas;` devuelve POLCECAL y POLYSAN; `select count(*) from sectores;` devuelve 8.
*(Pendiente si no hay credenciales.)*

- [ ] **Step 7: Commit**

```bash
git add lib/core/access.ts lib/core/access.test.ts supabase/migrations/003_seed_nucleo.sql
git commit -m "feat: resolver de módulos visibles (TDD) + seed del núcleo"
```

---

### Task 6: Login y logout

**Files:**
- Create: `app/login/page.tsx`, `app/login/actions.ts`

- [ ] **Step 1: Crear `app/login/actions.ts`** (server actions de sesión)

```ts
"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect("/login?error=" + encodeURIComponent("Email o contraseña incorrectos"));
  }
  redirect("/");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
```

- [ ] **Step 2: Crear `app/login/page.tsx`**

```tsx
import { login } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form
        action={login}
        className="w-full max-w-sm space-y-4 rounded-xl bg-white p-8 shadow"
      >
        <h1 className="text-xl font-bold text-gray-900">SdG — Polcecal / Polysan</h1>
        <p className="text-sm text-gray-500">Ingresá con tu cuenta.</p>

        {error && (
          <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        <div className="space-y-1">
          <label htmlFor="email" className="text-sm font-medium text-gray-700">Email</label>
          <input
            id="email" name="email" type="email" required
            className="w-full rounded border border-gray-300 px-3 py-2"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="password" className="text-sm font-medium text-gray-700">Contraseña</label>
          <input
            id="password" name="password" type="password" required
            className="w-full rounded border border-gray-300 px-3 py-2"
          />
        </div>

        <button
          type="submit"
          className="w-full rounded bg-gray-900 px-4 py-2 font-medium text-white hover:bg-gray-800"
        >
          Ingresar
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 3: Crear el primer usuario admin** (con credenciales)

Run: en Supabase → Authentication → Users → "Add user" con email/contraseña. Luego en SQL Editor:

```sql
insert into usuarios (id, email, nombre, apellido, rol)
values ('<AUTH_USER_ID>', '<email>', 'Admin', 'SdG', 'admin_sistema')
on conflict (id) do update set rol = excluded.rol;
```

Expected: `select rol from usuarios where email = '<email>';` devuelve `admin_sistema`.
*(Pendiente si no hay credenciales.)*

- [ ] **Step 4: Verificar tipos y build**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add app/login
git commit -m "feat: pantalla de login y acciones de sesión"
```

---

### Task 7: Shell de la aplicación (sidebar según permisos + dashboard)

**Files:**
- Create: `lib/core/nav.ts`, `components/Sidebar.tsx`, `app/(app)/layout.tsx`, `app/(app)/page.tsx`

- [ ] **Step 1: Crear `lib/core/nav.ts`** (árbol de navegación; Remises anidado bajo RRHH)

```ts
import type { Modulo } from "./types";

export interface NavItem {
  label: string;
  href: string;
  // Módulo requerido para ver el item (undefined = siempre visible si hay sesión).
  modulo?: Modulo;
  children?: NavItem[];
}

// Estructura de navegación del SdG. La visibilidad real se filtra por permisos.
export const NAV: NavItem[] = [
  { label: "Inicio", href: "/" },
  {
    label: "RRHH",
    href: "/rrhh",
    modulo: "rrhh",
    children: [
      { label: "Empleados", href: "/rrhh/empleados", modulo: "rrhh" },
      { label: "Asistencia", href: "/rrhh/asistencia", modulo: "rrhh" },
      { label: "Liquidaciones", href: "/rrhh/liquidaciones", modulo: "rrhh" },
      { label: "Remises", href: "/rrhh/remises", modulo: "remises" },
    ],
  },
  {
    label: "Mantenimiento",
    href: "/mantenimiento",
    modulo: "mantenimiento",
  },
  {
    label: "Administración",
    href: "/administracion",
    // Solo admins; se filtra en el layout, no por módulo.
  },
];
```

- [ ] **Step 2: Crear `components/Sidebar.tsx`** (recibe módulos visibles y rol ya resueltos)

```tsx
import Link from "next/link";
import { NAV, type NavItem } from "@/lib/core/nav";
import type { Modulo, Rol } from "@/lib/core/types";
import { logout } from "@/app/login/actions";

function visible(item: NavItem, modulos: Set<Modulo>, esAdmin: boolean): boolean {
  if (item.href === "/administracion") return esAdmin;
  if (!item.modulo) return true;
  return modulos.has(item.modulo);
}

export function Sidebar({
  modulos,
  rol,
  usuarioNombre,
}: {
  modulos: Modulo[];
  rol: Rol;
  usuarioNombre: string;
}) {
  const set = new Set(modulos);
  const esAdmin = rol === "admin_sistema" || rol === "admin";

  return (
    <aside className="flex w-64 flex-col bg-[#0A0F1C] text-gray-200">
      <div className="px-5 py-4 text-lg font-bold text-white">SdG</div>
      <nav className="flex-1 space-y-1 px-3">
        {NAV.filter((i) => visible(i, set, esAdmin)).map((item) => (
          <div key={item.href}>
            <Link
              href={item.href}
              className="block rounded px-3 py-2 text-sm hover:bg-white/10"
            >
              {item.label}
            </Link>
            {item.children && (
              <div className="ml-3 space-y-1">
                {item.children
                  .filter((c) => visible(c, set, esAdmin))
                  .map((c) => (
                    <Link
                      key={c.href}
                      href={c.href}
                      className="block rounded px-3 py-1.5 text-sm text-gray-400 hover:bg-white/10 hover:text-gray-200"
                    >
                      {c.label}
                    </Link>
                  ))}
              </div>
            )}
          </div>
        ))}
      </nav>
      <div className="border-t border-white/10 px-5 py-4 text-sm">
        <div className="truncate text-gray-300">{usuarioNombre}</div>
        <form action={logout}>
          <button className="mt-2 text-xs text-gray-400 hover:text-white">
            Cerrar sesión
          </button>
        </form>
      </div>
    </aside>
  );
}
```

- [ ] **Step 3: Crear `app/(app)/layout.tsx`** (guarda de sesión + carga de permisos + shell)

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/Sidebar";
import { modulosVisibles } from "@/lib/core/access";
import type { Rol, UsuarioModulo } from "@/lib/core/types";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("nombre, apellido, rol")
    .eq("id", user.id)
    .single();

  // Usuario autenticado en Supabase pero sin fila en `usuarios`: sin acceso.
  if (!usuario) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6 text-center">
        <div>
          <p className="text-lg font-semibold">Tu cuenta todavía no fue habilitada.</p>
          <p className="text-sm text-gray-500">Pedile a un administrador que te dé acceso.</p>
        </div>
      </main>
    );
  }

  const { data: grants } = await supabase
    .from("usuario_modulos")
    .select("id, usuario_id, modulo, nivel")
    .eq("usuario_id", user.id);

  const rol = usuario.rol as Rol;
  const modulos = modulosVisibles(rol, (grants ?? []) as UsuarioModulo[]);

  return (
    <div className="flex min-h-screen">
      <Sidebar
        modulos={modulos}
        rol={rol}
        usuarioNombre={`${usuario.nombre} ${usuario.apellido}`.trim()}
      />
      <main className="flex-1 overflow-auto p-6">{children}</main>
    </div>
  );
}
```

- [ ] **Step 4: Crear `app/(app)/page.tsx`** (dashboard de inicio)

```tsx
export default function InicioPage() {
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-bold text-gray-900">Bienvenido al SdG</h1>
      <p className="text-gray-600">
        Usá el menú de la izquierda para entrar a los módulos habilitados para tu cuenta.
      </p>
    </div>
  );
}
```

- [ ] **Step 5: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 6: Verificar el flujo completo en el navegador** (con credenciales y seed aplicados)

Run: `npm run dev` y abrir `http://localhost:3000`.
Expected: sin sesión redirige a `/login`; al ingresar con el admin del sistema se ve el dashboard y el sidebar con RRHH, Mantenimiento, Administración (y Remises bajo RRHH). Cerrar sesión vuelve a `/login`.
*(Pendiente si no hay credenciales.)*

- [ ] **Step 7: Commit**

```bash
git add lib/core/nav.ts components/Sidebar.tsx "app/(app)"
git commit -m "feat: shell del SdG con navegación por permisos y dashboard"
```

---

### Task 8: Administración del núcleo (lectura)

**Files:**
- Create: `app/(app)/administracion/page.tsx`, `app/(app)/administracion/usuarios/page.tsx`, `app/(app)/administracion/empresas/page.tsx`

Alcance de Fase 0: pantallas de **lectura** que prueban que el núcleo funciona de punta a punta (Supabase → RLS → UI). El alta/edición de usuarios y la asignación de módulos se abordan como primera mejora tras validar la fundación (se puede hacer por SQL/Supabase mientras tanto).

- [ ] **Step 1: Crear `app/(app)/administracion/page.tsx`**

```tsx
import Link from "next/link";

export default function AdministracionPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Administración</h1>
      <ul className="space-y-2">
        <li>
          <Link className="text-blue-700 hover:underline" href="/administracion/usuarios">
            Usuarios y permisos
          </Link>
        </li>
        <li>
          <Link className="text-blue-700 hover:underline" href="/administracion/empresas">
            Empresas y sectores
          </Link>
        </li>
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Crear `app/(app)/administracion/usuarios/page.tsx`**

```tsx
import { createClient } from "@/lib/supabase/server";

export default async function UsuariosPage() {
  const supabase = await createClient();
  const { data: usuarios } = await supabase
    .from("usuarios")
    .select("id, email, nombre, apellido, rol, activo")
    .order("email");

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Usuarios</h1>
      <table className="w-full text-left text-sm">
        <thead className="border-b text-gray-500">
          <tr>
            <th className="py-2">Email</th>
            <th className="py-2">Nombre</th>
            <th className="py-2">Rol</th>
            <th className="py-2">Activo</th>
          </tr>
        </thead>
        <tbody>
          {(usuarios ?? []).map((u) => (
            <tr key={u.id} className="border-b">
              <td className="py-2">{u.email}</td>
              <td className="py-2">{u.nombre} {u.apellido}</td>
              <td className="py-2">{u.rol}</td>
              <td className="py-2">{u.activo ? "Sí" : "No"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: Crear `app/(app)/administracion/empresas/page.tsx`**

```tsx
import { createClient } from "@/lib/supabase/server";

export default async function EmpresasPage() {
  const supabase = await createClient();
  const { data: empresas } = await supabase
    .from("empresas")
    .select("id, nombre, sectores(nombre)")
    .order("nombre");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Empresas y sectores</h1>
      {(empresas ?? []).map((e) => (
        <div key={e.id}>
          <h2 className="font-semibold text-gray-800">{e.nombre}</h2>
          <ul className="ml-4 list-disc text-sm text-gray-600">
            {((e.sectores ?? []) as { nombre: string }[]).map((s) => (
              <li key={s.nombre}>{s.nombre}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 5: Verificar en el navegador** (con credenciales)

Run: `npm run dev`, entrar como admin, ir a Administración → Usuarios y → Empresas.
Expected: Usuarios lista al admin creado; Empresas muestra POLCECAL y POLYSAN con sus 4 sectores.
*(Pendiente si no hay credenciales.)*

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/administracion"
git commit -m "feat: administración del núcleo (usuarios y empresas, lectura)"
```

---

## Verificación final de la Fase 0

Con credenciales de Supabase y migraciones/seed aplicados:

1. `npm test` → verde (resolver de módulos).
2. `npx tsc --noEmit` → sin errores.
3. `npm run build` → build exitoso.
4. Flujo manual: login → dashboard → sidebar filtra por permisos → Administración muestra el núcleo → logout.

**Definición de "hecho" para Fase 0:** un usuario puede entrar al SdG, ve solo los módulos que su rol/permisos habilitan (con Remises anidado bajo RRHH), y el núcleo compartido (empresas, sectores, usuarios, permisos) está poblado, protegido por RLS y visible desde la UI. Los módulos en sí (RRHH, Mantenimiento, Remises) llegan en las fases 1–3.

## Notas para las fases siguientes

- **Fase 1 (Mantenimiento):** reapuntar `plants`→`empresas`, `sectors`→`sectores`, `app_users`→`usuarios`. Revisar que el enum de rol de Mantenimiento (`gerente/administrador/operario/admin_sistema`) mapee al `user_role` unificado.
- **Fase 2 (RRHH):** el motor de cálculo (`calculo.ts`, `recalcular.ts`, `vacaciones.ts`) y sus tests se portan a `lib/rrhh/` o a funciones de Postgres; `Employee` ya está cubierto por `empleados`.
- **Fase 3 (Remises):** modelar `vehiculos`, `choferes`, `turnos`, `rutas`, `hojas_ruta` referenciando `empleados`; migrar el blob JSON de Firestore; reimplementar el push diario (cron de Vercel o Edge Function de Supabase).
