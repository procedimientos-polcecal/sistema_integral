# Cuándo se actualizó lo que estoy mirando

Diseño acordado el 26 de agosto de 2026.

## El problema

Buena parte de lo que muestra el sistema no se carga en el sistema: viene de una
planilla de Google Sheets que se sincroniza cada tanto. Requerimientos, el
tablero de compras, los avisos de mantenimiento, las órdenes de trabajo y las de
servicio son todos espejos de una planilla.

Nada en la pantalla dice cuándo fue la última vez que ese espejo se actualizó.
Quien mira no puede distinguir «no hay nada» de «todavía no llegó», ni sabe si
está decidiendo sobre datos de hace un rato o de ayer.

Y hay un caso peor: si la última sincronización falló, la pantalla se ve
exactamente igual que si hubiera salido bien.

## Qué ya existe y qué no

**Compras** guarda cada corrida en `compras_sincronizaciones`: dirección,
origen, filas leídas, nuevas, actualizadas y omitidas, el error si lo hubo, la
duración y la fecha. Está desde el principio y no se muestra en ninguna parte.

**Mantenimiento** tiene cuatro pantallas alimentadas por planillas —avisos,
órdenes de trabajo, órdenes de servicio y comparativas de proveedores— y
ninguna deja registro de nada.

## 1. Dónde se guarda

**La tabla de Compras no se toca.** Tiene columnas propias y el historial real
de un módulo en producción.

**Mantenimiento estrena `sincronizaciones`** (migración `037`), genérica desde
el principio: módulo, recurso, si salió bien, el error, cuántas filas y cuándo.
Son cuatro recursos hoy y van a ser más.

**Una vista `ultima_sincronizacion`** une las dos fuentes y devuelve la última
corrida de cada recurso. Así la pantalla consulta un solo lugar sin importar de
qué módulo se trate.

Quedan dos tablas parecidas, y es un costo real. La alternativa era mover el
historial de Compras a la tabla nueva; no vale tocar datos vivos para ahorrar
una vista.

La vista se declara con `security_invoker = true`, igual que
`compras_resumen_por_estado`: sin eso, una vista es un agujero por el que se
filtra lo que RLS tapa.

## 2. Qué se muestra

Un componente, `UltimaSincronizacion`, que recibe cuándo fue y si falló:

| Situación | Qué dice |
|---|---|
| Al día | `Actualizado hace 3 horas`, en gris, con la fecha exacta en el `title` |
| Falló | En rojo: `La última actualización falló`, y el motivo |
| Nunca corrió | `Sin sincronizar todavía` |

El «hace 3 horas» sale de una función pura, `haceCuanto`, y no de una librería
nueva.

## 3. Dónde aparece

| Pantalla | |
|---|---|
| Compras › Requerimientos | el cartel |
| Compras › Tablero | el cartel |
| Compras › Configuración | junto al botón de «Sincronizar ahora» que ya está |
| Mantenimiento › Avisos | junto a su botón |
| Mantenimiento › Órdenes de trabajo | junto a su botón |
| Mantenimiento › Órdenes de servicio | junto a su botón |

En la bandeja de aprobación no va: se decidió así.

## 4. Cómo se registra en Mantenimiento

Un helper `registrarSincronizacion(...)` que las rutas `/sync` llaman al
terminar, **tanto en éxito como en error**. Registrar sólo los éxitos dejaría
una fecha vieja sin explicación, que es justamente lo que este trabajo viene a
evitar.

Es una línea en cada ruta. Se eligieron las rutas `/sync` y no los módulos de
`lib/mantenimiento/` porque otra sesión está trabajando en esos archivos: la
superficie de contacto se mantiene al mínimo a propósito.

## Pruebas

Sobre `haceCuanto`, que es lo único con lógica:

- minutos, horas y días
- el borde del singular: `hace 1 hora`, no `hace 1 horas`
- lo muy reciente se dice `recién`, no `hace 0 minutos`
- una fecha futura no rompe ni dice `hace -3 minutos`: puede pasar si el reloj
  del servidor y el de la base no coinciden

## Fuera de alcance

**La frecuencia del cron.** Se pidió pasarlo a cada 15 minutos y no se hace en
este trabajo: el plan Hobby de Vercel sólo admite crons diarios, y una
frecuencia mayor no degrada el cron sino que hace fallar el deploy entero. Ya
está anotado en `COMPRAS-ESTADO.md` como algo que costó tiempo una vez.

Este cartel es, de hecho, lo que vuelve visible ese problema: va a decir «hace
14 horas» buena parte del día. Las salidas —plan Pro, un disparador externo, o
apoyarse en el webhook de la planilla que ya existe— se discuten aparte.
