# Autenticación

Cómo entra la gente al SdG, y qué revisar cuando algo falla.

## Cómo se entra

| Vía | Quién |
|---|---|
| Email + contraseña | Cualquier usuario dado de alta |
| Google | Sólo cuentas `@polcecal.com`, y sólo si ya están dadas de alta |

**No hay auto-registro.** Un administrador crea el usuario desde
`/administracion/usuarios`; la cuenta nace sin contraseña y la persona la define
con un link. Google sirve para entrar sin contraseña a una cuenta que ya existe,
no para crearla.

El control de dominio se hace en `app/auth/callback/route.ts`. El `hd` que manda
`GoogleSignInButton` es sólo una sugerencia visual de Google y se puede saltear,
así que la validación de verdad va del lado del servidor.

## Configuración obligatoria en Supabase

Sin estos tres pasos el login no funciona, por más que el código esté bien.

### 1. URL Configuration

**Authentication → URL Configuration**:

- *Site URL*: la URL real de la app. Si dice `http://localhost:3000` en
  producción, **todos** los links de correo llevan ahí.
- *Redirect URLs*: agregar una entrada por entorno:
  - `http://localhost:3000/**` (desarrollo)
  - `https://TU-DOMINIO/**` (producción)

Si el `redirectTo` que manda la app no está en esa lista, Supabase lo ignora en
silencio y usa el *Site URL*. Ese es el motivo de que el link caiga en `/` en
lugar de `/reset-password`.

### 2. Proveedor de Google

Son dos consolas: primero se crean las credenciales en Google, después se pegan
en Supabase. Sin esto el botón devuelve
`Unsupported provider: provider is not enabled`.

#### 2.1 Google Cloud Console

1. [console.cloud.google.com](https://console.cloud.google.com) → elegir o crear
   un proyecto (por ejemplo *SdG POLCECAL*).
2. **APIs y servicios → Pantalla de consentimiento de OAuth**.
   - Si `polcecal.com` es un dominio de Google Workspace, Google ofrece el tipo
     **Interno**: conviene, porque restringe el acceso a la organización sin
     pasar por el proceso de verificación de Google.
   - Si sólo aparece **Externo**, hay que completar los datos de la app y, para
     evitar la verificación, agregar a la gente en *Usuarios de prueba*. La
     restricción de dominio igual la hace la app en `/auth/callback`.
   - Permisos (*scopes*): alcanzan `email`, `profile` y `openid`.
3. **Credenciales → Crear credenciales → ID de cliente de OAuth**, tipo
   **Aplicación web**.
4. Completar:

   **Orígenes de JavaScript autorizados**
   ```
   http://localhost:3000
   https://TU-DOMINIO
   ```

   **URI de redireccionamiento autorizados**
   ```
   https://<TU-PROYECTO>.supabase.co/auth/v1/callback
   ```

   Acá va **el callback de Supabase, no el de la app**. Es el error más común:
   Google le responde a Supabase, y recién después Supabase redirige a
   `/auth/callback` del SdG. Si se pone la URL de la app, Google rechaza el
   intento con `redirect_uri_mismatch`.
5. Copiar el *Client ID* y el *Client Secret*.

#### 2.2 Supabase

**Authentication → Providers → Google**: activarlo, pegar las dos credenciales y
guardar. Los cambios tardan unos segundos en propagarse.

#### 2.3 Verificar

El endpoint de configuración dice qué proveedores quedaron activos. Necesita la
clave anónima; este comando la toma del `.env.local` para no depender de tener
nada exportado en la terminal:

```bash
curl -s -H "apikey: $(grep '^NEXT_PUBLIC_SUPABASE_ANON_KEY=' .env.local | cut -d= -f2-)" "https://<TU-PROYECTO>.supabase.co/auth/v1/settings"
```

Tiene que aparecer `"google": true`. Si sigue en `false`, no se guardó.

Si la respuesta es `{"message":"No API key found in request"}`, no es un problema
de configuración: la petición salió sin la clave, casi siempre porque la variable
estaba vacía en esa terminal.

### 2bis. Cerrar el registro abierto

**Authentication → Sign In / Providers → Email**, desactivar *Allow new users to
sign up*.

Todas las altas pasan por `/administracion/usuarios`, que usa la API de
administración y no se ve afectada. Con el registro abierto, en cambio,
cualquiera que tenga la clave anónima —que es pública por diseño— puede crear
una cuenta en `auth.users` contra la API de Supabase. No entraría al sistema,
porque le faltaría la fila en `usuarios`, pero no hay motivo para dejarlo.

### 3. SMTP propio

Ver la sección siguiente.

## El correo no llega

Es lo más habitual, y casi nunca es un problema del código.

**El SMTP por defecto de Supabase está pensado para pruebas**: manda unos pocos
mensajes por hora y puede limitar a qué direcciones. En cuanto se pasa del
límite, los envíos fallan en silencio.

La solución de fondo es configurar un SMTP propio en el dashboard de Supabase:
**Authentication → Emails → SMTP Settings**. Sirve cualquier proveedor (Resend,
SendGrid, SES). Ahí mismo conviene revisar **Rate Limits**.

También hay que tener bien puesto **Authentication → URL Configuration**:

- *Site URL*: la URL de producción de la app.
- *Redirect URLs*: agregar `https://TU-DOMINIO/**`.

Si el Site URL apunta a otro lado, el link del correo lleva a cualquier parte.

### Mientras tanto: el link a mano

El alta no depende del correo. Al crear un usuario, la app **muestra el link de
acceso en pantalla** para que el administrador se lo pase por el medio que sea.
Lo mismo con `POST /api/administracion/usuarios/[id]/link-acceso`, que lo vuelve
a generar para alguien que ya existe (correo perdido, link vencido, blanqueo).

El link es **de un solo uso y caduca**. Es una contraseña temporal: no conviene
dejarlo en un chat grupal ni anotado.

## Diagnóstico rápido

1. **Supabase → Logs → Auth**: ahí se ve si el envío se intentó y con qué error.
2. Si no hay ni intento, el problema está antes: revisar que el email exista en
   `usuarios`.
3. Si el intento aparece con error de rate limit, es el SMTP por defecto.
4. Si el correo llega pero el link no funciona, es la *URL Configuration*.

## Variables que influyen

| Variable | Para qué |
|---|---|
| `NEXT_PUBLIC_APP_URL` | Base de los links de los correos. Sin esto se deduce del host, que detrás de un proxy no siempre es correcto. |
| `SUPABASE_SERVICE_ROLE_KEY` | Necesaria para crear usuarios y generar links. |

## Cosas que se arreglaron y conviene no volver a romper

- **`activo` se controla en el layout.** Antes desactivar a alguien no hacía
  nada: seguía entrando. La pantalla de cuenta desactivada se muestra en el
  lugar y no con un redirect, porque el middleware manda a `/` a cualquiera con
  sesión y se armaba un bucle.
- **El alta ya no falla si el correo falla.** Antes devolvía 500 y dejaba el
  usuario creado a medias, sin que el administrador se enterara del link.
- **`redirectTo` siempre explícito.** Sin él, el link sale apuntando al Site URL
  de Supabase en vez de a `/reset-password`.
- **El `?code=` se canjea en `/auth/confirm`, que es un Route Handler.** No
  puede hacerse en la página: en un Server Component `cookies().set()` no hace
  nada, así que la sesión existiría sólo durante ese render y el formulario
  después no tendría con qué guardar la contraseña. `/reset-password` reenvía
  ahí si el código le llega igual, para tolerar un Site URL mal configurado.
