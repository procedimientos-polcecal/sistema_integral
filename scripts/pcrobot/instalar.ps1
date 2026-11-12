<#
    Instala en esta PC la tarea que sube los zips del PC Robot a Drive.

    Se copia la carpeta `pcrobot` entera a la maquina nueva, se pone adentro el
    JSON de la cuenta de servicio, y se corre este archivo con el boton derecho
    -> "Ejecutar con PowerShell". No hace falta ser administrador.

    Que hace, en este orden:

      1. comprueba Node
      2. comprueba que este el JSON de la cuenta de servicio
      3. comprueba que se vean las carpetas del servidor
      4. escribe `subir-zips.config.json` con las rutas de ESTA maquina
      5. corre una prueba EN SECO, que no sube nada
      6. recien si esa prueba sale bien, registra la tarea programada
      7. y la vuelve a leer del Programador, para contestar la unica pregunta
         que importa: ¿quedo instalada, y a que hora corre?

    La ventana NO se cierra sola al terminar, ni cuando sale bien ni cuando
    falla: espera una tecla. Con "Ejecutar con PowerShell" se cerraba de
    inmediato y se perdia justo el mensaje que explicaba el error. Se saltea
    con -SinPausa.

    El orden importa y es la unica decision de diseno de este archivo: una
    tarea instalada que no puede funcionar es peor que ninguna, porque se
    descubre semanas despues cuando alguien va a buscar datos que nunca
    llegaron. Por eso la prueba en seco es un requisito y no un paso opcional.

    Opciones:
      -Probar        hace todo menos registrar la tarea. Para ver si andaria.
      -Hora 22:00    a que hora corre. Por defecto 22:00, a pedido y porque es
                     la hora que menos se pelea con los robots: para entonces
                     ya exportaron todos (Hornos 04:20, Filler 09:00, Planta 02
                     09:30, Porteria cada hora). Correr a las 09:30 dejaba la
                     subida de Planta 02 EMPATADA con su export de las
                     09:30:37, que es una carrera que a veces se pierde.
                     OJO si se cambia: el cron del SdG lee Drive a las 13:00
                     UTC (10:00 de Argentina), asi que con 22:00 lee lo que se
                     subio la NOCHE ANTERIOR. Ver docs/PRODUCCION-FILLERS-SUBIDA.md.
      -Servidor      el nombre UNC del servidor. Por defecto "server".
#>

