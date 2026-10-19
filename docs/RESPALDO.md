# Respaldo

El SdG tiene **tres respaldos** y cada uno contesta una pregunta distinta. No se
reemplazan: el valor está en que son independientes entre sí.

| | Qué es | Dónde | Cada cuánto | Para qué sirve |
|---|---|---|---|---|
| **1. Supabase** | Backup del proveedor | Infraestructura de Supabase | Diario (7 días, sólo en el plan Pro) | Un "deshacer" rápido si el problema lo causó Supabase |
| **2. Dump a Drive** | SQL completo, cifrado con GPG | Unidad compartida `Backups SdG` | Diario, 06:00 UTC (03:00 ARG), 30 días | **Reconstruir el sistema entero** en cualquier Postgres |
| **3. Respaldo a Sheets** | Fotocopia legible | Un libro de Google Sheets propio | Diario, 03:00 UTC (00:00 ARG) | **Seguir operando** con el sistema caído |

Los dos primeros sirven para *restaurar*. El tercero sirve para que alguien
pueda liquidar sueldos el martes a la mañana con el sistema caído — y para eso
un dump de SQL no sirve, porque lo abre un técnico y no la persona que tiene que
hacer el trabajo.

## 3. El respaldo a Sheets

### La mitad del sistema ya lo tenía

**Compras, Mantenimiento, Inventario, Calidad/Envases y Calidad/carbonilla
espejan planillas donde manda la planilla.** Si el SdG desaparece, esos cinco
frentes siguen enteros en Google: son de donde leen hoy los que no entran al
sistema. No hay nada que hacer ahí, y hacerlo sería destructivo (ver abajo).

**Producción, Despacho, Cantera y Trituración exportan a su planilla**, de una
sola vía y en el momento en que se carga el dato. También tienen copia, aunque
lo que falle queda en `sheets_pendiente` hasta que alguien lo reintente.

**Lo que no tenía nada** es lo que no tiene planilla ninguna:

- **RRHH** — padrón, asistencia y marcaciones. Entra por el reloj Lenox y por
  Excel, pero no espeja ninguna planilla.
- **Remises** — plan de la semana y asistencia. Nunca tuvo planilla.
- **Calidad / Ensayos** — las muestras del laboratorio. Es el único de los tres
  frentes de Calidad sin planilla, y está dicho en
  [CALIDAD-ENSAYOS.md](CALIDAD-ENSAYOS.md).
- **Facturación / buzón** — qué entró y en qué estado quedó.

Ahí el SdG es el único lugar donde el dato existe. Eso es lo que copia este
respaldo, y por eso son siete pestañas y no veinte.

### Por qué es un libro aparte, y no las planillas que ya están conectadas

Es la decisión que importa de todo esto.

Escribir el estado del sistema **dentro de las planillas que el sistema
sincroniza** parece lo natural —ya están, ya las mira la gente— y es justamente
lo que no se puede hacer. En esos módulos **manda la planilla**: el SdG lee de
ahí. Escribirles encima su propia salida es darle de comer al importador lo que
el importador produjo.

Y desde el 18/10/2026 es peor que un lazo: la sincronización de las cuatro
planillas que espejan por número **borra** las filas que la planilla dejó de
tener (ver [lib/core/borradoDeEspejo.ts](../lib/core/borradoDeEspejo.ts)). Una
fila que el respaldo no alcanzara a copiar —por un 429 de Google a mitad de
camino, por una ventana de 60 días, por cualquier cosa— se leería en la
sincronización siguiente como una fila que alguien borró a mano. Un respaldo
incompleto pasaría a ser una orden de borrado. Borrar una OT se lleva en cascada
sus notas, sus repuestos y su aviso.

Por eso:

- El libro de respaldo es **uno nuevo y vacío**, creado a mano, y su id va en su
  propia variable (`GOOGLE_SHEETS_RESPALDO_ID`). No se reusa ninguno de los que
  ya están configurados.
- **El SdG nunca lo lee.** No es un espejo, es una fotocopia. Nada de lo que
  alguien escriba ahí vuelve al sistema.
- Cada pestaña **se borra y se reescribe entera** cada noche, sin mirar qué
  había. Eso es seguro precisamente porque nadie lee de ahí.

La fila 1 de cada pestaña lo dice en la propia planilla, que es la única defensa
real contra el modo en que esto se puede romper: que alguien encuentre el libro,
le parezca una planilla más del sistema y empiece a corregir ahí.

### Qué NO se copia, a propósito

**El valor hora.** Vive en `rrhh_empleados_datos`, cerrado con
`tiene_acceso_rrhh()`, justamente porque `empleados` tiene la lectura abierta a
cualquier autenticado y RLS no sabe tapar una columna sola. Una planilla de
Drive no tiene RLS: cualquiera con el link la lee entera. Copiarlo acá
desarmaría en una línea la separación que costó una migración.

Lo mismo con el domicilio de `remises_empleados_datos`: es dato personal y no
hace falta para seguir operando.

**Los PDF del buzón** tampoco: viven en Supabase Storage. Lo que se respalda es
el índice, que es lo que permite saber qué falta.

### Las trampas que ya se encontraron

