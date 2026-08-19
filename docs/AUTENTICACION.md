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
