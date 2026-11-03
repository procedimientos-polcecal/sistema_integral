# Que el zip del PC Robot suba solo a Drive

Cómo se instala la tarea que todos los días sube a Drive el zip más nuevo de
cada molino. Es la mitad de afuera del frente de molinos: el diseño de lo que
el SdG hace con ese archivo está en
[el spec](superpowers/specs/2026-10-21-produccion-molinos-desde-el-robot-design.md).

**Lo que está andando hoy es la tarea programada de Windows**, en la notebook
que ve el servidor, desde el 29/10/2026. La variante con contenedor está
escrita y probada hasta donde se pudo, pero **quedó bloqueada por la cuenta sin
contraseña del servidor de archivos** — el detalle, medido, está en su sección.

Lo que ya se verificó de punta a punta el 29/10/2026 contra Drive real: la
cuenta `pcrobot-subidor@sistemadegestion-pp` sube los dos zips a la unidad
compartida `PC Robot`, y la cuenta `sheets-reader@mantenimientopp` —la que
tiene Vercel— los **lista y los descarga**, con los bytes llegando como un zip
válido. Las dos mitades del circuito existen.

## Por qué hace falta una máquina adentro

El `PCRobot.exe` de cada molino ya exporta un zip por día y lo deja en el
servidor —38 de los últimos 47 están sellados a las 09:00 clavadas, es su
descarga programada—. Ese servidor es un recurso de red interno: Vercel no
llega, y el CI de GitHub tampoco. **Es el único eslabón del SdG que necesita
una máquina propia.**

No tiene que ser la PC del robot, y conviene que no lo sea: a esa no hay que
tocarla y probablemente no tenga salida a internet.

## Antes de empezar: el destino y la credencial

**El destino tiene que estar dentro de una unidad compartida**, no en "Mi
unidad" de nadie. No es una preferencia: una cuenta de servicio **no tiene
cuota de Drive**, así que crear un archivo en la carpeta de una persona falla
con `storageQuotaExceeded` aunque esté compartida como editor. En una unidad
compartida los archivos son de la unidad y ahí sí entra.

Podría usarse la cuenta de servicio que ya existe —
`sheets-reader@mantenimientopp.iam.gserviceaccount.com`, la de Compras,
Mantenimiento y el respaldo — y la unidad compartida `Backups SdG`, que ya
tiene. Funciona hoy sin pedirle nada a nadie, y si hace falta arrancar rápido
es una opción válida.

**Pero conviene una cuenta nueva y una unidad nueva**, por dos razones
concretas:

- La cuenta de hoy puede **editar todas las planillas** de Compras y de
  Mantenimiento, y acá la llave queda apoyada en el disco de una máquina de la
  red. Una que sólo sabe subir zips a una carpeta no sirve para nada más si
  alguien se la lleva.
- Ser miembro de `Backups SdG` le da además **acceso de lectura a todos los
  dumps de la base**. Están cifrados con GPG, pero una llave que vive en una PC
  de planta no debería ni poder listarlos.

### Paso a paso

Son siete pasos: tres en Google Cloud, tres en Drive y uno de comprobación.

#### 1. Crear la unidad compartida