param(
  [switch]$Probar,
  [switch]$SinPausa,
  [string]$Hora = "22:00",
  [string]$Servidor = "server"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# Todo se resuelve contra la carpeta de este archivo, asi funciona en cualquier
# ruta sin editar nada.
$Aca = Split-Path -Parent $MyInvocation.MyCommand.Path
$NOMBRE_TAREA = "SdG - Subir zips del PC Robot"
$CARPETA_DRIVE = "0AH83x2YPTJdbUk9PVA"   # la unidad compartida "PC Robot"

function Paso($n, $texto) { Write-Host "`n[$n] $texto" -ForegroundColor Cyan }
function Bien($texto)     { Write-Host "    OK  $texto" -ForegroundColor Green }
function Mal($texto)      { Write-Host "    --  $texto" -ForegroundColor Red }

<#
    Deja la ventana abierta hasta que alguien apriete una tecla.

    Esto NO es cosmetico y por eso esta en todas las salidas, tambien en las
    que fallan. Con "Ejecutar con PowerShell" del boton derecho, la ventana se
    cierra sola en cuanto el script termina: el que corrio el instalador no
    llega a leer si salio bien, y si salio mal pierde justamente el mensaje que
    dice por que. Un instalador que explica sus errores y despues los borra de
    la pantalla no explica nada.

    Se salta con -SinPausa, para cuando esto lo llame otro script. Y el
    Read-Host va en try/catch porque en una sesion sin consola —una tarea
    programada, un pipe— tirar ahi seria cambiar un final limpio por un error.
#>
function Pausar {
  if ($SinPausa) { return }
  Write-Host ""
  Write-Host "Apreta una tecla para cerrar..." -ForegroundColor DarkGray
  try { $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown") } catch { }
}

function Cortar($texto)   { Mal $texto; Write-Host ""; Pausar; exit 1 }

Write-Host "Instalador de la subida de zips del PC Robot" -ForegroundColor White
Write-Host "Carpeta: $Aca"

# ── 1. Node ────────────────────────────────────────────────────────────────
Paso 1 "Node"
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  Cortar "No hay Node en esta maquina. Instala la version LTS desde nodejs.org y volve a correr esto."
}
$v = (& $node --version)
$mayor = [int]($v -replace '^v(\d+).*', '$1')
if ($mayor -lt 18) { Cortar "Node $v es muy viejo: hace falta 18 o posterior." }
Bien "$v en $node"

# ── 2. La credencial ───────────────────────────────────────────────────────
Paso 2 "La cuenta de servicio"
$credencial = Join-Path $Aca "config\cuenta-de-servicio.json"
if (-not (Test-Path -LiteralPath $credencial)) {
  Mal "Falta $credencial"
  Write-Host ""
  Write-Host "    Ese archivo no viaja con el repo porque es una credencial." -ForegroundColor Yellow
  Write-Host "    Copialo de la maquina donde esto ya funciona, o bajalo de" -ForegroundColor Yellow
  Write-Host "    Google Cloud. Tiene que llamarse exactamente asi." -ForegroundColor Yellow
  Cortar "Sin eso no se puede seguir."
}
try {
  $cuenta = Get-Content -LiteralPath $credencial -Raw | ConvertFrom-Json
} catch {
  Cortar "El archivo esta pero no es un JSON valido: $credencial"
}
if (-not $cuenta.client_email) { Cortar "Ese JSON no parece una cuenta de servicio: no tiene client_email." }
Bien $cuenta.client_email

# ── 3. Las carpetas del servidor ───────────────────────────────────────────
Paso 3 "Las carpetas del servidor"

# Las rutas de origen van en UNC y NUNCA con letra de unidad. Una letra como
# Z: es un mapeo por usuario y por sesion, asi que una tarea programada que
# corre sin la sesion abierta no la ve: a mano anda y de noche falla.
#
# Los cinco origenes y el porque de cada uno. El "nombre" es el prefijo que va
# a llevar el archivo en Drive y NO se cambia a la ligera: el SdG empareja por
# ese prefijo.
#
#   Filler 1, Filler 2   el PC Robot de cada filler. El SdG los LEE, asi que
#                        sin ellos no hay nada que instalar: son obligatorios.
#   Planta 02            tambien es un PC Robot, pero su CSV es un horimetro
#                        por hora y SIN kilos, asi que el SdG todavia no sabe
#                        leerlo. Se sube igual para no seguir perdiendo el dato.
#                        Lleva `ignorar` porque ese robot deja DOS clases de
#                        zip: el bueno (con DAT001.CSV, ~21 KB) y uno de 868
#                        bytes al arrancar, con cuatro .txt sueltos y sin el
#                        CSV. El 12/11/2026 ese piso al bueno en Drive, porque
#                        el subidor elige el mas nuevo y el basura salio
#                        despues. El filtro va POR ORIGEN y no global: en
#                        Hornos los `- INICIO` si traen las 18 planillas.
#   Hornos               no es un robot: son 18 planillas mensuales que alguien
#                        respalda todos los dias. Se guarda, no se lee.
#   Porteria             tampoco: es el respaldo del escritorio completo de esa
#                        PC. Son ~10 MB por dia y adentro viajan dos
#                        OfficeSetup.exe. Lo util son las planillas de pesaje.
#   Pesadas Balanza      el unico que NO son zips: doce DAT000000NN.CSV, uno
#                        por camion, cada uno acumulando desde agosto. Por eso
#                        lleva carpetaEntera = $true: quedarse con el mas nuevo
#                        subiria un camion y perderia once.
#
# Las cuatro ultimas se guardan y no se leen: ver la nota del mismo tema en
# lib/produccion/molinos/drive.ts, que es lo que evita que el diagnostico
# diario del SdG se llene de avisos por ellas.
#
# Y por eso una que falta NO corta la instalacion: se saca de la configuracion
# y se avisa. Al subidor le alcanza con que falte una carpeta para terminar con
# codigo 1, asi que dejar escrita una ruta que no existe pinta de rojo la tarea
# programada todos los dias por algo que nadie lee. Un rojo permanente es un
# rojo que se deja de mirar, y el dia que falle un Filler no lo va a ver nadie.
$origenes = @(
  @{ nombre = "Filler 1";        carpeta = "\\$Servidor\EXTERIOR\Filler1";         obligatorio = $true  },
  @{ nombre = "Filler 2";        carpeta = "\\$Servidor\EXTERIOR\Filler2";         obligatorio = $true  },
  @{ nombre = "Planta 02";       carpeta = "\\$Servidor\EXTERIOR\Planta 02";       obligatorio = $false; ignorar = " - (INICIO|AL INICIAR) " },
  @{ nombre = "Hornos";          carpeta = "\\$Servidor\EXTERIOR\Hornos";          obligatorio = $false },
  @{ nombre = "Porteria";        carpeta = "\\$Servidor\EXTERIOR\Porteria";        obligatorio = $false },
  @{ nombre = "Pesadas Balanza"; carpeta = "\\$Servidor\EXTERIOR\Pesadas Balanza"; obligatorio = $false; carpetaEntera = $true }
)

$incluidos = @()
foreach ($o in $origenes) {
  if (-not (Test-Path -LiteralPath $o.carpeta)) {
    if (-not $o.obligatorio) {
      Mal "$($o.carpeta) no se ve: queda afuera de la configuracion."
      continue
    }
    Mal "No se ve $($o.carpeta)"
    Write-Host ""
    Write-Host "    Comproba que esta PC llegue al servidor y que la cuenta con" -ForegroundColor Yellow
    Write-Host "    la que entraste tenga permiso de lectura. Si el servidor se" -ForegroundColor Yellow
    Write-Host "    llama distinto, corre esto con  -Servidor <nombre>." -ForegroundColor Yellow
    Cortar "Sin acceso a las carpetas de los fillers no hay nada que subir."
  }
  # Se cuenta lo que ese origen va a subir de verdad y no siempre los .zip: en
  # la balanza no hay ninguno, y "0 zips" al lado de un OK parece una carpeta
  # vacia cuando en realidad tiene los doce archivos que importan.
  $patron = if ($o.carpetaEntera) { "*" } else { "*.zip" }
  $hay = @(Get-ChildItem -LiteralPath $o.carpeta -Filter $patron -File -ErrorAction SilentlyContinue)
  $ult = $hay | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  $cuando = if ($ult) { $ult.LastWriteTime.ToString("yyyy-MM-dd HH:mm") } else { "vacia" }
  $que = if ($o.carpetaEntera) { "archivos" } else { "zips" }
  Bien ("{0,-16} {1,4} {2,-9} el ultimo {3}" -f $o.nombre, $hay.Count, $que, $cuando)
  $incluidos += $o
}

# ── 4. La configuracion ────────────────────────────────────────────────────
Paso 4 "La configuracion"
$config = Join-Path $Aca "subir-zips.config.json"
$log    = Join-Path $Aca "subir-zips.log"

$contenido = [ordered]@{
  credencial   = $credencial
  carpetaDrive = $CARPETA_DRIVE
  # `carpetaEntera` se escribe solo cuando es verdadera: el subidor lo lee como
  # ausente-es-falso, y un `"carpetaEntera": false` en cinco de seis origenes
  # invita a creer que es una opcion que hay que decidir cada vez.
  origenes     = @($incluidos | ForEach-Object {
    $o = [ordered]@{ nombre = $_.nombre; carpeta = $_.carpeta }
    if ($_.carpetaEntera) { $o.carpetaEntera = $true }
    if ($_.ignorar) { $o.ignorar = $_.ignorar }
    $o
  })
  log          = $log
}
# Se escribe con WriteAllText y un UTF8Encoding($false) y NO con
# `Set-Content -Encoding utf8`: en Windows PowerShell 5.1 ese parametro
# escribe un BOM, y `JSON.parse` de Node lo rechaza con un "Unexpected token"
# que muestra un caracter invisible. Lo encontro la prueba en seco de este
# mismo instalador, que es para lo que esta.
$json = $contenido | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText($config, $json, (New-Object System.Text.UTF8Encoding($false)))
Bien "escrita en $config  ($($incluidos.Count) origenes)"

# ── 5. La prueba en seco ───────────────────────────────────────────────────
Paso 5 "Prueba en seco (no sube nada)"
$salida = & $node (Join-Path $Aca "subir-zips.mjs") $config "--seco" 2>&1
$salida | ForEach-Object { Write-Host "    $_" }
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Cortar "La prueba fallo. El mensaje de arriba dice por que. La tarea NO se instalo."
}
Bien "la prueba paso"

