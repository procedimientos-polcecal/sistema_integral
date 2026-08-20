# Variables de entorno

Lista sacada del código (todos los `process.env` de `app/`, `lib/`, `components/`
y `middleware.ts`), no de memoria.

En Vercel van en **Settings → Environment Variables**, marcadas para los tres
entornos: *Production*, *Preview* y *Development*.

> Después de agregarlas hay que **volver a desplegar**: Vercel no las inyecta en
> un deploy que ya está hecho.

## Imprescindibles

Sin estas la app no arranca o rompe al entrar.

| Variable | Para qué | De dónde sale |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Dirección de la base | Supabase → **Project Settings → Data API → Project URL**. Es `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Login y consultas del navegador, siempre limitadas por RLS | Supabase → **Project Settings → API Keys → `anon` / `publishable`** |
| `SUPABASE_SERVICE_ROLE_KEY` | Rutas de administración, alta de usuarios, importador y sincronización | Supabase → **Project Settings → API Keys → `service_role` / `secret`** |
| `NEXT_PUBLIC_APP_URL` | Base de los links de los correos | La URL del deploy, sin barra final: `https://tu-app.vercel.app` |

Las dos primeras empiezan con `NEXT_PUBLIC_` y **viajan al navegador**: son
públicas por diseño y no hay problema en que se vean.

`SUPABASE_SERVICE_ROLE_KEY` es lo contrario: **saltea todas las políticas RLS**.
Nunca va en una variable `NEXT_PUBLIC_`, nunca en el repositorio, y si alguna vez
se filtra hay que rotarla desde el panel de Supabase.

## Necesarias para que funcionen los automatismos

Sin estas la app anda, pero el endpoint correspondiente responde 503 a propósito
—prefiere no correr antes que quedar abierto—.

| Variable | Para qué | De dónde sale |
|---|---|---|
| `CRON_SECRET` | Protege los crons (`/api/cron/*`). Vercel lo manda solo en el header al invocarlos | Lo inventás vos. Ver más abajo |
| `SHEETS_WEBHOOK_SECRET` | Protege el webhook que dispara el Apps Script de la planilla | Lo inventás vos. El mismo valor va en las propiedades del script |

## Sincronización con la planilla (módulo Compras)

Si faltan, la sincronización no corre y **no es un error**: la app sigue
funcionando y se puede importar a mano.

| Variable | Para qué | De dónde sale |
|---|---|---|
| `GOOGLE_SHEETS_COMPRAS_ID` | Qué planilla sincronizar | El tramo entre `/d/` y `/edit` de la URL. Para PEDIDOS DE COMPRA es `1hnfYHaWBprT9UGOETSoQ9GQCl3B1ZezPr5FPbCrUO80` |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Credencial para leer y escribir la planilla | Google Cloud Console → **IAM y administración → Cuentas de servicio** → crear una → **Claves → Agregar clave → JSON**. Se pega el archivo entero, en una sola línea |

Además hay que **compartir la planilla con el `client_email` de esa cuenta de
servicio, como Editor** — no como lector: la app escribe de vuelta el estado de
las compras.

## Notificaciones push (módulo Remises)

| Variable | Para qué | De dónde sale |
|---|---|---|
| `NEXT_PUBLIC_WEBPUSH_VAPID_PUBLIC_KEY` | Clave pública de Web Push | `npx web-push generate-vapid-keys` |
| `WEBPUSH_VAPID_PRIVATE_KEY` | Clave privada, del mismo comando | ídem |
| `WEBPUSH_CONTACT_EMAIL` | Contacto que exige el estándar VAPID | Un correo de la empresa, por ejemplo `soporte@polcecal.com` |

Las tres salen del mismo comando y **van juntas o no van**: si falta una,
`lib/remises/webpush.ts` tira `Faltan variables de entorno de Web Push (VAPID)`
al intentar notificar. Si Remises no usa push todavía, se pueden omitir las tres.

## Que NO va en Vercel

`DATABASE_URL` aparece en el código, pero sólo en
`scripts/migrate-apprrhh/*`, que fue una migración de una sola vez desde la base
vieja de APPRRHH. Se pasa por línea de comandos cuando se corre el script. En
Vercel no hace falta.

## Generar los secretos

```bash
node -e "console.log('CRON_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
```

```bash
node -e "console.log('SHEETS_WEBHOOK_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
```

```bash
npx web-push generate-vapid-keys
```

## Plantilla para pegar

Vercel permite pegar un `.env` entero en el diálogo de variables. Este es el
esqueleto, con los valores a completar:

```
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_APP_URL=https://tu-app.vercel.app
CRON_SECRET=
SHEETS_WEBHOOK_SECRET=
GOOGLE_SHEETS_COMPRAS_ID=1hnfYHaWBprT9UGOETSoQ9GQCl3B1ZezPr5FPbCrUO80
GOOGLE_SERVICE_ACCOUNT_JSON=
NEXT_PUBLIC_WEBPUSH_VAPID_PUBLIC_KEY=
WEBPUSH_VAPID_PRIVATE_KEY=
WEBPUSH_CONTACT_EMAIL=
```

`GOOGLE_SERVICE_ACCOUNT_JSON` es la única incómoda: el JSON va **entero y en una
sola línea**. Si al pegarlo se parte en varias, la app no lo va a poder leer.

## Después de desplegar

Cambiar de cuenta de Vercel cambia el dominio, y hay tres lugares que apuntan al
anterior:

1. **Supabase → Authentication → URL Configuration**: el *Site URL* nuevo y
   `https://NUEVO-DOMINIO/**` en *Redirect URLs*.
2. **Google Cloud Console → Credenciales → OAuth 2.0**: el dominio nuevo en
   *Orígenes de JavaScript autorizados*. El URI de redireccionamiento no se
   toca: sigue siendo el de Supabase.
3. **Apps Script de la planilla**: la propiedad `URL_APP` apuntando a
   `https://NUEVO-DOMINIO/api/compras/sheets/webhook`.

Si algo de esto queda con el dominio viejo: el login con Google falla y los
links de los correos llevan a la app anterior.