- **`hora_entrada` no es una hora, es un instante en UTC.** Llega como
  `2026-08-19T07:05:00+00:00` y la pantalla lo muestra como las 04:05. Copiarlo
  crudo pondría una hora corrida tres horas al lado del nombre de la persona,
  sin ninguna marca. Es la misma clase de error que movió 2.877 fichadas
  durante la importación desde APPRRHH, en la dirección contraria. Lo resuelve
  `hora()` de [lib/respaldo/celdas.ts](../lib/respaldo/celdas.ts), con la misma
  conversión que usa la pantalla.
- **`Number(null)` es `0`, no `NaN`.** Sin una guarda explícita, una columna sin
  calcular se respaldaba como un cero — y en una planilla de horas eso no se
  distingue de "trabajó cero horas". Lo encontró el test, no la lectura.
- **Las fechas van como serial, nunca como texto.** La escritura usa
  `USER_ENTERED`: un `"05/10/2026"` lo interpreta la planilla según su locale.
  Es la misma trampa que dio vuelta 885 fechas en Compras, por el otro lado.
- **Un serial sin formato se muestra crudo.** Las fechas van como serial —texto
  lo interpretaría la planilla según su locale— pero en un libro **nuevo** las
  columnas nacen en "Automático", así que la columna «Ingreso» decía `45903` en
  vez de `03/09/2025` y el respaldo entero dejaba de ser legible, que es para lo
  único que existe. En las planillas que ya existen el formato está puesto desde
  siempre y por eso nunca se había notado. Lo aplica `formatearColumnas()` y cada
  instantánea declara sus columnas en `formatos`. **Se vio leyendo la planilla de
  vuelta, no escribiéndola**: las siete escrituras habían devuelto `ok`.
- **Todo se lee con `traerTodo`.** La instantánea de asistencia son ~4.200 filas
  y PostgREST corta en 1.000 sin avisar. Un respaldo truncado en silencio es la
  peor clase de respaldo: parece completo hasta el día que hace falta.

### Cómo está armado

| | |
|---|---|
| Qué se copia y por qué | [lib/respaldo/instantaneas.ts](../lib/respaldo/instantaneas.ts) |
| Las conversiones a celda, con sus tests | [lib/respaldo/celdas.ts](../lib/respaldo/celdas.ts) |
| La corrida | [lib/respaldo/correr.ts](../lib/respaldo/correr.ts) |
| La ruta | `app/api/cron/respaldo-sheets/route.ts` |
| El cron | [.github/workflows/respaldo-sheets.yml](../.github/workflows/respaldo-sheets.yml) |

Corre **los lunes a las 00:00 de Argentina** (`0 3 * * 1` en UTC) desde el
19/10/2026. El dump de la base sigue siendo diario: son dos respaldos distintos
y una semana de atraso en la fotocopia no es lo mismo que una semana de trabajo
perdido.

**Cada pestaña va por su cuenta y un fallo no corta el resto**: son módulos
independientes, y que Facturación rompa no es motivo para quedarse sin el padrón
de RRHH. La ruta devuelve 500 sólo si falló **todo**; si salieron cinco de
siete, eso es un respaldo parcial y el 200 lleva el detalle. Cada pestaña queda
anotada en `sincronizaciones` (módulo `respaldo`), con lo que dijo Google sin
traducir.

Van **en serie y no en paralelo**: son siete pestañas del mismo libro y Google
limita por planilla, no por pestaña.

### Por qué el cron está en GitHub Actions

Por lo mismo que los otros seis: el plan Hobby de Vercel limita cuántos crons se
pueden declarar, y pasarse no degrada el cron, **hace fallar el deploy entero**.
`vercel.json` ya tiene diez. Además, en Actions corre aunque el deploy de Vercel
esté roto.

Hoy es diario, a las 00:00 de Argentina (`0 3 * * *` en UTC, que es como se
escriben todos los crons del repo). **Para pasarlo a semanal** alcanza con
cambiar esa línea a `0 3 * * 1` (lunes). Está tres horas antes del dump de
`backup.yml` a propósito, para que los dos respaldos de la noche no compitan por
la base.

## Qué falta configurar

~~1. Crear el libro~~ — hecho el 19/10/2026. Es
`RESPALDO AUTOMATICO SdG`, id `1MhFYWLEmt8ePsb5XSjGtDphJYGjbufc509kGq7Cx94A`,
dentro de la unidad compartida *Backups SdG*. Por vivir en una unidad
compartida, la cuenta de servicio ya es editora y no hubo que compartir nada.

~~2. Probarlo~~ — hecho: las siete pestañas escritas y **leídas de vuelta**,
8.817 filas, con las fechas verificadas contra la base (`2025-09-03` →
`03/09/2025`, d/m y no m/d).

3. **Cargar `GOOGLE_SHEETS_RESPALDO_ID` en Vercel** con ese id, en los tres
   entornos, y redesplegar. **Es lo único que falta**, y hasta que esté el cron
   va a fallar en rojo todos los lunes con el nombre de la variable en el
   mensaje.

4. Después, correr el workflow a mano desde *Actions* → *Respaldo a Sheets* →
   *Run workflow* para confirmar que sale verde sin esperar al lunes.

## Pendiente de la otra mitad

El dump a Drive **todavía no borra los viejos**: la cuenta de servicio está en
la unidad compartida como *Colaborador*, que no puede borrar. Hasta que pase a
*Administrador de contenido*, la retención de 30 días no corre y los backups se
acumulan.

Y **nunca se probó restaurar uno**. Un backup que no se restauró nunca es una
hipótesis: conviene levantar un proyecto de Supabase descartable y meterle el
dump de una noche cualquiera, una vez.