if ($Probar) {
  Write-Host "`n-Probar: llegue hasta aca y no registro la tarea." -ForegroundColor Yellow
  Write-Host "Corre esto mismo sin -Probar para instalarla.`n"
  Pausar
  exit 0
}

# ── 6. La tarea programada ─────────────────────────────────────────────────
Paso 6 "La tarea programada"

# Se arma el XML y no se usa `schtasks /create` a secas por tres opciones que
# la linea de comandos no expone, y una sola de ellas ya justifica el archivo:
# por defecto el Programador NO ejecuta nada con la maquina a bateria, asi que
# en una notebook no correria la mitad de los dias y no avisaria.
$hoy = (Get-Date).ToString("yyyy-MM-dd")
$xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Sube a Drive el zip mas nuevo de cada molino (PC Robot). Ver docs/PRODUCCION-FILLERS-SUBIDA.md en el repo del SdG.</Description>
  </RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>${hoy}T${Hora}:00</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>
    </CalendarTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT30M</ExecutionTimeLimit>
    <Priority>7</Priority>
    <RestartOnFailure><Interval>PT15M</Interval><Count>3</Count></RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>$node</Command>
      <Arguments>"$(Join-Path $Aca 'subir-zips.mjs')" "$config"</Arguments>
      <WorkingDirectory>$Aca</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@

