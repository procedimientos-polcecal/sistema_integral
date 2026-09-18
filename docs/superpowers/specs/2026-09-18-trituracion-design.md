# Trituración — el parte de las 3 plantas deja de perder el operario

Diseñado el 18 de septiembre de 2026, sobre relevamiento en vivo de la
planilla real (`1QU1iDgcsTSwTe_RMzUs9DOJwfDV0H6ylR7ublMwcMdI`, compartida por
el usuario). Mismo patrón que Producción, Despacho, Cantera fase 1 y Taller
Vial: de acá en adelante **manda el SdG**, la planilla queda de respaldo de
una sola dirección.

## Qué reemplaza

Tres pestañas `PLANTA 1`/`PLANTA 2`/`PLANTA 3` (1046/643/993 filas), una fila
por **día** por planta: `Fecha, Estado, Material procesado, Origen, Hora
inicio, Hora fin, Horas teóricas, Mantenimiento(h), Falta de piedra(h),
Producción(h), Otro(h), Total horas paradas, Horas reales trabajadas,
Disponibilidad%, Camiones llegados, Toneladas procesadas, Ton/camión,
Productividad absoluta, Productividad real, Observaciones`.

Y tres formularios de papel en blanco que también tiene la planilla (`PFP`
control de falta de piedra, `PDP` parte diario de producción, `PDC` control de
descarga de camiones): tienen **turno** y **operario** (línea de firma) —
justo lo que se pierde al transcribir al Excel. El SdG existe para no perder
ese dato, no para reproducir el Excel tal cual está.

## Dos trampas encontradas en el relevamiento

- **La columna F cambia de significado entre pestañas.** En `PLANTA 1` y
  `PLANTA 3` el encabezado de fila 3 dice "Horas teóricas (h)"; en `PLANTA 2`,
  en la misma posición, dice "Horas Reales (h)" — mismo dato (duración
  inicio→fin), nombre distinto. No hay que copiar el nombre de columna al
  importar, sólo la posición y lo que realmente contiene.
- **Tres formatos de fecha, uno por pestaña**: `PLANTA 1` usa `d/m/yyyy`
  (`2/6/2026`), `PLANTA 2` usa `dd-mm-yy` (`15-06-26`), `PLANTA 3` usa
  `dd/mm/yy` (`01/06/26`). Ni `fechaDeSheets()` los cubre los tres —hay que
  parsear por pestaña, no asumir un formato único, y así evitar la misma
  trampa que ya dio vuelta 885 fechas en Compras.
- **Filas futuras pre-rellenadas sin dato real**: las tres pestañas tienen
  fechas cargadas por fórmula hasta 2027-2029 sin ningún otro campo. La
  importación filtra por `Estado`/`Material` no vacíos, no por presencia de
  fecha.

## Todo lo que se puede despejar, se despeja

Igual que Producción no guarda "lo producido", acá no se guarda ninguna de
las columnas calculadas del Excel — salen de `lib/trituracion/horas.ts` con
lo mínimo cargado:

```
horas_teoricas        = hora_fin − hora_inicio
horas_paradas_total    = mantenimiento + falta_piedra + produccion + otro
horas_reales_trabajadas = horas_teoricas − horas_paradas_total
disponibilidad          = horas_reales_trabajadas / horas_teoricas
ton_por_camion          = toneladas_procesadas / camiones_llegados
productividad_absoluta  = toneladas_procesadas / horas_teoricas
productividad_real      = toneladas_procesadas / horas_reales_trabajadas
```

Verificado cifra por cifra contra filas reales de `PLANTA 1` (ej. fila del
2/6/2026: 6,833 h teóricas − 1,167 h falta de piedra = 5,667 h reales,
disponibilidad 0,829 — exacto contra la planilla).

## El parte es por día y planta, no por turno

El Excel tiene una sola fila por `(planta, fecha)` — nunca dos turnos
separados el mismo día — así que `trituracion_partes` respeta esa
granularidad: `unique(planta_id, fecha)`. El campo `turno` del papel
(`PFP`/`PDP`/`PDC`) no se modela como una segunda dimensión: si en el futuro
una planta corre dos turnos con operarios distintos el mismo día, es una
migración aparte, no algo que haya que adivinar hoy sin un caso real.

## Paradas: motivo por categoría, no por evento

El papel (`PDP`) anota cada parada con hora de inicio/fin y motivo libre; el
Excel ya las resume en 4 horas por categoría. Se sigue el mismo criterio que
Producción con las paradas de máquina: **la categoría estructurada, el detalle
en texto**. `motivo_otro` (texto) acompaña a `horas_otro` porque "otro" sin
decir qué es no sirve para nada — las otras tres categorías (mantenimiento,
falta de piedra, producción) ya dicen su propio motivo. El desglose por
evento con horario, que es lo que le serviría a Mantenimiento, queda afuera a
propósito — mismo spec pendiente que Producción ya dejó anotado.

## Material y origen: vocabulario compartido con Cantera, sin forzar un enlace

`material` reusa `MATERIALES` de `lib/cantera/vocabulario.ts`
(Dolomita/Chocolata/Caliza/Arcilla) — es la misma piedra.

