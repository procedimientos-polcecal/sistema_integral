<#
    Instala en esta PC la tarea que sube los zips del PC Robot a Drive.

    Se copia la carpeta `pcrobot` entera a la maquina nueva, se pone adentro el
    JSON de la cuenta de servicio, y se corre este archivo con el boton derecho
    -> "Ejecutar con PowerShell". No hace falta ser administrador.

    Que hace, en este orden:

      1. comprueba Node
      2. comprueba que este el JSON de la cuenta de servicio
      3. escribe `subir-zips.config.json` con las rutas de ESTA maquina
      4. comprueba que se vean las carpetas del servidor
      5. corre una prueba EN SECO, que no sube nada
      6. recien si esa prueba sale bien, registra la tarea programada

    El orden importa y es la unica decision de diseno de este archivo: una
    tarea instalada que no puede funcionar es peor que ninguna, porque se
    descubre semanas despues cuando alguien va a buscar datos que nunca
    llegaron. Por eso la prueba en seco es un requisito y no un paso opcional.

    Opciones:
      -Probar        hace todo menos registrar la tarea. Para ver si andaria.
      -Hora 09:30    a que hora corre. Por defecto 09:30, media hora despues
                     de que el robot exporta. Antes no existe el archivo.
      -Servidor      el nombre UNC del servidor. Por defecto "server".
#>

param(
  [switch]$Probar,
  [string]$Hora = "09:30",
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
function Cortar($texto)   { Mal $texto; Write-Host ""; exit 1 }

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

# ── 3. La configuracion ────────────────────────────────────────────────────
Paso 3 "La configuracion"
$config = Join-Path $Aca "subir-zips.config.json"
$log    = Join-Path $Aca "subir-zips.log"

# Las rutas de origen van en UNC y NUNCA con letra de unidad. Una letra como
# Z: es un mapeo por usuario y por sesion, asi que una tarea programada que
# corre sin la sesion abierta no la ve: a mano anda y de noche falla.
$origen1 = "\\$Servidor\EXTERIOR\Filler1"
$origen2 = "\\$Servidor\EXTERIOR\Filler2"

$contenido = [ordered]@{
  credencial   = $credencial
  carpetaDrive = $CARPETA_DRIVE
  origenes     = @(
    [ordered]@{ nombre = "Filler 1"; carpeta = $origen1 },
    [ordered]@{ nombre = "Filler 2"; carpeta = $origen2 }
  )
  log          = $log
}
# Se escribe con WriteAllText y un UTF8Encoding($false) y NO con
# `Set-Content -Encoding utf8`: en Windows PowerShell 5.1 ese parametro
# escribe un BOM, y `JSON.parse` de Node lo rechaza con un "Unexpected token"
# que muestra un caracter invisible. Lo encontro la prueba en seco de este
# mismo instalador, que es para lo que esta.
$json = $contenido | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText($config, $json, (New-Object System.Text.UTF8Encoding($false)))
Bien "escrita en $config"

# ── 4. Las carpetas del servidor ───────────────────────────────────────────
Paso 4 "Las carpetas del servidor"
foreach ($o in @($origen1, $origen2)) {
  if (-not (Test-Path -LiteralPath $o)) {
    Mal "No se ve $o"
    Write-Host ""
    Write-Host "    Comproba que esta PC llegue al servidor y que la cuenta con" -ForegroundColor Yellow
    Write-Host "    la que entraste tenga permiso de lectura. Si el servidor se" -ForegroundColor Yellow
    Write-Host "    llama distinto, corre esto con  -Servidor <nombre>." -ForegroundColor Yellow
    Cortar "Sin acceso a las carpetas no hay nada que subir."
  }
  $n = @(Get-ChildItem -LiteralPath $o -Filter *.zip -ErrorAction SilentlyContinue).Count
  Bien "$o  ($n zips)"
}

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