En [drive.google.com](https://drive.google.com) → **Unidades compartidas** →
**Nueva** → `PC Robot`.

No hace falta crear una carpeta adentro: **la raíz de la unidad sirve como
destino** y su id es igual de válido.

#### 2. Crear la cuenta de servicio

En [console.cloud.google.com](https://console.cloud.google.com), con el
proyecto **`mantenimientopp`** seleccionado (es el mismo de la cuenta actual):

**IAM y administración → Cuentas de servicio → + Crear cuenta de servicio**

- Nombre: `pcrobot-subidor`
- Descripción: *Sube los zips del PC Robot a Drive*

Queda `pcrobot-subidor@mantenimientopp.iam.gserviceaccount.com`.

**Y acá está lo que casi todo el mundo hace mal: el paso 2, "Otorgar a esta
cuenta de servicio acceso al proyecto", se saltea.** Clic en *Continuar* sin
elegir ningún rol, y después *Listo*.

Los roles de IAM gobiernan **recursos de Google Cloud**, y Drive no es uno de
ellos: darle "Editor" o "Administrador de almacenamiento" no le da ni un
permiso más sobre Drive, y sí le da permisos sobre el proyecto que no necesita.
**El acceso a Drive se otorga del lado de Drive**, en el paso 5.

#### 3. Bajar la clave

Clic en la cuenta recién creada → pestaña **Claves** → **Agregar clave** →
**Crear clave nueva** → **JSON** → **Crear**.

Se descarga **una sola vez**: Google no la vuelve a mostrar. Si se pierde, se
crea otra y se borra la vieja.

Si el botón da error, lo más probable es una política de la organización que
prohíbe crear claves de cuenta de servicio
(`iam.disableServiceAccountKeyCreation`). El mensaje no lo dice con esas
palabras.

#### 4. Habilitar la API de Drive

**APIs y servicios → Biblioteca → "Google Drive API" → Habilitar.**

Es por proyecto, no por cuenta, así que lo más probable es que ya esté desde el
respaldo. Si ya está, el botón dice *Administrar* y no hay nada que hacer.

#### 5. Darle el permiso en Drive

Esto **no** es Google Cloud: es Drive. En la unidad compartida `PC Robot` →
**Administrar miembros** → pegar el correo de la cuenta de servicio:

```
pcrobot-subidor@mantenimientopp.iam.gserviceaccount.com
```

Rol: **Colaborador**. Y destildar *Notificar a las personas* — no es una
persona y ese correo no existe como casilla.

Colaborador puede **crear y editar, pero no borrar ni mover**, que es
exactamente lo que el script hace y nada más. No hace falta *Administrador de
contenido*: el script nunca borra, reemplaza el archivo del día en su lugar.

#### 6. Copiar el id

Entrar a la unidad compartida y mirar la URL:

```
https://drive.google.com/drive/folders/XXXXXXXXXXXXXXXXXXXXXXXXXXXXX
                                       └──────── esto ────────┘
```

Ese id va en `carpetaDrive` de la configuración.

#### 7. Comprobar sin escribir nada

Con el JSON y el id ya puestos, correr el script en seco. Tiene que listar un
archivo por molino. Si algo falta, el error lo dice:

| Lo que sale | Qué pasó |
|---|---|
| `Drive contestó 404 para la carpeta …` | el id está mal, **o** falta el paso 5 — para una cuenta de servicio, lo que no puede ver no existe |
| `La cuenta de servicio no tiene cuota de Drive…` | el destino quedó en "Mi unidad" de alguien y no en una unidad compartida |
| `No se pudo autenticar con Google` con `invalid_grant` | el reloj de esa máquina está corrido |
| `Google Drive API has not been used in project…` | falta el paso 4 |

**La cuenta vieja no se toca.** Sigue en uso en Compras, Mantenimiento y el
respaldo; esto sólo agrega una nueva para este trabajo.

---

# Con Docker — y por qué hoy no se puede

Todo lo de abajo funciona: la imagen se construye, el compose es válido, el
script corre adentro. **Lo que no funciona es el montaje del recurso
compartido**, y conviene saber exactamente por qué antes de volver a intentarlo.

**La cuenta con la que esta red entra a `\\server\EXTERIOR` no tiene
contraseña.** No es la cuenta de Windows de nadie: se llama `exterior` y está
guardada en el Administrador de credenciales (`cmdkey /list` →
`Domain:target=server`), que es por lo que la `Z:` funciona sin pedir nada y
por lo que durante un buen rato buscamos el problema en el usuario equivocado.

Con esa cuenta, el montaje CIFS **alterna entre andar y no andar**. Medido el
29/10/2026: las mismas opciones exactas dieron `permission denied` seis veces y
`OK` otras seis, en bloques, con una carpeta y con dos, con `sec=ntlmssp` y sin
él, con `vers=3.0`, `2.1` y `1.0`. No es configuración: un servidor Windows
restringe por política el inicio de sesión **por red** de cuentas sin clave, y
que pase o no depende del mecanismo que se negocie en cada sesión.

Por el camino sin Docker eso no aparece, porque ahí la autenticación la hace
Windows con la credencial que ya tiene guardada: la clave vacía nunca viaja.

**Para desbloquearlo hace falta una cuenta de sólo lectura sobre `EXTERIOR` con
contraseña de verdad.** Es lo que corresponde igual en la máquina definitiva:
hoy el contenedor usaría la misma cuenta con la que entra todo el mundo.

---

# Con Docker, cuando haya una cuenta con contraseña

El contenedor trae Node, así que en el host no se instala nada, y trae el
planificador adentro (`--diario`), así que tampoco hace falta cron ni una tarea
programada. Lo único que el host necesita es Docker y poder llegar al servidor
de archivos.

Los cuatro archivos están en [`scripts/pcrobot/`](../scripts/pcrobot/):
`Dockerfile`, `docker-compose.yml`, `.env.ejemplo` y
`config/subir-zips.config.ejemplo.json`.

### 1. Copiar la carpeta al host

Cualquier máquina con Docker que vea `\\server\EXTERIOR`. No necesita el repo
entero: alcanza con `scripts/pcrobot/`.

### 2. El `.env`

```bash
cp .env.ejemplo .env
chmod 600 .env        # lleva la contraseña de la cuenta que lee el servidor
```

Y adentro, el servidor y la cuenta que lo lee. **Con permiso de lectura
alcanza**, y es lo que corresponde dar.

### 3. La configuración y la credencial

```bash
cp config/subir-zips.config.ejemplo.json config/subir-zips.config.json
# y copiar ahí también el JSON de la cuenta de servicio, como cuenta-de-servicio.json
```

En el JSON de configuración va el id de la carpeta de Drive. Las rutas de
origen ya apuntan a `/datos/filler1` y `/datos/filler2`, que es **adentro del
contenedor**: el `docker-compose.yml` monta ahí los recursos compartidos.

La carpeta `config/` y el `.env` están en el `.gitignore` de
`scripts/pcrobot/`: llevan secretos y no se commitean.

### 4. Probar en seco, que no sube nada

```bash
docker compose run --rm subidor node subir-zips.mjs /config/subir-zips.config.json --seco
```

Tiene que decir una línea por molino con el archivo que subiría. Si algo está
mal, el mensaje dice qué: los errores que importan están traducidos al
castellano, incluido el de la cuota y el 404 de la carpeta que la cuenta no ve.

### 5. Dejarlo andando

```bash
docker compose up -d --build
docker compose logs -f
```

Arranca **subiendo**, sin esperar a las 09:30, y después corre todos los días a
esa hora. Mirar que los dos archivos aparezcan en la carpeta de Drive.

## Lo que hay que saber de esta instalación

- **El recurso compartido lo monta Docker, no el host.** Los volúmenes son
  `type: cifs` en el propio compose, así que se levantan con el contenedor y no
  dependen de un `/etc/fstab` que alguien tiene que acordarse de tocar.
- **Los dos volúmenes son de sólo lectura**, y es la propiedad que más
  importa: aunque el script tuviera un error, no puede tocar la carpeta del
  robot. Lo único que sabe hacer con ella es leer.
- **La zona horaria del contenedor es la que decide a qué hora sube.**
  `--diario 09:30` compara contra la hora local del proceso, y la imagen trae
  `TZ=America/Argentina/Buenos_Aires`. Si alguien la cambia, cambia la hora de
  la subida.
- **La imagen es `node:22-slim` y no `alpine`** justamente por eso: alpine trae
  un ICU recortado y acá se depende de la zona horaria. Son 60 MB más que
  evitan una clase entera de sorpresas.
- **`vers=3.0` en el montaje puede haber que bajarlo.** Un servidor viejo que
  sólo habla SMB 1 falla con un `mount error(112)` que no menciona la versión
  del protocolo por ningún lado.
- **Si el nombre `server` no resuelve desde el host de Docker, va la IP** en
  `SMB_SERVIDOR`. El contenedor no hereda el DNS de Windows.
- **Cambiar el `.env` no recrea los volúmenes.** Docker los crea la primera vez
  con las opciones de montaje de ese momento y después los reusa; compose avisa
  *"Volume exists but doesn't match configuration. Recreate?"* y, sin terminal
  interactiva, **asume que no**. Es una trampa cara porque el error sigue
  diciendo exactamente lo mismo: uno cambia la contraseña, vuelve a probar, y
  parece que la nueva tampoco sirve. Antes de cada prueba:
  `docker compose down -v`.
- **`SMB_DOMINIO` no puede quedar vacío.** Un `domain=` sin valor hace fallar
  el montaje con **`invalid argument`**, que no dice cuál de las ocho opciones
  es la mala y manda a buscar por el lado equivocado: parece un problema de
  permisos o de versión de SMB, y no es ninguno de los dos. En una red
  WORKGROUP va `WORKGROUP`, y el compose lo pone por defecto si está vacía.
  Medido el 23/10/2026 contra el servidor real: con `domain=` da `invalid
  argument`; con `domain=WORKGROUP`, el montaje se intenta de verdad.
- **Una cuenta sin contraseña no sirve**, aunque el mapeo de red de Windows
  funcione desde la sesión abierta. Son dos caminos de autenticación
  distintos: Windows pasa las credenciales de la sesión, y el montaje CIFS
  manda lo que diga `SMB_CLAVE`. Con la clave vacía da **`permission
  denied`**, y con `guest` también si el recurso no admite anónimos — las dos
  cosas comprobadas acá. Hay que poner la contraseña real de una cuenta que el
  servidor acepte.

---

# Sin Docker: tarea programada de Windows — lo que está andando

Misma lógica, mismo script, sin contenedor. **Es lo que quedó instalado el
29/10/2026** en la notebook que ve el servidor, y la razón es la de arriba: acá
la autenticación contra el recurso compartido la hace Windows con la credencial
que ya tiene guardada, así que la cuenta sin contraseña no es un problema.

Instalado y verificado ese día: la tarea corrió desde el Programador con
resultado `0` y saltó los dos archivos que ya estaban subidos — la idempotencia
comprobada en la instalación real y no sólo en el script.

**Esa notebook no es el destino final.** Sirve para que esto empiece a correr
hoy, pero el trabajo es diario a las 09:30 y una notebook se cierra y se lleva.
Mudar esto a la máquina definitiva es copiar la carpeta, los tres archivos de
configuración y el XML.

Necesita **Node 18 o posterior** instalado en esa PC. El script no tiene
dependencias: es un archivo suelto, no hace falta el repo ni `npm install`.

1. Crear `C:\SdG\pcrobot\` y copiar ahí
   [`subir-zips.mjs`](../scripts/pcrobot/subir-zips.mjs), el JSON de la cuenta
   de servicio y un `subir-zips.config.json` armado desde
   [`subir-zips.config.ejemplo.json`](../scripts/pcrobot/subir-zips.config.ejemplo.json).

2. En la configuración, **las rutas van en UNC —`\\server\EXTERIOR\…`— y nunca
   con letra de unidad.** Es el error que más va a costar: `Z:` es un mapeo
   **por usuario y por sesión**, así que una tarea programada que corre sin la
   sesión abierta no lo ve. A mano anda y de noche falla, que es la peor
   combinación. El UNC se comprobó el 23/10/2026: devuelve los mismos archivos
   que `Z:`.

3. Probar en seco:

   ```bash
   node C:\SdG\pcrobot\subir-zips.mjs C:\SdG\pcrobot\subir-zips.config.json --seco
   ```

4. Correrlo de verdad una vez, sin `--seco`, y mirar Drive.

5. La tarea se importa desde
   [`tarea-programada.xml`](../scripts/pcrobot/tarea-programada.xml), ajustando
   antes las rutas de adentro:

   ```bash
   schtasks /create /tn "SdG - Subir zips del PC Robot" /xml tarea-programada.xml /f
   ```

   **Va por XML y no por `schtasks /create` a secas**, por tres opciones que la
   línea de comandos no expone y que deciden si esto corre o no:

   - **`DisallowStartIfOnBatteries=false`.** Por defecto el Programador **no
     ejecuta nada con la máquina a batería**. En una notebook eso significa que
     no corre la mitad de los días, y no avisa. Es el tipo de falla que se
     descubre un mes después mirando por qué faltan datos.
   - **`StartWhenAvailable=true`.** Si la máquina estaba apagada a las 09:30,
     corre cuando vuelve. Sale gratis porque la subida es idempotente.
   - **`RestartOnFailure`**, tres reintentos cada 15 minutos, para cuando la red
     todavía no está lista al arrancar.

   Y dos cosas sobre la cuenta:

   - **`/st 09:30`** es hora local, media hora después de que el robot exporta.
     No antes: el archivo todavía no existe.
   - El XML usa **`LogonType=InteractiveToken`**, o sea que corre **sólo con la
     sesión iniciada**. Es lo único posible cuando la cuenta de Windows no
     tiene contraseña: el modo desatendido (`/ru` + `/rp`) exige una, y un
     inicio de sesión por lotes con clave vacía está bloqueado por política. En
     la máquina definitiva, con una cuenta con contraseña, conviene pasarlo a
     `Password` o `S4U` y darle el derecho *Iniciar sesión como trabajo por
     lotes* (`secpol.msc` → Directivas locales → Asignación de derechos de
     usuario). **`SYSTEM` no sirve**: no tiene credenciales de red y no puede
     leer el recurso compartido.

   Acá sí conviene poner `"log"` en la configuración: una tarea programada no
   tiene a nadie mirando la consola.

6. **Probar la tarea, no sólo el script:**

   ```bash
   schtasks /run /tn "SdG - Subir zips del PC Robot"
   ```

   Y mirar el log y el último resultado, que tiene que ser `0`. Correr el
   script a mano prueba el script; esto prueba la tarea, que es lo que va a
   correr todos los días.

---

# Cómo se comprueba que sigue andando

Tres lugares, de más barato a más caro:

- **El log.** `docker compose logs` en la variante con contenedor —ya rota, 10
  MB por 3 archivos— o el archivo `.log` en la variante con tarea programada.
- **El estado.** `docker compose ps` tiene que decir `Up`; en la tarea
  programada, el "último resultado" es `0x0` si salió bien y `0x1` si algo
  falló. El script nunca devuelve otra cosa — se cuidó especialmente que no
  devuelva 127, que es lo que pasaba al cortar con un socket abierto y no
  significa nada.
- **El SdG.** Es el control que de verdad importa, porque es el único que mira
  el resultado y no el intento: si el archivo más nuevo de un molino tiene más
  de un día, la importación lo dice. Una tarea que dejó de correr se nota del
  lado del sistema aunque nadie abra ningún log.

# Qué pasa si un día falla

Nada que haya que arreglar a mano. **El zip del robot es acumulativo**: cada
uno trae la carpeta entera desde febrero de 2026, no las novedades del día.
Así que el del día siguiente trae todo igual y el agujero se cierra solo.

Por eso el script es deliberadamente tonto —sin cola, sin reintentos, sin
estado— y por eso no hay que agregarle memoria: esa propiedad es lo que lo
hace confiable. En modo diario un fallo tampoco termina el proceso: se anota y
se espera a mañana. Un contenedor que se cae por un error de red de un martes
queda reiniciándose contra la política del daemon y ensucia el diagnóstico.

Lo único que no se recupera solo es que la tarea deje de correr para siempre, y
para eso está el control de obsolescencia del SdG.

# Lo que se descartó

**rclone** —un `.exe` suelto que habla Drive con cuenta de servicio y unidades
compartidas— no es mala opción y resuelve lo mismo. Se descartó por dos cosas,
no porque funcione peor: es un binario de terceros que alguien tiene que
mantener actualizado, y sus errores salen en inglés y genéricos. El de la
cuota, que es el que va a aparecer, no explica nada.

**Google Drive para escritorio** espejando la carpeta sí se descartó por
frágil: necesita una sesión de usuario iniciada, así que si alguien reinicia
esa máquina y no vuelve a loguearse deja de sincronizar en silencio, y el
espejo puede borrar del otro lado. El contenedor corre sin sesión, monta de
sólo lectura y sólo sabe subir.