`origen` es **texto, sin FK** — mismo criterio que `cantera_bochones.voladura_codigo`
o `taller_vial_cargas.equipo_raw`. En los datos reales conviven códigos de
yacimiento propio (D1, D6, C1, C3) con proveedores externos (`LOMA NEGRA`,
`PEZZUCCHI`), un origen genérico (`ACOPIO`) y **material que viene de otra
planta** (`PLANTA 2` como origen de `PLANTA 1`). Forzar todo a un yacimiento
sería inventar un enlace donde a veces no hay cantera de por medio.
`lib/trituracion/origen.ts` tiene `yacimientoDelOrigen(origen)`, que devuelve
el código de yacimiento **sólo si coincide exacto** con uno de Cantera
(D1/D6/C1/C3) y `null` en cualquier otro caso — para poder cruzar contra
Cantera sin adivinar cuando no corresponde.

## Operario: FK a `empleados`, con texto de respaldo

Mismo patrón que `equipo_id`/`equipo_raw` de Taller Vial:
`operario_id uuid references empleados(id)` nullable +
`operario_raw text` para cuando el nombre anotado no matchea a nadie del
núcleo (o para los partes importados del histórico, que no tienen operario
en absoluto porque el Excel nunca lo tuvo). **Enlazar al que se parece es
peor que null** — sigue el mismo criterio que ya usa Cantera con los fleteros
sin resolver.

## Vinculado a Cantera, sin inventar el cruce

El usuario pidió poder comparar entrada vs. procesado. Cantera ya sabe, por
`cantera_pesadas`, cuántas toneladas de cada material llegaron a cada
`ORIGEN`/`DESTINO` (incluidos `PT 1/2/3`, exactamente estas tres plantas) por
día. El informe mensual de Trituración cruza `toneladas_procesadas` de acá
contra las toneladas que Cantera registró como llegadas a esa planta ese día
—cuando el origen matchea un yacimiento propio—, y lo muestra como aviso, no
como error: la piedra puede llegar un día y procesarse otro, y el objetivo es
que alguien lo note, no que el sistema lo corrija solo.

## El espejo: SdG manda, la planilla queda de respaldo

Al guardar un parte se escribe (o se reemplaza, por fecha) la fila
correspondiente en `PLANTA {N}` — mismas 20 columnas, mismo orden, con las
calculadas recién despejadas. El operario no tiene columna en el Excel real,
así que no se espeja: vive sólo en el SdG. Un fallo de escritura no es un
`console.warn`: queda en `trituracion_partes.sheets_pendiente` con lo que dijo
Google sin traducir, igual que en los demás módulos. Las pestañas de informe
mensual (`AGOSTO`, `Informe Mensual`, `julio`) no se tocan — son hechas a mano
hoy y quedan fuera de este alcance; si el usuario las quiere reemplazadas por
un informe generado, es una fase aparte (como el informe de Cantera).

## Importación del histórico 2026

Una corrida puntual (`scripts/importar-trituracion-2026.mts`, ensayo por
defecto / `--escribir`), sólo filas de 2026 con `Estado` o `Material` no
vacíos, una por planta con su propio parser de fecha. **Sin operario** —el
Excel nunca lo tuvo—, así que los partes importados quedan con
`operario_id`/`operario_raw` en null y se distinguen en pantalla de los
cargados desde el SdG (que si tendrán operario cargado). No se reintenta el
espejo en la importación: las filas ya existen en la planilla, escribirlas de
vuelta sería una operación sin sentido contra sí misma.

## Lo que queda afuera a propósito

- **Turno como segunda dimensión** — no hay caso real de dos partes el mismo
  día por planta hoy; se agrega cuando aparezca.
- **Paradas con horario y motivo libre por evento** — igual que Producción,
  es un spec aparte.
- **Reemplazo de las pestañas de informe mensual manuales** por un informe
  generado — se puede pedir después, como se hizo con Cantera.
- **Cruce automático que corrija divergencias** entre lo que Cantera dice que
  llegó y lo que Trituración dice que procesó — sólo se avisa, no se decide
  por la persona qué pasó.

## Dónde va cada cosa

| | |
|---|---|
| Módulo | `app/(app)/trituracion`, `lib/trituracion`, `app/api/trituracion` |
| Catálogo de plantas | `trituracion_plantas` (3 filas, admin) |
| El parte | `trituracion_partes` — `unique(planta_id, fecha)` |
| Lo despejado | `lib/trituracion/horas.ts` |
| Resolver origen↔yacimiento | `lib/trituracion/origen.ts` |
| Vocabulario | `lib/trituracion/vocabulario.ts` (reusa `MATERIALES` de Cantera) |
| Permisos | `lib/trituracion/auth.ts`, calcado de Cantera/Taller Vial |
| Espejo | `lib/trituracion/espejo.ts` + `lib/trituracion/planilla.ts` |
| Importación | `scripts/importar-trituracion-2026.mts` |
| Cruce con Cantera | `lib/trituracion/cruceCantera.ts`, usa `cantera_pesadas` |