# schtasks pide el XML en UTF-16. Guardarlo en UTF-8 falla con un error de
# formato que no menciona la codificacion por ningun lado.
$tmp = Join-Path $env:TEMP "sdg-pcrobot-tarea.xml"
[System.IO.File]::WriteAllText($tmp, $xml, [System.Text.Encoding]::Unicode)

$r = & schtasks /create /tn $NOMBRE_TAREA /xml $tmp /f 2>&1
Remove-Item -LiteralPath $tmp -ErrorAction SilentlyContinue
if ($LASTEXITCODE -ne 0) { Cortar "No se pudo registrar la tarea: $r" }
Bien "registrada, corre todos los dias a las $Hora"

# ── 7. Leerla de vuelta ────────────────────────────────────────────────────
# Se vuelve a preguntar por la tarea en vez de confiar en que `schtasks
# /create` devolvio 0. No es desconfianza del comando: es que la pregunta que
# se hace el que corrio esto es "¿quedo instalada?", y la unica respuesta que
# vale es la del Programador, no la del instalador diciendo que le parece que
# si. Ademas imprime la proxima ejecucion, que es lo que hay que mirar para
# saber si la hora quedo como se queria.
Paso 7 "Comprobarla en el Programador"
$q = & schtasks /query /tn $NOMBRE_TAREA /fo LIST /v 2>&1
if ($LASTEXITCODE -ne 0) {
  Cortar "schtasks /create dijo que si, pero la tarea no aparece al consultarla. No quedo instalada."
}
# El nombre del campo cambia con el idioma de Windows, asi que se busca por las
# dos formas en vez de por una: en ingles no diria "Hora proxima ejecucion".
#
# Y los acentos van como `.` a proposito. `schtasks` escribe con la codepage de
# la consola, que no es la que PowerShell usa para leerlo, asi que "próxima"
# puede llegar como "prxima" o "pr?xima": buscar el texto con tilde no matchea
# y el paso queda diciendo "la tarea existe" sin la hora, que era justo el dato
# por el que se agrego. Comprobado el 12/11/2026, fallaba con el acento puesto.
$proxima = $q | Select-String -Pattern "Hora pr.xima ejecuci.n|Next Run Time" | Select-Object -First 1
if ($proxima) { Bien ($proxima.Line.Trim()) } else { Bien "la tarea existe en el Programador" }

# ── Cierre ─────────────────────────────────────────────────────────────────
Write-Host "`nListo.`n" -ForegroundColor Green
Write-Host "  Probarla ahora:   schtasks /run /tn `"$NOMBRE_TAREA`""
Write-Host "  Ver que paso:     type `"$log`""
Write-Host "  Sacarla:          schtasks /delete /tn `"$NOMBRE_TAREA`" /f"
Write-Host ""
Write-Host "Dos cosas que conviene saber:" -ForegroundColor Yellow
Write-Host "  - La tarea corre SOLO con la sesion iniciada. Si esta maquina se"
Write-Host "    reinicia y nadie entra, no sube y no avisa. Con una cuenta que"
Write-Host "    tenga contrasena se puede pasar a modo desatendido."
Write-Host "  - Si un dia falla no se pierde nada: el zip del robot es"
Write-Host "    acumulativo y el del dia siguiente trae todo igual."
Write-Host ""
Pausar
