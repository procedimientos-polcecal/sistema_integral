# Módulo Compras

Reemplaza la planilla **PEDIDOS DE COMPRA** por un circuito con usuarios,
permisos e historial. Portado desde `procedimientos-polcecal/COMPRAS`, que era
una app suelta, y reapuntado al núcleo del SdG.

## El circuito que modela

La planilla tiene dos capas, y el módulo conserva esa separación porque son dos
decisiones de personas distintas:

1. **Alta** — un área carga un Requerimiento Interno (RI): qué necesita, cuánto,
   dónde y para cuándo. Hoja `Requerimientos internos`.
2. **Aprobación** — gerencia aprueba o deniega. Columna `Estado` del master.
3. **Compra** — Compras arma la comparativa, elige proveedor, carga el costo y
   sigue el pedido hasta que llega. Hojas `RI <ÁREA>`.

Por eso cada requerimiento lleva **dos estados independientes**:

| Campo | Valores |
|---|---|
| `estado_aprobacion` | `PENDIENTE` · `EN_REVISION` · `APROBADA` · `DENEGADA` |
| `estado_compra` | `SIN_INICIAR` · `PARA_COMPRAR` · `EN_COMPARATIVA` · `PEDIDO` · `RECIBIDO` · `DENEGADO` |

Las hojas por área (`RI MANTENIMIENTO`, `RI ALMACÉN`, …) **no son entidades
distintas**: las 1764 filas cruzan todas contra el master, así que son vistas
filtradas. Acá son un filtro por área, no tablas separadas.

## Permisos

Los tres niveles del núcleo (`usuario_modulos.nivel`) se mapean así:

| Nivel | Puede |
|---|---|
| `lectura` | Consultar todo el circuito |
| `edicion` | Gestionar la compra: proveedor, comparativa, costos, estados |
| `admin` | Además aprobar o denegar |

Aprobar es más restrictivo que comprar a propósito: es una decisión sobre el
gasto, no una tarea operativa.

**El alta es la excepción**: la puede hacer cualquier usuario activo del
sistema, tenga o no el módulo, desde `/mis-pedidos`. Son nueve áreas las que
piden materiales y exigirles un permiso convertiría a Compras en un cuello de
botella. Pedir no compromete nada; aprobar y comprar sí.

## Pantallas

| Ruta | Para qué |
|---|---|
| `/compras` | Indicadores, gasto por mes/área/empresa, principales proveedores |
| `/compras/requerimientos` | Listado completo con filtros, paginado en el servidor |
| `/compras/requerimientos/[id]` | Ficha: datos, aprobación, gestión de compra, comparativa e historial |
| `/compras/aprobaciones` | Cola por urgencia y antigüedad, con aprobación en tanda |
| `/compras/tablero` | Para comprar → En comparativa → Pedido |
| `/compras/proveedores` | Padrón compartido con Mantenimiento, con volumen por proveedor |
| `/compras/configuracion` | Estado de la sincronización con la planilla |
| `/mis-pedidos` | Fuera del módulo: cualquier usuario pide y sigue lo suyo |

## Integración con el resto del SdG

- **Proveedores viven en el núcleo**, no dentro de Compras. Mantenimiento ya
  guardaba el contratista de cada OT como texto libre; ahora
  `ordenes_trabajo.proveedor_id` apunta al mismo padrón, sin perder el texto
  original (mismo patrón que `equipo_raw` / `equipment_id`).
- **"Dónde se necesita"** se resuelve contra el núcleo cuando se puede: varias
  ubicaciones de la planilla (`CAT 950G`, `Doosan 225 n°1`) son equipos reales
  del módulo Mantenimiento. Enlazarlas permite ver cuánto se gastó por máquina.
  Lo que no se puede identificar queda en `ubicacion_raw`.
- **"Paga: Ambas"** se guarda como `empresa_id = null`, igual que
  `sectores.transversal` resuelve el "AMBOS" de Mantenimiento. Es habitual:
  pasa en más de un tercio de los RI.

## Puesta en marcha

Aplicar las migraciones en orden:

1. `015_nucleo_ajustes_compras.sql` — agrega el módulo al enum, crea el padrón
   de proveedores y los helpers de permisos.
2. `016_compras_schema.sql` — tablas del módulo.
3. `017_compras_rls.sql` — políticas.

Van separadas porque Postgres no deja usar un valor de enum en la misma
transacción en que se lo agrega.

Después, dar acceso al módulo desde `/administracion/usuarios`.

### Si la base ya tuvo el repo COMPRAS suelto

Antes de portarlo, Compras existió como app aparte
(`procedimientos-polcecal/COMPRAS`, hoy archivado). Si sus migraciones llegaron
a correrse en esta base, hay dos choques:

- `rol_actual()` allá devolvía `text` y leía de `app_users`; acá devuelve
  `user_role` y lee de `usuarios`. Postgres no deja cambiarle el tipo de
  retorno a una función existente, así que **la 002 falla** con
  `42P13: cannot change return type of existing function`.
- La tabla `proveedores` ya existe con `bigserial`, y la **015 falla** al
  intentar crearla con `uuid`.

Se resuelve con `supabase/limpiar-compras-standalone.sql`, que verifica que esas
tablas estén vacías antes de borrarlas. El histórico no se pierde: se recarga
desde el xlsx con el importador.

### Importar el histórico

```bash
node scripts/import-compras/import.mjs "C:/ruta/PEDIDOS DE COMPRA.xlsx" --dry-run
```

El `--dry-run` no escribe: informa cuántos registros fusionó, cómo quedaron los
estados y cuántas ubicaciones pudo resolver contra sectores y equipos. Sin ese
flag escribe usando `SUPABASE_SERVICE_ROLE_KEY`.

Es idempotente (upsert sobre `nro_ri`), se puede correr de nuevo.

Verificado contra la planilla real: 1825 RI, 9 áreas, 163 proveedores tras
unificar variantes de nombre (`MORC` y `MORC SRL` son uno solo).

## Sincronización con Google Sheets

Ver [COMPRAS-SINCRONIZACION.md](COMPRAS-SINCRONIZACION.md).

## Notas sobre los datos

- Fechas y montos del xlsx son celdas reales de Excel, no texto: la importación
  es exacta y no hay ambigüedad día/mes.
- Hay `FECHA DE REQUERIMIENTO` mal cargadas en la planilla (por ejemplo
  `3/16/16`). No se corrigen: se respeta el dato original.
- 40 requerimientos sin estado quedan como `PENDIENTE`.
- **El 68% de los RI está marcado `URGENTE`.** La prioridad perdió capacidad de
  discriminar; vale la pena revisar el criterio con los usuarios.
