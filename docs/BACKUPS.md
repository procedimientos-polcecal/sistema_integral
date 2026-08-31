# Backups de la base

Hay **dos**, y son independientes a propósito. Conviene tener los dos.

| | Supabase | El nuestro, a Drive |
|---|---|---|
| Existe en | Sólo plan Pro o superior | Cualquier plan, incluido Free |
| Frecuencia | Diaria, no configurable | La que diga el workflow (hoy diaria) |
| Retención | 7 días (Pro) | La que diga el script (hoy 30 días) |
| Dónde | Infraestructura de Supabase (S3) | Nuestra unidad compartida de Drive |
| ¿Elegimos dónde? | **No**, en ningún plan | Sí |
| Formato | Lógico o físico. Los físicos **no se pueden descargar** | SQL plano, restaurable en cualquier Postgres |
| Restaurar | Desde el dashboard, con el proyecto caído | A mano, donde sea |
| Pérdida máxima | Hasta 24 h | Hasta 24 h |

Para bajar la pérdida a segundos existe PITR, pero es un add-on de ~US$100/mes
sobre el plan y exige el compute Small. Para el tamaño de esta base no se
justifica.

**El nuestro no reemplaza al de Supabase, y viceversa.** El de Supabase restaura
rápido y en el lugar. El nuestro sobrevive a perder la cuenta de Supabase, se
puede bajar y leer, y lo controlamos nosotros.

## Cómo funciona el nuestro

`.github/workflows/backup.yml`, todas las noches a las 03:00 de Argentina —antes
del recálculo de RRHH, así el dump sale de una base quieta.

1. `supabase db dump` cuatro veces: esquema, datos, roles y usuarios.
2. Los junta en un `.tar.gz`.
3. Si hay `BACKUP_PASSPHRASE`, lo cifra con GPG (AES256). Si no, avisa y sube en
   claro.
4. Lo sube a Drive con la misma cuenta de servicio que usan Compras y
   Mantenimiento, y borra los que tengan más de 30 días.

### Dos cosas que no son obvias

**El esquema `auth` no entra en el dump por defecto.** La CLI excluye los
esquemas que administra Supabase, y ahí viven los usuarios. Sin ese cuarto dump
se restauran todos los datos y nadie puede entrar. Va aparte y **no es fatal si
falla**: restaurar `auth` en un proyecto administrado es delicado y puede que la
conexión no tenga permiso de leerlo.

**La carpeta tiene que estar en una UNIDAD COMPARTIDA.** Una cuenta de servicio
no tiene cuota de Drive: subir a "Mi unidad" de una persona falla con "Service
Accounts do not have storage quota" aunque la carpeta esté compartida como
editor. En una unidad compartida los archivos son de la unidad y no de quien los
sube, y ahí sí entra. El script traduce ese error a algo accionable en vez de
dejar un 403 pelado.

## Qué configurar, una vez

En el repositorio (Settings → Secrets and variables → Actions):

| | Qué |
|---|---|
| `SUPABASE_DB_URL` *(secret)* | Project Settings → Database → Connection string (URI). **Lleva la contraseña de la base: es el secreto más sensible del repo.** |
| `GOOGLE_SERVICE_ACCOUNT_JSON` *(secret)* | El mismo JSON que ya está en Vercel. |
| `BACKUP_PASSPHRASE` *(secret)* | Opcional, muy recomendado. Son datos de sueldos saliendo a un tercero. **Guardala fuera del repo: sin ella el backup no se puede abrir.** |
| `GOOGLE_DRIVE_BACKUPS_FOLDER_ID` *(variable)* | La carpeta, dentro de una unidad compartida, con la cuenta de servicio como Colaborador o Administrador de contenido. |

Después, correrlo a mano desde la pestaña Actions (*Run workflow*) y verificar
que el archivo aparezca en Drive. **Hacelo antes de confiar en él.**

## Cómo restaurar

```bash
gpg --decrypt --output backup.tar.gz sdg-backup-2026-08-31.tar.gz.gpg
tar -xzf backup.tar.gz
psql "$DB_URL" -f sdg-backup-2026-08-31-roles.sql
psql "$DB_URL" -f sdg-backup-2026-08-31-esquema.sql
psql "$DB_URL" -f sdg-backup-2026-08-31-datos.sql
```

Los usuarios (`-usuarios.sql`) van aparte y con cuidado: en un proyecto de
Supabase nuevo el esquema `auth` ya existe y tiene filas propias.

**Un backup que nunca se restauró no es un backup.** Conviene probar la
restauración completa en un proyecto de Supabase de prueba, al menos una vez.
