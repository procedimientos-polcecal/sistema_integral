# Mapa de las APIs del SdG

> **Generado por `npm run mapa-de-apis`. No se edita a mano.**
> Lo escrito a mano —para qué sirve cada módulo, cómo está armada una ruta y
> las trampas— está en [API.md](API.md). Acá sólo hay lo que sale del código.

Al 2026-11-13: **304 rutas** y **473 handlers** en 25 carpetas.

## Cómo leer la columna «guarda»

Dice **qué hay que pasar para que esa ruta te conteste**. Cinco salen del
propio archivo; la sexta no, y es la que más rutas tiene:

| | |
|---|---|
| secreto del cron | `revisarElSecreto`: la llama Vercel, no una persona |
| secreto propio | un webhook, con su variable de entorno |
| token contra la base | el `X-Goog-Channel-Token` que Google manda y que se guardó al abrir el canal |
| permiso de módulo | pide sesión **y** nivel en el módulo |
| sesión | pide estar logueado, y nada más |
| el proxy | **el archivo no valida nada**, y no hace falta: `proxy.ts` redirige al login todo lo que no tenga sesión, salvo la lista corta de exentos que se lee de `lib/supabase/middleware.ts` |
| **ABIERTA** | el proxy la deja pasar **y** el archivo no valida nada. Hoy no hay ninguna, y si aparece una el script sale 1 |

**«El proxy» no es lo mismo que «abierta», y la diferencia es el motivo de
que esto se genere.** Que una ruta no escriba su guarda no dice nada malo;
lo que diría algo malo es que además estuviera exenta, y eso se comprueba
cruzando las dos cosas, no leyendo el archivo.

Una advertencia que el mapa no puede darte solo: el proxy **redirige**, no
devuelve 401. Un POST sin sesión sigue el 307 y termina con el HTML del
login y un 200 — eso ya costó una pérdida de datos en la carga sin señal.

Y las marcas: `admin` es que usa el cliente de servicio, **así que RLS no
corre y el permiso lo pone la ruta**; `planilla` es que escribe en Sheets;
`audita` es que deja rastro en `auditoria`; `paginado` es que previó el corte
de PostgREST en 1000 filas; `zod` es que valida el cuerpo con el helper.

## Cuántas hay de cada una

| Guarda | Rutas |
|---|---|
| secreto del cron | 18 |
| secreto propio | 3 |
| token contra la base | 1 |
| permiso de módulo | 198 |
| sesión | 28 |
| el proxy | 56 |
| **ABIERTA** | 0 |

## administracion (9)

| Ruta | Métodos | Guarda | Tablas | Marcas |
|---|---|---|---|---|
| `/api/administracion/empresas/[id]` | PUT | permiso de módulo · `es_admin_check` | `empresas` | — |
| `/api/administracion/empresas` | GET | permiso de módulo · `es_admin_check` | `empresas` | — |
| `/api/administracion/sectores/[id]` | PUT | permiso de módulo · `es_admin_check` | `sectores` | — |
| `/api/administracion/sectores` | GET, POST | permiso de módulo · `es_admin_check` | `sectores` | admin |
| `/api/administracion/usuarios/[id]/areas` | PUT | permiso de módulo · `es_admin_check` | `compras_areas`, `usuario_areas_compras` | admin |
| `/api/administracion/usuarios/[id]/link-acceso` | POST | permiso de módulo · `es_admin_check` | `usuarios` | admin |
| `/api/administracion/usuarios/[id]/modulos` | PUT | permiso de módulo · `es_admin_check` | `usuario_modulos`, `usuarios` | admin · audita |
| `/api/administracion/usuarios/[id]` | PUT, DELETE | permiso de módulo · `es_admin_check` | `usuarios` | admin |
| `/api/administracion/usuarios` | GET, POST | permiso de módulo · `es_admin_check` | `usuarios` | admin |

## agenda (5)

| Ruta | Métodos | Guarda | Tablas | Marcas |
|---|---|---|---|---|
| `/api/agenda/eventos/[id]/destrabar` | POST | el proxy | `agenda_eventos` | zod |
| `/api/agenda/eventos/[id]` | PATCH, DELETE | el proxy | `agenda_eventos` | zod |
| `/api/agenda/eventos/[id]/visto` | POST | el proxy | `agenda_divergencias_vistas` | — |
| `/api/agenda/eventos` | POST | el proxy | `agenda_eventos` | zod |
| `/api/agenda/google` | POST | token contra la base · `tokenValido` | `agenda_canales` | admin · 60s |

## asistente (1)

| Ruta | Métodos | Guarda | Tablas | Marcas |
|---|---|---|---|---|
| `/api/asistente` | POST | permiso de módulo · `puedeUsarAsistente` | `asistente_consultas`, `usuario_modulos`, `usuarios` | — |

## buscar (1)

| Ruta | Métodos | Guarda | Tablas | Marcas |
|---|---|---|---|---|
| `/api/buscar` | GET | sesión | `choferes`, `empleados`, `equipos`, `vehiculos` | — |

## calidad (13)

| Ruta | Métodos | Guarda | Tablas | Marcas |
|---|---|---|---|---|
| `/api/calidad/carbonilleros` | GET, POST | permiso de módulo · `tieneAccesoCalidad` | `calidad_carbonilleros`, `calidad_odoo_sin_reconocer` | — |
| `/api/calidad/conteos` | GET, POST | permiso de módulo · `tieneAccesoCalidad` | `calidad_conteos`, `calidad_movimientos` | — |
| `/api/calidad/ensayos/curva/export` | POST | permiso de módulo · `nivelCalidadDe` | `calidad_ensayos_productos` | — |
| `/api/calidad/ensayos/limites` | POST, DELETE | permiso de módulo · `esAdminCalidad` | `calidad_ensayos_limites` | — |
| `/api/calidad/ensayos/muestras/[id]` | PATCH, DELETE | permiso de módulo · `puedeEditarCalidad` | `calidad_ensayos_muestras`, `calidad_ensayos_retenidos` | — |
| `/api/calidad/ensayos/muestras` | POST | permiso de módulo · `puedeEditarCalidad` | `calidad_ensayos_muestras`, `calidad_ensayos_retenidos` | — |
| `/api/calidad/ensayos/productos` | POST, PATCH | permiso de módulo · `esAdminCalidad` | `calidad_ensayos_productos` | — |
| `/api/calidad/envases/movimientos` | POST | permiso de módulo · `puedeEditarCalidad` | `calidad_envases_articulos`, `calidad_envases_movimientos` | — |
| `/api/calidad/envases/sync` | POST | permiso de módulo · `tieneAccesoCalidad` | — | — |
| `/api/calidad/movimientos/[id]` | PATCH | permiso de módulo · `puedeEditarCalidad` | `calidad_movimientos` | — |
| `/api/calidad/movimientos` | POST | permiso de módulo · `puedeEditarCalidad` | `calidad_movimientos` | — |
| `/api/calidad/productos` | GET, POST | permiso de módulo · `tieneAccesoCalidad` | `calidad_odoo_sin_reconocer`, `calidad_productos_odoo` | — |
| `/api/calidad/sincronizar` | POST | permiso de módulo · `puedeEditarCalidad` | — | admin · 300s |

## cantera (18)

| Ruta | Métodos | Guarda | Tablas | Marcas |
|---|---|---|---|---|
| `/api/cantera/acarreo/sync` | POST | permiso de módulo · `tieneAccesoCantera` | — | — |
| `/api/cantera/acarreos` | GET, PATCH | permiso de módulo · `tieneAccesoCantera` | `cantera_acarreos` | — |
| `/api/cantera/bochones/[codigo]/conciliacion` | GET, PATCH | permiso de módulo · `puedeFacturarCantera` | `cantera_bochones` | — |
| `/api/cantera/bochones/[codigo]` | GET, PATCH, DELETE | permiso de módulo · `tieneAccesoCantera` | `cantera_bochones` | — |
| `/api/cantera/bochones` | POST | permiso de módulo · `puedeEditarCantera` | `cantera_bochones` | — |
| `/api/cantera/contratistas` | POST, DELETE | permiso de módulo · `esAdminCantera` | `cantera_contratistas` | — |
| `/api/cantera/cubicacion/material` | PATCH | permiso de módulo · `puedeEditarCantera` | `cantera_cubicaciones_material` | — |
| `/api/cantera/cubicacion` | GET, PATCH | permiso de módulo · `tieneAccesoCantera` | `cantera_cubicaciones` | — |
| `/api/cantera/destape` | GET, POST, PATCH, DELETE | permiso de módulo · `tieneAccesoCantera` | `cantera_acarreos`, `cantera_destape`, `cantera_fleteros` | — |
| `/api/cantera/finanzas` | POST, DELETE | permiso de módulo · `esAdminCantera` | `cantera_finanzas` | — |
| `/api/cantera/fleteros` | GET, POST, PATCH | permiso de módulo · `tieneAccesoCantera` | `cantera_fleteros` | — |
| `/api/cantera/informes/export` | GET | permiso de módulo · `tieneAccesoCantera` | — | — |
| `/api/cantera/insumos` | GET, POST, PATCH | permiso de módulo · `tieneAccesoCantera` | `cantera_insumos` | — |
| `/api/cantera/tarifas-acarreo` | GET, POST | permiso de módulo · `tieneAccesoCantera` | `cantera_tarifas_acarreo` | — |
| `/api/cantera/voladuras/[codigo]/conciliacion` | GET, PATCH | permiso de módulo · `puedeFacturarCantera` | `cantera_voladuras` | — |
| `/api/cantera/voladuras/[codigo]` | GET, PATCH, DELETE | permiso de módulo · `tieneAccesoCantera` | `cantera_consumos`, `cantera_voladuras` | — |
| `/api/cantera/voladuras` | POST | permiso de módulo · `puedeEditarCantera` | `cantera_voladuras` | — |
| `/api/cantera/yacimientos` | GET, POST, PATCH | permiso de módulo · `tieneAccesoCantera` | `cantera_yacimientos` | — |

## compras (26)

| Ruta | Métodos | Guarda | Tablas | Marcas |
|---|---|---|---|---|
| `/api/compras/ajustes` | PATCH | permiso de módulo · `esAdminCompras` | `compras_ajustes` | zod |
| `/api/compras/aprobadores-os` | POST, DELETE | permiso de módulo · `esAdminCompras` | `os_aprobadores` | admin |
| `/api/compras/aprobadores` | POST, PUT, DELETE | permiso de módulo · `esAdminCompras` | `compras_aprobadores` | admin |
| `/api/compras/comparativas` | GET | permiso de módulo · `puedeEditarCompras` | — | — |
| `/api/compras/comparativas/vincular` | POST | permiso de módulo · `puedeEditarCompras` | `compras_cotizaciones`, `compras_requerimientos`, `proveedores` | admin · 300s |
| `/api/compras/cotizaciones/[id]/elegir` | POST | permiso de módulo · `puedeAprobarLaCompra` | `compras_cotizaciones`, `compras_historial`, `compras_requerimientos`, `usuarios` | admin |
| `/api/compras/cotizaciones/[id]` | PATCH, DELETE | permiso de módulo · `puedeEditarCompras` | `compras_cotizaciones` | admin |
| `/api/compras/mi-area` | GET | sesión | `usuario_areas_compras` | — |
| `/api/compras/odoo/pendientes` | GET, POST | permiso de módulo · `tieneAccesoCompras` | `compras_odoo_ordenes`, `compras_requerimientos` | admin · 60s |
| `/api/compras/proveedores/[id]` | PATCH | permiso de módulo · `puedeEditarCompras` | `proveedores` | admin |
| `/api/compras/proveedores/importar` | POST | permiso de módulo · `esAdminCompras` | `proveedores` | admin · 300s |
| `/api/compras/proveedores` | POST | permiso de módulo · `puedeEditarCompras` | `proveedores` | admin |
| `/api/compras/requerimientos/[id]/comparativa` | POST | permiso de módulo · `puedeEditarCompras` | `compras_cotizaciones`, `compras_requerimientos`, `proveedores` | admin |
| `/api/compras/requerimientos/[id]/cotizaciones` | POST | permiso de módulo · `puedeEditarCompras` | `compras_cotizaciones`, `compras_requerimientos` | admin · planilla |
| `/api/compras/requerimientos/[id]/odoo/estado` | GET, POST | permiso de módulo · `tieneAccesoCompras` | `compras_odoo_ordenes`, `compras_requerimientos` | admin · 60s |
| `/api/compras/requerimientos/[id]/odoo/pdf` | GET | permiso de módulo · `tieneAccesoCompras` | `compras_odoo_ordenes` | admin · 60s |
| `/api/compras/requerimientos/[id]/odoo` | GET, POST | permiso de módulo · `puedeEditarCompras` | — | admin · 60s |
| `/api/compras/requerimientos/[id]` | PATCH, DELETE | permiso de módulo · `puedeAprobarLaCompra` | `compras_cotizaciones`, `compras_historial`, `compras_requerimientos`, `usuarios` | admin · audita |
| `/api/compras/requerimientos` | POST, GET | permiso de módulo · `puedeEditarCompras` | `compras_historial`, `compras_requerimientos`, `equipos`, `usuarios` | admin · 120s |
| `/api/compras/sheets/opciones` | GET | sesión | — | — |
| `/api/compras/sheets/reintentar` | POST | permiso de módulo · `puedeEditarCompras` | — | 300s |
| `/api/compras/sheets/sync` | POST | permiso de módulo · `puedeEditarCompras` | — | 300s |
| `/api/compras/sheets/webhook` | POST | secreto propio · `SHEETS_WEBHOOK_SECRET` | — | 300s |
| `/api/compras/ubicaciones/[id]/fusionar` | POST | permiso de módulo · `puedeEditarCompras` | `compras_requerimientos`, `compras_ubicaciones` | admin |
| `/api/compras/ubicaciones/[id]` | PATCH, DELETE | permiso de módulo · `puedeEditarCompras` | `compras_requerimientos`, `compras_ubicaciones` | admin |
| `/api/compras/ubicaciones` | GET, POST | permiso de módulo · `puedeEditarCompras` | `compras_ubicaciones` | admin |

## cron (18)

| Ruta | Métodos | Guarda | Tablas | Marcas |
|---|---|---|---|---|
| `/api/cron/agenda` | GET | secreto del cron | — | admin · 300s |
| `/api/cron/avisos-diarios` | GET | secreto del cron | `push_suscripciones`, `usuario_modulos`, `usuarios` | admin · paginado |
| `/api/cron/calidad-envases-bajada` | GET | secreto del cron | `calidad_envases_movimientos` | admin · 300s |
| `/api/cron/calidad-envases-sync` | GET | secreto del cron | — | 300s |
| `/api/cron/calidad-sync` | GET | secreto del cron | — | admin · 300s |
| `/api/cron/cantera-acarreo-sync` | GET | secreto del cron | — | 300s |
| `/api/cron/compras-sync` | GET | secreto del cron | — | 300s |
| `/api/cron/facturacion-sync` | GET | secreto del cron | — | admin · 300s |
| `/api/cron/inventario-sync` | GET | secreto del cron | — | 300s |
| `/api/cron/mantenimiento-sync` | GET | secreto del cron | — | 300s |
| `/api/cron/produccion-molinos-sync` | GET | secreto del cron | — | admin · 300s |
| `/api/cron/remises-notificaciones` | GET | secreto del cron | `hojas_ruta`, `push_suscripciones`, `usuarios` | admin |
| `/api/cron/respaldo-sheets` | GET | secreto del cron | — | admin · 300s |
| `/api/cron/rrhh-lenox-sync` | GET | secreto del cron | — | 300s |
| `/api/cron/rrhh-recalculo` | GET | secreto del cron | — | admin · 300s |
| `/api/cron/syh-respaldo-de-fotos` | GET | secreto del cron | — | admin · 300s |
| `/api/cron/taller-vial-partes-sync` | GET | secreto del cron | — | 300s |
| `/api/cron/taller-vial-sync` | GET | secreto del cron | — | 300s |

## despacho (8)

| Ruta | Métodos | Guarda | Tablas | Marcas |
|---|---|---|---|---|
| `/api/despacho/importar` | POST | permiso de módulo · `esAdminDespacho` | `despacho_ordenes_carga` | admin |
| `/api/despacho/ordenes/[id]` | PATCH | permiso de módulo · `puedeEditarDespacho` | `despacho_ordenes_carga` | — |
| `/api/despacho/ordenes` | POST | permiso de módulo · `puedeEditarDespacho` | `despacho_ordenes_carga` | — |
| `/api/despacho/productos` | GET, POST, PATCH | permiso de módulo · `tieneAccesoDespacho` | `productos` | — |
| `/api/despacho/recepciones/[id]` | PATCH | permiso de módulo · `puedeEditarDespacho` | `despacho_recepcion_proveedores`, `despacho_recepciones`, `proveedores`, `usuarios` | admin · audita |
| `/api/despacho/recepciones/proveedores` | PUT | permiso de módulo · `esAdminDespacho` | `despacho_recepcion_proveedores` | — |
| `/api/despacho/recepciones` | GET, POST | permiso de módulo · `tieneAccesoDespacho` | `despacho_recepcion_proveedores`, `despacho_recepciones` | — |
| `/api/despacho/remitos` | GET | permiso de módulo · `tieneAccesoDespacho` | — | — |

## disponibilidad (2)

| Ruta | Métodos | Guarda | Tablas | Marcas |
|---|---|---|---|---|
| `/api/disponibilidad/reportes` | GET | permiso de módulo · `nivelRrhhDe` | `usuarios` | admin |
| `/api/disponibilidad` | GET | sesión | — | admin |

## facturacion (8)

| Ruta | Métodos | Guarda | Tablas | Marcas |
|---|---|---|---|---|
| `/api/facturacion/correo` | GET, PATCH | permiso de módulo · `tieneAccesoFacturacion` | `facturacion_correo` | admin |
| `/api/facturacion/correo/webhook` | POST | secreto propio · `FACTURACION_CORREO_SECRET` | `empresas`, `facturacion_correo` | admin · 120s |
| `/api/facturacion/facturas/[id]/lineas` | GET, PATCH | permiso de módulo · `tieneAccesoFacturacion` | `compras_producto_odoo`, `compras_requerimientos`, `compras_ubicaciones`, `equipos`, `facturas_proveedor`, `facturas_proveedor_lineas` | admin |
| `/api/facturacion/facturas/[id]/odoo/borrador` | GET, POST, PUT | permiso de módulo · `tieneAccesoFacturacion` | `facturas_proveedor`, `usuarios` | admin · audita |
| `/api/facturacion/facturas/[id]/odoo` | GET, POST, PATCH | permiso de módulo · `puedeEditarFacturacion` | `facturas_proveedor` | admin |
| `/api/facturacion/facturas/[id]` | GET, PATCH | permiso de módulo · `tieneAccesoFacturacion` | `compras_requerimientos`, `facturas_proveedor`, `proveedores` | admin |
| `/api/facturacion/facturas` | GET, POST | permiso de módulo · `tieneAccesoFacturacion` | `compras_producto_odoo`, `compras_requerimientos`, `empresas`, `facturas_proveedor`, `facturas_proveedor_lineas` | admin · 120s |
| `/api/facturacion/odoo/sincronizar` | POST | permiso de módulo · `puedeEditarFacturacion` | — | admin · 300s |

## home (3)

| Ruta | Métodos | Guarda | Tablas | Marcas |
|---|---|---|---|---|
| `/api/home/avisos` | GET | sesión | `usuario_modulos`, `usuarios` | — |
| `/api/home/resumen/descartar` | POST | sesión | `notificaciones_descartes` | — |
| `/api/home/resumen` | GET | sesión | `avisos`, `calculos_diarios`, `calidad_envases_articulos`, `calidad_envases_movimientos`, `compras_requerimientos`, `compras_resumen_por_estado`, `despacho_ordenes_carga`, `empleados`, `facturas_proveedor`, `inventario_articulos`, `inventario_movimientos`, `ordenes_trabajo`, `produccion_partes`, `taller_vial_cargas`, `trituracion_partes`, `usuario_modulos`, `usuarios`, `vehiculos` | — |

## inventario (8)

| Ruta | Métodos | Guarda | Tablas | Marcas |
|---|---|---|---|---|
| `/api/inventario/articulos/[id]` | PATCH | permiso de módulo · `esAdminInventario` | `inventario_articulos` | admin |
| `/api/inventario/articulos` | GET | sesión | `compras_requerimientos`, `inventario_articulos` | paginado |
| `/api/inventario/lista/[id]` | PATCH | permiso de módulo · `puedeEditarInventario` | — | admin |
| `/api/inventario/lista` | POST | permiso de módulo · `puedeEditarInventario` | — | admin |
| `/api/inventario/movimientos` | POST | permiso de módulo · `puedeEditarInventario` | `inventario_articulos`, `inventario_destinos`, `inventario_equipos`, `inventario_movimientos`, `inventario_solicitantes`, `proveedores`, `usuarios` | admin · audita |
| `/api/inventario/reservas-taller-vial/[id]` | POST, DELETE | permiso de módulo · `puedeEditarInventario` | `taller_vial_reparaciones`, `taller_vial_repuestos_asignados`, `taller_vial_services` | — |
| `/api/inventario/reservas-taller-vial` | GET | permiso de módulo · `tieneAccesoInventario` | `equipos`, `inventario_articulos`, `taller_vial_reparaciones`, `taller_vial_repuestos_asignados`, `taller_vial_services` | — |
| `/api/inventario/sync` | POST | permiso de módulo · `tieneAccesoInventario` | — | — |

## mantenimiento (60)

| Ruta | Métodos | Guarda | Tablas | Marcas |
|---|---|---|---|---|
| `/api/mantenimiento/ausencias` | GET, POST, PATCH, DELETE | permiso de módulo · `esAdminMantenimiento` | `ausencias`, `liquidaciones`, `mant_personal_taller`, `usuarios` | admin · audita |
| `/api/mantenimiento/avisos/desestimar` | POST, DELETE | permiso de módulo · `puedeEditarMantenimiento` | `avisos`, `usuarios` | admin |
| `/api/mantenimiento/avisos/enlazar` | GET, POST, DELETE | permiso de módulo · `puedeEditarMantenimiento` | `avisos`, `ordenes_trabajo` | admin |
| `/api/mantenimiento/avisos` | POST | sesión | `avisos`, `compras_areas`, `usuario_areas_compras`, `usuarios` | admin · planilla |
| `/api/mantenimiento/avisos/sync` | POST | permiso de módulo · `puedeEditarMantenimiento` | — | 300s |
| `/api/mantenimiento/calendario` | GET | permiso de módulo · `puedeVerMantenimiento` | `ausencias`, `francos`, `mant_personal_taller`, `ordenes_trabajo` | admin · paginado |
| `/api/mantenimiento/ciclos/[id]/reiniciar` | POST | permiso de módulo · `puedeEditarMantenimiento` | `mant_ciclos_de_ot`, `ordenes_trabajo`, `ordenes_trabajo_notas` | admin |
| `/api/mantenimiento/ciclos/[id]` | PATCH | permiso de módulo · `puedeEditarMantenimiento` | `mant_ciclos_de_ot` | admin |
| `/api/mantenimiento/comparativas` | GET, POST, PATCH, DELETE | permiso de módulo · `puedeEditarMantenimiento` | `ordenes_servicio`, `os_comparativas` | admin · planilla |
| `/api/mantenimiento/comparativas/sync` | POST | permiso de módulo · `puedeEditarMantenimiento` | — | 300s |
| `/api/mantenimiento/cuaderno/excel` | POST | permiso de módulo · `puedeEditarMantenimiento` | `equipos`, `mant_contratista_lugares`, `mant_cuadernos`, `mant_cuadernos_fotos`, `mant_cuadernos_renglones`, `sectores` | admin · paginado · 60s |
| `/api/mantenimiento/cuaderno/fotos` | POST | permiso de módulo · `puedeEditarMantenimiento` | `equipos`, `mant_contratista_lugares`, `mant_cuadernos`, `mant_cuadernos_fotos`, `mant_cuadernos_renglones`, `sectores` | admin · paginado · 300s |
| `/api/mantenimiento/cuaderno/generar` | POST | permiso de módulo · `puedeEditarMantenimiento` | `equipos`, `mant_cuadernos`, `mant_cuadernos_renglones`, `ordenes_trabajo`, `sectores` | admin · audita · paginado · 300s |
| `/api/mantenimiento/cuaderno/renglones/[id]` | DELETE | permiso de módulo · `puedeEditarMantenimiento` | `mant_cuadernos_renglones`, `usuarios` | admin · audita · paginado |
| `/api/mantenimiento/cuaderno/renglones` | PATCH, POST, DELETE | permiso de módulo · `puedeEditarMantenimiento` | `mant_contratista_lugares`, `mant_cuadernos`, `mant_cuadernos_renglones` | admin · paginado |
| `/api/mantenimiento/cuaderno/repetidos` | GET, DELETE | permiso de módulo · `puedeEditarMantenimiento` | `mant_cuadernos`, `mant_cuadernos_renglones` | admin · audita · paginado |
| `/api/mantenimiento/cuaderno` | GET, POST, DELETE | permiso de módulo · `puedeEditarMantenimiento` | `mant_cuadernos`, `mant_cuadernos_fotos`, `mant_cuadernos_renglones`, `proveedores` | admin · paginado |
| `/api/mantenimiento/ejecuciones` | POST | sesión | `mantenimientos_ejecuciones`, `mantenimientos_programados`, `ordenes_trabajo` | — |
| `/api/mantenimiento/equipos-y-sectores` | GET | sesión | `equipos` | — |
| `/api/mantenimiento/equipos/[id]/componentes` | GET, POST, DELETE | permiso de módulo · `puedeEditarMantenimiento` | `equipos_componentes` | admin |
| `/api/mantenimiento/equipos/[id]/repuestos` | GET, POST, DELETE | permiso de módulo · `puedeEditarMantenimiento` | `equipos_repuestos` | admin |
| `/api/mantenimiento/equipos/[id]` | PATCH | permiso de módulo · `puedeEditarMantenimiento` | `equipos`, `equipos_status_log` | admin |
| `/api/mantenimiento/equipos/export` | POST | sesión | — | — |
| `/api/mantenimiento/equipos/import` | POST | permiso de módulo · `puedeEditarMantenimiento` | `empresas`, `equipos`, `equipos_componentes`, `equipos_tipos`, `sectores` | admin · 300s |
| `/api/mantenimiento/fotos` | POST | sesión | `usuarios` | admin · 120s |
| `/api/mantenimiento/inventario` | GET, POST | sesión | `inventario_articulos` | zod |
| `/api/mantenimiento/mtbf` | GET | permiso de módulo · `puedeVerMantenimiento` | — | — |
| `/api/mantenimiento/operarios` | GET, POST, DELETE | permiso de módulo · `esAdminMantenimiento` | `operarios` | admin |
| `/api/mantenimiento/ordenes-servicio` | GET, PATCH | permiso de módulo · `puedeEditarMantenimiento` | `ordenes_servicio` | admin · planilla |
| `/api/mantenimiento/ordenes-servicio/sync` | POST | permiso de módulo · `puedeEditarMantenimiento` | — | 300s |
| `/api/mantenimiento/ordenes/[id]/calendario` | GET, POST | permiso de módulo · `puedeEditarMantenimiento` | `agenda_eventos`, `agenda_invitados`, `ordenes_trabajo` | admin · zod |
| `/api/mantenimiento/ordenes/[id]/gut` | PATCH | permiso de módulo · `puedeEditarMantenimiento` | `ordenes_trabajo` | admin · audita · zod |
| `/api/mantenimiento/ordenes/[id]/notas` | GET, POST, DELETE | permiso de módulo · `puedeVerMantenimiento` | `ordenes_trabajo`, `ordenes_trabajo_notas` | admin |
| `/api/mantenimiento/ordenes/[id]/postergar` | POST | permiso de módulo · `puedeEditarMantenimiento` | `ordenes_trabajo`, `ordenes_trabajo_notas`, `usuarios` | admin · audita |
| `/api/mantenimiento/ordenes/[id]/repuestos` | GET, POST, DELETE | permiso de módulo · `puedeEditarMantenimiento` | `compras_requerimientos`, `ordenes_trabajo_repuestos` | admin |
| `/api/mantenimiento/ordenes/justificadas` | GET | permiso de módulo · `puedeVerMantenimiento` | `ordenes_trabajo_notas` | — |
| `/api/mantenimiento/ordenes/link` | POST | permiso de módulo · `puedeEditarMantenimiento` | `ordenes_trabajo` | admin |
| `/api/mantenimiento/ordenes/orden` | POST, DELETE | permiso de módulo · `puedeEditarMantenimiento` | `ordenes_trabajo` | admin |
| `/api/mantenimiento/ordenes/reutilizar` | GET | sesión | `ordenes_trabajo`, `ordenes_trabajo_repuestos` | — |
| `/api/mantenimiento/ordenes` | GET, POST, PATCH | permiso de módulo · `puedeEditarMantenimiento` | `ordenes_trabajo`, `ordenes_trabajo_repuestos`, `usuarios` | admin · zod · 300s |
| `/api/mantenimiento/ordenes/sync` | POST | permiso de módulo · `puedeEditarMantenimiento` | — | 300s |
| `/api/mantenimiento/partes-contratista/generar` | POST | permiso de módulo · `puedeEditarMantenimiento` | `equipos`, `mant_partes_contratista_renglones`, `ordenes_trabajo`, `proveedores`, `sectores` | admin · 300s |
| `/api/mantenimiento/partes-contratista` | GET, POST, PUT, DELETE | permiso de módulo · `puedeEditarMantenimiento` | `mant_contratista_lugares`, `mant_partes_contratista`, `mant_partes_contratista_renglones` | admin · paginado |
| `/api/mantenimiento/personal` | GET, POST, PATCH, DELETE | permiso de módulo · `esAdminMantenimiento` | `mant_personal_taller`, `usuarios` | admin · audita |
| `/api/mantenimiento/planificacion/[id]/calendario` | POST | permiso de módulo · `puedeEditarMantenimiento` | `agenda_eventos`, `agenda_invitados`, `ordenes_trabajo`, `planificacion_diaria`, `planificacion_diaria_items` | admin · zod · 300s |
| `/api/mantenimiento/planificacion/[id]/operarios` | GET, POST, DELETE | permiso de módulo · `puedeEditarMantenimiento` | `planificacion_diaria_operarios` | — |
| `/api/mantenimiento/planificacion/[id]` | GET, PATCH, DELETE | permiso de módulo · `puedeEditarMantenimiento` | `planificacion_diaria`, `planificacion_diaria_items` | — |
| `/api/mantenimiento/planificacion` | GET, POST | permiso de módulo · `puedeEditarMantenimiento` | `planificacion_diaria` | — |
| `/api/mantenimiento/produccion` | GET, PUT | permiso de módulo · `puedeEditarMantenimiento` | `produccion_semanal` | admin |
| `/api/mantenimiento/programacion/pisadas` | POST, DELETE | permiso de módulo · `esAdminMantenimiento` | `mant_personal_taller`, `mant_programacion_pisadas` | admin |
| `/api/mantenimiento/programacion/referencia` | GET, POST, PUT | permiso de módulo · `esAdminMantenimiento` | `empleados`, `mant_personal_taller`, `mant_programacion_referencia`, `usuarios` | admin · audita · paginado |
| `/api/mantenimiento/programacion` | GET | permiso de módulo · `esAdminMantenimiento` | `ausencias`, `francos`, `mant_personal_taller`, `mant_programacion_pisadas`, `mant_programacion_referencia` | admin |
| `/api/mantenimiento/proveedores` | GET, POST, DELETE | permiso de módulo · `puedeEditarMantenimiento` | `proveedores` | admin |
| `/api/mantenimiento/proveedores/sueltos` | GET, POST | permiso de módulo · `puedeVerMantenimiento` | `proveedores` | admin |
| `/api/mantenimiento/razones-postergacion` | GET, PATCH | permiso de módulo · `puedeVerMantenimiento` | `mant_razones_de_postergacion` | admin |
| `/api/mantenimiento/sectores/status` | PATCH | permiso de módulo · `puedeEditarMantenimiento` | `sectores`, `sectores_status_log` | admin |
| `/api/mantenimiento/sheets/webhook` | POST | secreto propio · `SHEETS_WEBHOOK_SECRET` | — | 300s |
| `/api/mantenimiento/tareas-preventivas` | GET, POST, DELETE | permiso de módulo · `puedeEditarMantenimiento` | `equipos_componentes`, `mant_tareas_preventivas`, `ordenes_trabajo` | admin |
| `/api/mantenimiento/tarifa-hora` | GET, POST, DELETE | permiso de módulo · `esAdminMantenimiento` | `mantenimiento_tarifas_hora` | admin |
| `/api/mantenimiento/tipos` | GET, PATCH, POST | permiso de módulo · `esAdminMantenimiento` | `equipos_tipos` | admin |

## mensajes (3)

| Ruta | Métodos | Guarda | Tablas | Marcas |
|---|---|---|---|---|
| `/api/mensajes/destinatarios` | GET | permiso de módulo · `puedeVerlo` | — | admin · zod |
| `/api/mensajes/mios` | GET, PATCH | sesión | `mensajes_menciones` | admin · zod |
| `/api/mensajes` | GET, POST | permiso de módulo · `puedeVerlo` | `mensajes`, `mensajes_menciones`, `usuarios` | admin · zod · 60s |

## mi-cuenta (1)

| Ruta | Métodos | Guarda | Tablas | Marcas |
|---|---|---|---|---|
| `/api/mi-cuenta/password` | POST | sesión | — | — |

## odoo (3)

| Ruta | Métodos | Guarda | Tablas | Marcas |
|---|---|---|---|---|
| `/api/odoo/ping` | GET | permiso de módulo · `es_admin_check` | — | 60s |
| `/api/odoo/proveedores/enlazar` | POST | permiso de módulo · `es_admin_check` | `empresas`, `proveedores`, `proveedores_odoo` | admin · 120s |
| `/api/odoo/proveedores/preview` | GET | permiso de módulo · `es_admin_check` | `proveedores` | 60s |

## produccion (5)

| Ruta | Métodos | Guarda | Tablas | Marcas |
|---|---|---|---|---|
| `/api/produccion/molinos/importar` | POST | permiso de módulo · `puedeEditarProduccion` | — | admin · 300s |
| `/api/produccion/molinos/paradas` | POST, PATCH, DELETE | permiso de módulo · `puedeEditarProduccion` | `produccion_molino_paradas` | zod |
| `/api/produccion/partes` | POST | permiso de módulo · `puedeEditarProduccion` | `empleados`, `produccion_deposito`, `produccion_despachos`, `produccion_partes`, `produccion_renglones_papel` | admin |
| `/api/produccion/planilla/reintentar` | POST | permiso de módulo · `puedeEditarProduccion` | `produccion_partes` | admin |
| `/api/produccion/productos` | GET, POST, PATCH, PUT | permiso de módulo · `tieneAccesoProduccion` | `produccion_renglon_productos`, `produccion_renglones_papel` | admin |

## push (1)

| Ruta | Métodos | Guarda | Tablas | Marcas |
|---|---|---|---|---|
| `/api/push/suscripcion` | GET, POST, DELETE | sesión | `push_suscripciones` | — |

## remises (30)

| Ruta | Métodos | Guarda | Tablas | Marcas |
|---|---|---|---|---|
| `/api/remises/asistencia` | GET, POST | el proxy | `remises_asistencia` | — |
| `/api/remises/asistencia/seed-default` | POST | el proxy | `empleados`, `remises_asistencia` | — |
| `/api/remises/choferes/[id]` | PUT, DELETE | el proxy | `choferes` | — |
| `/api/remises/choferes` | GET, POST | el proxy | `choferes` | — |
| `/api/remises/configuracion` | GET, PUT | permiso de módulo · `es_admin_check` | `remises_config` | — |
| `/api/remises/empleados/[id]/cuenta` | GET, POST | permiso de módulo · `es_admin_check` | `empleados`, `usuarios` | admin |
| `/api/remises/empleados/[id]` | PUT | el proxy | `remises_empleados_datos` | zod |
| `/api/remises/empleados` | GET | el proxy | `empleados` | — |
| `/api/remises/export` | GET | el proxy | `hojas_ruta` | — |
| `/api/remises/generar` | POST | el proxy | — | — |
| `/api/remises/geocode` | POST | el proxy | `remises_config` | — |
| `/api/remises/historial/reutilizar` | POST | el proxy | `hojas_ruta` | — |
| `/api/remises/historial` | GET | el proxy | `hojas_ruta` | — |
| `/api/remises/hojas-ruta/[id]/asientos/[empleadoId]` | DELETE, PATCH | el proxy | `asientos` | — |
| `/api/remises/hojas-ruta/[id]/asientos` | POST, PUT | el proxy | `asientos` | — |
| `/api/remises/hojas-ruta/[id]` | PUT, DELETE | el proxy | `hojas_ruta` | zod |
| `/api/remises/hojas-ruta` | GET, POST | el proxy | `hojas_ruta` | — |
| `/api/remises/mi-remis` | GET | sesión | `asientos`, `hojas_ruta`, `usuarios` | — |
| `/api/remises/plan-semana/generar` | POST | el proxy | `remises_asistencia`, `remises_plan_semana` | — |
| `/api/remises/plan-semana` | GET, POST | el proxy | `remises_plan_semana` | — |
| `/api/remises/plan-semana/seleccionar-todos` | POST | el proxy | `remises_empleados_datos`, `remises_plan_semana` | paginado |
| `/api/remises/plantillas/[id]/aplicar` | POST | el proxy | `remises_plantillas` | — |
| `/api/remises/plantillas/[id]` | DELETE | el proxy | `remises_plantillas` | — |
| `/api/remises/plantillas` | GET, POST | el proxy | `hojas_ruta`, `remises_plantillas`, `remises_plantillas_grupos` | — |
| `/api/remises/turnos/[id]` | PUT, DELETE | permiso de módulo · `es_admin_check` | `hojas_ruta`, `remises_plantillas`, `remises_turnos` | — |
| `/api/remises/turnos` | GET, POST | permiso de módulo · `es_admin_check` | `remises_turnos` | — |
| `/api/remises/vehiculos/[id]` | PUT, DELETE | el proxy | `hojas_ruta`, `vehiculos` | — |
| `/api/remises/vehiculos/import` | POST | el proxy | `choferes`, `vehiculos` | — |
| `/api/remises/vehiculos` | GET, POST | el proxy | `vehiculos` | — |
| `/api/remises/vehiculos/template` | GET | el proxy | — | — |

## rrhh (54)

| Ruta | Métodos | Guarda | Tablas | Marcas |
|---|---|---|---|---|
| `/api/rrhh/analitico/ausentismo-por-mes` | GET | el proxy | `calculos_diarios`, `empleados` | — |
| `/api/rrhh/analitico/por-antiguedad` | GET | el proxy | `empleados` | — |
| `/api/rrhh/analitico/por-empresa` | GET | el proxy | `empleados` | — |
| `/api/rrhh/analitico/por-genero` | GET | el proxy | `empleados` | — |
| `/api/rrhh/analitico/resumen` | GET | el proxy | — | — |
| `/api/rrhh/asistencia/dia` | GET | el proxy | `calculos_diarios`, `empleados`, `fichadas` | — |
| `/api/rrhh/asistencia/empleado/[id]/export` | GET | el proxy | `empleados` | — |
| `/api/rrhh/asistencia/empleado/[id]` | GET | el proxy | — | — |
| `/api/rrhh/asistencia/faltas-sin-clasificar` | GET | el proxy | `calculos_diarios` | — |
| `/api/rrhh/asistencia/horas-manual` | PUT | permiso de módulo · `es_admin_check` | `calculos_diarios` | admin |
| `/api/rrhh/asistencia/resumen` | GET | el proxy | `calculos_diarios`, `empleados` | — |
| `/api/rrhh/asistencia/validar` | PUT | permiso de módulo · `es_admin_check` | `calculos_diarios` | admin |
| `/api/rrhh/ausencias/[id]` | PUT, DELETE | sesión | `ausencias`, `usuarios` | audita · zod |
| `/api/rrhh/ausencias/export` | GET | el proxy | `ausencias` | — |
| `/api/rrhh/ausencias` | GET, POST | sesión | `ausencias` | — |
| `/api/rrhh/configuracion` | GET, PUT | permiso de módulo · `es_admin_check` | `config_liquidacion` | — |
| `/api/rrhh/dashboard/detalle-hoy` | GET | el proxy | — | — |
| `/api/rrhh/dashboard/detalle-sector` | GET | el proxy | `calculos_diarios`, `empleados`, `sectores` | — |
| `/api/rrhh/dashboard/horas-extra-por-sector` | GET | el proxy | `calculos_diarios` | — |
| `/api/rrhh/dashboard/horas-por-sector` | GET | el proxy | `calculos_diarios` | — |
| `/api/rrhh/dashboard/resumen-hoy` | GET | el proxy | — | — |
| `/api/rrhh/dashboard/top-ausencias` | GET | el proxy | `calculos_diarios` | — |
| `/api/rrhh/dashboard/top-tardanzas` | GET | el proxy | `calculos_diarios` | — |
| `/api/rrhh/empleados/[id]` | GET, PUT, DELETE | permiso de módulo · `esAdminRrhh` | `ausencias`, `calculos_diarios`, `empleados`, `fichadas`, `francos`, `liquidaciones`, `rrhh_empleados_datos`, `vacaciones` | admin · zod |
| `/api/rrhh/empleados/import/confirm` | POST | permiso de módulo · `esAdminRrhh` | `empleados`, `empresas`, `rrhh_empleados_datos`, `sectores` | admin |
| `/api/rrhh/empleados/import/preview-sheet` | POST | permiso de módulo · `esAdminRrhh` | — | — |
| `/api/rrhh/empleados/import/preview` | POST | permiso de módulo · `esAdminRrhh` | — | — |
| `/api/rrhh/empleados` | POST | permiso de módulo · `esAdminRrhh` | `empleados`, `rrhh_empleados_datos` | admin |
| `/api/rrhh/feriados/[id]` | DELETE | permiso de módulo · `es_admin_check` | `feriados` | — |
| `/api/rrhh/feriados` | GET, POST | permiso de módulo · `es_admin_check` | `feriados` | — |
| `/api/rrhh/fichadas/[id]` | PUT, DELETE | sesión | `fichadas` | — |
| `/api/rrhh/fichadas/export` | GET | el proxy | `fichadas` | — |
| `/api/rrhh/fichadas/import/confirm` | POST | sesión | `empleados`, `fichadas`, `rrhh_import_batches` | admin |
| `/api/rrhh/fichadas/import/preview-sheet` | POST | el proxy | — | — |
| `/api/rrhh/fichadas/import/preview` | POST | sesión | — | — |
| `/api/rrhh/fichadas/lenox/sincronizar` | POST | sesión | — | zod · 300s |
| `/api/rrhh/fichadas` | GET, POST | sesión | `fichadas` | paginado |
| `/api/rrhh/francos/[id]` | PUT, DELETE | el proxy | `francos` | — |
| `/api/rrhh/francos/export` | GET | el proxy | `francos` | — |
| `/api/rrhh/francos` | GET | el proxy | `francos` | — |
| `/api/rrhh/horas-a-realizar` | GET, POST, PATCH | sesión | `rrhh_horas_a_realizar` | — |
| `/api/rrhh/jornadas/[id]` | PUT, DELETE | permiso de módulo · `es_admin_check` | `jornadas` | — |
| `/api/rrhh/jornadas` | GET, POST | permiso de módulo · `es_admin_check` | `jornadas` | — |
| `/api/rrhh/liquidaciones/[id]/cerrar` | PUT | permiso de módulo · `es_admin_check` | `liquidaciones`, `usuarios` | audita |
| `/api/rrhh/liquidaciones/[id]/export` | GET | permiso de módulo · `es_admin_check` | `liquidaciones` | — |
| `/api/rrhh/liquidaciones/[id]` | GET, DELETE | permiso de módulo · `es_admin_check` | `liquidaciones` | — |
| `/api/rrhh/liquidaciones/export-planilla` | GET | permiso de módulo · `es_admin_check` | — | — |
| `/api/rrhh/liquidaciones/generar` | POST | permiso de módulo · `es_admin_check` | `calculos_diarios`, `empleados`, `liquidaciones` | zod |
| `/api/rrhh/liquidaciones/planilla` | GET | permiso de módulo · `es_admin_check` | — | — |
| `/api/rrhh/liquidaciones` | GET | permiso de módulo · `es_admin_check` | `liquidaciones` | — |
| `/api/rrhh/vacaciones/[id]/balance` | GET | el proxy | `config_liquidacion`, `empleados`, `vacaciones` | — |
| `/api/rrhh/vacaciones/[id]` | PUT, DELETE | el proxy | `vacaciones` | zod |
| `/api/rrhh/vacaciones/export` | GET | el proxy | `vacaciones` | — |
| `/api/rrhh/vacaciones` | GET, POST | el proxy | `vacaciones` | — |

## seguridad-higiene (5)

| Ruta | Métodos | Guarda | Tablas | Marcas |
|---|---|---|---|---|
| `/api/seguridad-higiene/condiciones/[id]` | PATCH, GET | permiso de módulo · `nivelSyhDe` | `syh_condiciones`, `syh_fotos`, `usuarios` | audita · zod |
| `/api/seguridad-higiene/condiciones` | POST, GET | permiso de módulo · `puedeEditarSyh` | `syh_condiciones`, `syh_fotos`, `usuarios` | paginado · zod · 120s |
| `/api/seguridad-higiene/fotos/[id]` | DELETE | sesión | `syh_fotos`, `usuarios` | — |
| `/api/seguridad-higiene/fotos` | POST | permiso de módulo · `puedeEditarSyh` | `syh_condiciones`, `usuarios` | 120s |
| `/api/seguridad-higiene/peligros` | GET | permiso de módulo · `puedeEditarSyh` | `syh_peligros` | paginado |

## taller-vial (8)

| Ruta | Métodos | Guarda | Tablas | Marcas |
|---|---|---|---|---|
| `/api/taller-vial/cargas` | GET, POST | permiso de módulo · `tieneAccesoTallerVial` | `equipos`, `taller_vial_cargas` | — |
| `/api/taller-vial/estados` | GET, POST | permiso de módulo · `tieneAccesoTallerVial` | `equipos`, `taller_vial_estados_diarios` | — |
| `/api/taller-vial/informes/export` | GET | permiso de módulo · `tieneAccesoTallerVial` | — | — |
| `/api/taller-vial/inventario` | GET | permiso de módulo · `tieneAccesoTallerVial` | `equipos`, `inventario_articulos` | — |
| `/api/taller-vial/reparaciones` | GET, POST, DELETE | permiso de módulo · `tieneAccesoTallerVial` | `taller_vial_reparaciones` | — |
| `/api/taller-vial/repuestos` | GET, POST, DELETE | permiso de módulo · `puedeEditarTallerVial` | `inventario_articulos`, `taller_vial_repuestos_asignados` | — |
| `/api/taller-vial/services` | GET, POST, DELETE | permiso de módulo · `tieneAccesoTallerVial` | `taller_vial_services` | — |
| `/api/taller-vial/sync` | POST | permiso de módulo · `tieneAccesoTallerVial` | — | 60s |

## trituracion (3)

| Ruta | Métodos | Guarda | Tablas | Marcas |
|---|---|---|---|---|
| `/api/trituracion/informes/export` | GET | permiso de módulo · `tieneAccesoTrituracion` | — | — |
| `/api/trituracion/partes` | GET, POST, DELETE | permiso de módulo · `tieneAccesoTrituracion` | `trituracion_partes`, `trituracion_plantas` | — |
| `/api/trituracion/plantas` | GET, PATCH | permiso de módulo · `esAdminTrituracion` | `trituracion_plantas` | — |

## ventas (11)

| Ruta | Métodos | Guarda | Tablas | Marcas |
|---|---|---|---|---|
| `/api/ventas/actividades/[id]` | PATCH, DELETE | permiso de módulo · `puedeEditarVentas` | `ventas_actividades` | zod |
| `/api/ventas/actividades` | GET, POST | permiso de módulo · `tieneAccesoVentas` | `ventas_actividades` | paginado · zod |
| `/api/ventas/clientes/[id]` | GET, PATCH, DELETE | permiso de módulo · `tieneAccesoVentas` | `usuarios`, `ventas_actividades`, `ventas_clientes`, `ventas_contactos`, `ventas_oportunidades` | audita · zod |
| `/api/ventas/clientes/importar/confirmar` | POST | permiso de módulo · `puedeEditarVentas` | `ventas_clientes` | zod · 120s |
| `/api/ventas/clientes/importar/plantilla` | GET | permiso de módulo · `tieneAccesoVentas` | — | — |
| `/api/ventas/clientes/importar` | POST | permiso de módulo · `puedeEditarVentas` | `usuarios`, `ventas_clientes` | paginado · 120s |
| `/api/ventas/clientes` | GET, POST | permiso de módulo · `tieneAccesoVentas` | `ventas_actividades`, `ventas_clientes` | paginado · zod |
| `/api/ventas/contactos/[id]` | PATCH, DELETE | permiso de módulo · `puedeEditarVentas` | `ventas_contactos` | zod |
| `/api/ventas/contactos` | POST | permiso de módulo · `puedeEditarVentas` | `ventas_contactos` | zod |
| `/api/ventas/oportunidades/[id]` | PATCH, DELETE | permiso de módulo · `puedeEditarVentas` | `ventas_oportunidades` | audita · zod |
| `/api/ventas/oportunidades` | GET, POST | permiso de módulo · `tieneAccesoVentas` | `ventas_oportunidades` | paginado · zod |

## De qué módulos de `lib/` depende cada ruta

La otra mitad de «con qué está conectada»: una ruta que no nombra ninguna
tabla puede tocar seis a través de un módulo compartido.

| Ruta | Depende de |
|---|---|
| `/api/administracion/empresas/[id]` | `lib/core/cuerpo`, `lib/core/route-utils`, `lib/supabase/server` |
| `/api/administracion/empresas` | `lib/core/route-utils`, `lib/supabase/server` |
| `/api/administracion/sectores/[id]` | `lib/core/cuerpo`, `lib/core/route-utils`, `lib/core/sectores`, `lib/supabase/server` |
| `/api/administracion/sectores` | `lib/core/cuerpo`, `lib/core/paginado`, `lib/core/route-utils`, `lib/core/sectores`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/administracion/usuarios/[id]/areas` | `lib/core/cuerpo`, `lib/core/route-utils`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/administracion/usuarios/[id]/link-acceso` | `lib/core/auth-links`, `lib/core/route-utils`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/administracion/usuarios/[id]/modulos` | `lib/core/access`, `lib/core/auditoria`, `lib/core/cuerpo`, `lib/core/route-utils`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/administracion/usuarios/[id]` | `lib/core/cuerpo`, `lib/core/route-utils`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/administracion/usuarios` | `lib/core/auth-links`, `lib/core/cuerpo`, `lib/core/route-utils`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/agenda/eventos/[id]/destrabar` | `lib/agenda/cargar`, `lib/agenda/escribirEnGoogle`, `lib/agenda/pedido`, `lib/agenda/sesion`, `lib/core/validar`, `lib/supabase/server` |
| `/api/agenda/eventos/[id]` | `lib/agenda/cargar`, `lib/agenda/escribirEnGoogle`, `lib/agenda/evento`, `lib/agenda/invitados`, `lib/agenda/pedido`, `lib/agenda/sesion`, `lib/core/validar`, `lib/supabase/server` |
| `/api/agenda/eventos/[id]/visto` | `lib/agenda/cargar`, `lib/agenda/sesion`, `lib/supabase/server` |
| `/api/agenda/eventos` | `lib/agenda/cargar`, `lib/agenda/escribirEnGoogle`, `lib/agenda/evento`, `lib/agenda/invitados`, `lib/agenda/pedido`, `lib/agenda/sesion`, `lib/core/validar`, `lib/supabase/server` |
| `/api/agenda/google` | `lib/agenda/avisoDeDivergencia`, `lib/agenda/canales`, `lib/core/sincronizaciones`, `lib/supabase/admin` |
| `/api/asistente` | `lib/asistente/catalogo`, `lib/asistente/consulta`, `lib/asistente/documentos`, `lib/asistente/prompt`, `lib/asistente/urlDeCarga`, `lib/core/access`, `lib/core/cuerpo`, `lib/core/fechas`, `lib/core/types`, `lib/supabase/server` |
| `/api/buscar` | `lib/supabase/server` |
| `/api/calidad/carbonilleros` | `lib/calidad/auth`, `lib/calidad/consultas`, `lib/calidad/types`, `lib/core/cuerpo`, `lib/core/sesion`, `lib/supabase/server` |
| `/api/calidad/conteos` | `lib/calidad/auth`, `lib/calidad/consultas`, `lib/calidad/conteos`, `lib/calidad/espejo`, `lib/calidad/types`, `lib/core/cuerpo`, `lib/core/sesion`, `lib/supabase/server` |
| `/api/calidad/ensayos/curva/export` | `lib/calidad/auth`, `lib/calidad/ensayos/consultas`, `lib/calidad/ensayos/hojaDeLaCurva`, `lib/calidad/ensayos/imagenesDeLaHoja`, `lib/core/sesion`, `lib/core/xlsxExport`, `lib/supabase/server` |
| `/api/calidad/ensayos/limites` | `lib/calidad/auth`, `lib/calidad/ensayos/cuerpoDeLaMuestra`, `lib/calidad/ensayos/types`, `lib/core/cuerpo`, `lib/core/sesion`, `lib/supabase/server` |
| `/api/calidad/ensayos/muestras/[id]` | `lib/calidad/auth`, `lib/calidad/ensayos/cuerpoDeLaMuestra`, `lib/core/cuerpo`, `lib/core/sesion`, `lib/supabase/server` |
| `/api/calidad/ensayos/muestras` | `lib/calidad/auth`, `lib/calidad/ensayos/cuerpoDeLaMuestra`, `lib/core/cuerpo`, `lib/core/sesion`, `lib/supabase/server` |
| `/api/calidad/ensayos/productos` | `lib/calidad/auth`, `lib/calidad/ensayos/mallas`, `lib/calidad/ensayos/types`, `lib/core/cuerpo`, `lib/core/sesion`, `lib/supabase/server` |
| `/api/calidad/envases/movimientos` | `lib/calidad/auth`, `lib/calidad/envases/espejo`, `lib/supabase/server` |
| `/api/calidad/envases/sync` | `lib/calidad/auth`, `lib/calidad/envases/sincronizar`, `lib/supabase/server` |
| `/api/calidad/movimientos/[id]` | `lib/calidad/auth`, `lib/calidad/espejo`, `lib/calidad/movimientos`, `lib/calidad/types`, `lib/core/cuerpo`, `lib/core/sesion`, `lib/supabase/server` |
| `/api/calidad/movimientos` | `lib/calidad/auth`, `lib/calidad/espejo`, `lib/calidad/movimientos`, `lib/calidad/types`, `lib/core/cuerpo`, `lib/core/sesion`, `lib/supabase/server` |
| `/api/calidad/productos` | `lib/calidad/auth`, `lib/calidad/consultas`, `lib/core/cuerpo`, `lib/core/sesion`, `lib/supabase/server` |
| `/api/calidad/sincronizar` | `lib/calidad/auth`, `lib/calidad/desdeLaPlanilla`, `lib/calidad/sincronizar`, `lib/core/sesion`, `lib/core/sincronizaciones`, `lib/odoo/client`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/cantera/acarreo/sync` | `lib/cantera/auth`, `lib/cantera/importarAcarreo`, `lib/supabase/server` |
| `/api/cantera/acarreos` | `lib/cantera/acarreo`, `lib/cantera/auth`, `lib/cantera/consultas`, `lib/cantera/numero`, `lib/core/cuerpo`, `lib/supabase/server` |
| `/api/cantera/bochones/[codigo]/conciliacion` | `lib/cantera/auth`, `lib/cantera/consultas`, `lib/cantera/contratistas`, `lib/cantera/espejo`, `lib/cantera/odoo`, `lib/core/cuerpo`, `lib/odoo/client`, `lib/supabase/server` |
| `/api/cantera/bochones/[codigo]` | `lib/cantera/auth`, `lib/cantera/codigos`, `lib/cantera/consultas`, `lib/cantera/espejo`, `lib/cantera/numero`, `lib/core/cuerpo`, `lib/supabase/server` |
| `/api/cantera/bochones` | `lib/cantera/auth`, `lib/cantera/codigos`, `lib/cantera/consultas`, `lib/core/cuerpo`, `lib/supabase/server` |
| `/api/cantera/contratistas` | `lib/cantera/auth`, `lib/supabase/server` |
| `/api/cantera/cubicacion/material` | `lib/cantera/auth`, `lib/cantera/cubicacionPorMaterial`, `lib/core/cuerpo`, `lib/supabase/server` |
| `/api/cantera/cubicacion` | `lib/cantera/auth`, `lib/cantera/consultas`, `lib/cantera/numero`, `lib/core/cuerpo`, `lib/supabase/server` |
| `/api/cantera/destape` | `lib/cantera/auth`, `lib/cantera/consultas`, `lib/cantera/destape`, `lib/cantera/numero`, `lib/core/cuerpo`, `lib/supabase/server` |
| `/api/cantera/finanzas` | `lib/cantera/auth`, `lib/supabase/server` |
| `/api/cantera/fleteros` | `lib/cantera/auth`, `lib/cantera/consultas`, `lib/core/cuerpo`, `lib/supabase/server` |
| `/api/cantera/informes/export` | `lib/cantera/auth`, `lib/cantera/consultas`, `lib/cantera/informe`, `lib/supabase/server` |
| `/api/cantera/insumos` | `lib/cantera/auth`, `lib/cantera/consultas`, `lib/cantera/vocabulario`, `lib/core/cuerpo`, `lib/supabase/server` |
| `/api/cantera/tarifas-acarreo` | `lib/cantera/acarreo`, `lib/cantera/auth`, `lib/cantera/consultas`, `lib/core/cuerpo`, `lib/supabase/server` |
| `/api/cantera/voladuras/[codigo]/conciliacion` | `lib/cantera/auth`, `lib/cantera/consultas`, `lib/cantera/contratistas`, `lib/cantera/espejo`, `lib/cantera/odoo`, `lib/cantera/planilla`, `lib/core/cuerpo`, `lib/odoo/client`, `lib/supabase/server` |
| `/api/cantera/voladuras/[codigo]` | `lib/cantera/auth`, `lib/cantera/consultas`, `lib/cantera/espejo`, `lib/cantera/numero`, `lib/cantera/planilla`, `lib/cantera/vocabulario`, `lib/core/cuerpo`, `lib/supabase/server` |
| `/api/cantera/voladuras` | `lib/cantera/auth`, `lib/cantera/codigos`, `lib/cantera/consultas`, `lib/core/cuerpo`, `lib/supabase/server` |
| `/api/cantera/yacimientos` | `lib/cantera/auth`, `lib/cantera/consultas`, `lib/cantera/vocabulario`, `lib/core/cuerpo`, `lib/supabase/server` |
| `/api/compras/ajustes` | `lib/compras/ajustes`, `lib/compras/auth`, `lib/core/cuerpo`, `lib/core/validar`, `lib/supabase/server` |
| `/api/compras/aprobadores-os` | `lib/compras/auth`, `lib/mantenimiento/aprobacion`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/compras/aprobadores` | `lib/compras/auth`, `lib/compras/bandeja`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/compras/comparativas` | `lib/compras/auth`, `lib/compras/drive`, `lib/supabase/server` |
| `/api/compras/comparativas/vincular` | `lib/compras/auth`, `lib/compras/comparativa`, `lib/compras/drive`, `lib/compras/sheets`, `lib/compras/vincular`, `lib/core/paginado`, `lib/core/proveedores`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/compras/cotizaciones/[id]/elegir` | `lib/compras/aprobarCompra`, `lib/compras/auth`, `lib/compras/comparativa`, `lib/compras/dolar`, `lib/compras/drive`, `lib/compras/sheets`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/compras/cotizaciones/[id]` | `lib/compras/auth`, `lib/compras/comparativa`, `lib/compras/congelada`, `lib/compras/drive`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/compras/mi-area` | `lib/supabase/server` |
| `/api/compras/odoo/pendientes` | `lib/compras/auth`, `lib/compras/pendientesDeOdoo`, `lib/core/paginado`, `lib/odoo/client`, `lib/odoo/pushOrden`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/compras/proveedores/[id]` | `lib/compras/auth`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/compras/proveedores/importar` | `lib/compras/auth`, `lib/compras/importarProveedores`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/compras/proveedores` | `lib/compras/auth`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/compras/requerimientos/[id]/comparativa` | `lib/compras/auth`, `lib/compras/comparativa`, `lib/compras/congelada`, `lib/compras/drive`, `lib/compras/sheets`, `lib/core/proveedores`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/compras/requerimientos/[id]/cotizaciones` | `lib/compras/auth`, `lib/compras/comparativa`, `lib/compras/congelada`, `lib/compras/dolar`, `lib/compras/drive`, `lib/compras/sheets`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/compras/requerimientos/[id]/odoo/estado` | `lib/compras/auth`, `lib/compras/divergenciaDeOrden`, `lib/odoo/client`, `lib/odoo/estadoDeOrden`, `lib/odoo/ordenEnOdoo`, `lib/odoo/pdfDeOrden`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/compras/requerimientos/[id]/odoo/pdf` | `lib/compras/auth`, `lib/core/descarga`, `lib/odoo/client`, `lib/odoo/pdfDeOrden`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/compras/requerimientos/[id]/odoo` | `lib/compras/auth`, `lib/odoo/client`, `lib/odoo/pushOrden`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/compras/requerimientos/[id]` | `lib/compras/aprobarCompra`, `lib/compras/auth`, `lib/compras/comparativa`, `lib/compras/constants`, `lib/compras/denegacion`, `lib/compras/devolucion`, `lib/compras/registrarElPedido`, `lib/compras/seguimientoSheets`, `lib/compras/sheets`, `lib/compras/types`, `lib/core/auditoria`, `lib/core/fechas`, `lib/odoo/client`, `lib/odoo/pushOrden`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/compras/requerimientos` | `lib/compras/ajustes`, `lib/compras/auth`, `lib/compras/avisoDeAprobacion`, `lib/compras/constants`, `lib/compras/formulario`, `lib/compras/montoAlto`, `lib/compras/serieDeRi`, `lib/core/paginado`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/compras/sheets/opciones` | `lib/compras/sheets`, `lib/supabase/server` |
| `/api/compras/sheets/reintentar` | `lib/compras/auth`, `lib/compras/sheets`, `lib/supabase/server` |
| `/api/compras/sheets/sync` | `lib/compras/auth`, `lib/compras/avisoDeAprobacion`, `lib/compras/sheets`, `lib/supabase/server` |
| `/api/compras/sheets/webhook` | `lib/compras/avisoDeAprobacion`, `lib/compras/sheets` |
| `/api/compras/ubicaciones/[id]/fusionar` | `lib/compras/auth`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/compras/ubicaciones/[id]` | `lib/compras/auth`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/compras/ubicaciones` | `lib/compras/auth`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/cron/agenda` | `lib/agenda/canales`, `lib/agenda/reintentarPendientes`, `lib/core/cron`, `lib/core/sincronizaciones`, `lib/supabase/admin` |
| `/api/cron/avisos-diarios` | `lib/core/cron`, `lib/core/fechas`, `lib/core/paginado`, `lib/core/types`, `lib/core/webpush`, `lib/home/avisosDeUsuario`, `lib/home/fotoDeAvisos`, `lib/home/movimiento`, `lib/home/resumenDeAvisos`, `lib/supabase/admin` |
| `/api/cron/calidad-envases-bajada` | `lib/calidad/envases/bajada`, `lib/calidad/envases/sincronizar`, `lib/core/cron`, `lib/core/paginado`, `lib/core/sheets`, `lib/core/sincronizaciones`, `lib/supabase/admin` |
| `/api/cron/calidad-envases-sync` | `lib/calidad/envases/sincronizar`, `lib/core/cron` |
| `/api/cron/calidad-sync` | `lib/calidad/desdeLaPlanilla`, `lib/calidad/sincronizar`, `lib/core/cron`, `lib/core/sincronizaciones`, `lib/odoo/client`, `lib/supabase/admin` |
| `/api/cron/cantera-acarreo-sync` | `lib/cantera/importarAcarreo`, `lib/core/cron` |
| `/api/cron/compras-sync` | `lib/compras/avisoDeAprobacion`, `lib/compras/seguimientoSheets`, `lib/compras/sheets`, `lib/core/cron` |
| `/api/cron/facturacion-sync` | `lib/core/cron`, `lib/odoo/client`, `lib/odoo/sincronizarFacturas`, `lib/supabase/admin` |
| `/api/cron/inventario-sync` | `lib/core/cron`, `lib/inventario/sincronizar` |
| `/api/cron/mantenimiento-sync` | `lib/core/cron`, `lib/mantenimiento/sincronizar` |
| `/api/cron/produccion-molinos-sync` | `lib/core/cron`, `lib/produccion/molinos/sincronizar`, `lib/supabase/admin` |
| `/api/cron/remises-notificaciones` | `lib/core/cron`, `lib/core/fechas`, `lib/core/webpush`, `lib/supabase/admin` |
| `/api/cron/respaldo-sheets` | `lib/core/cron`, `lib/core/sincronizaciones`, `lib/respaldo/correr`, `lib/supabase/admin` |
| `/api/cron/rrhh-lenox-sync` | `lib/core/cron`, `lib/rrhh/dates`, `lib/rrhh/lenox/cliente`, `lib/rrhh/lenox/corrida`, `lib/rrhh/lenox/rango` |
| `/api/cron/rrhh-recalculo` | `lib/core/cron`, `lib/core/sincronizaciones`, `lib/rrhh/recalculoProgramado`, `lib/supabase/admin` |
| `/api/cron/syh-respaldo-de-fotos` | `lib/core/cron`, `lib/core/sincronizaciones`, `lib/seguridadHigiene/respaldoEnDrive`, `lib/supabase/admin` |
| `/api/cron/taller-vial-partes-sync` | `lib/core/cron`, `lib/tallerVial/importarPartes` |
| `/api/cron/taller-vial-sync` | `lib/core/cron`, `lib/tallerVial/importar` |
| `/api/despacho/importar` | `lib/core/cuerpo`, `lib/core/google`, `lib/core/sheets`, `lib/despacho/auth`, `lib/despacho/importar`, `lib/despacho/planilla`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/despacho/ordenes/[id]` | `lib/core/cuerpo`, `lib/core/productos`, `lib/despacho/auth`, `lib/despacho/clasificacion`, `lib/despacho/consultas`, `lib/despacho/espejo`, `lib/despacho/orden`, `lib/despacho/types`, `lib/supabase/server` |
| `/api/despacho/ordenes` | `lib/core/cuerpo`, `lib/core/fechas`, `lib/despacho/auth`, `lib/despacho/consultas`, `lib/supabase/server` |
| `/api/despacho/productos` | `lib/core/cuerpo`, `lib/core/productos`, `lib/core/types`, `lib/despacho/auth`, `lib/despacho/consultas`, `lib/supabase/server` |
| `/api/despacho/recepciones/[id]` | `lib/core/auditoria`, `lib/core/cuerpo`, `lib/despacho/auth`, `lib/despacho/espejoRecepcion`, `lib/despacho/pushRecepcion`, `lib/despacho/recepcion`, `lib/despacho/types`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/despacho/recepciones/proveedores` | `lib/core/cuerpo`, `lib/despacho/auth`, `lib/supabase/server` |
| `/api/despacho/recepciones` | `lib/core/cuerpo`, `lib/core/fechas`, `lib/despacho/auth`, `lib/despacho/consultas`, `lib/despacho/recepcion`, `lib/supabase/server` |
| `/api/despacho/remitos` | `lib/core/fechas`, `lib/despacho/auth`, `lib/despacho/consultas`, `lib/despacho/odoo`, `lib/odoo/client`, `lib/supabase/server` |
| `/api/disponibilidad/reportes` | `lib/core/fechas`, `lib/rrhh/ausentismo/armarReportes`, `lib/rrhh/ausentismo/lecturas`, `lib/rrhh/auth`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/disponibilidad` | `lib/core/fechas`, `lib/rrhh/ausentismo/disponibilidadPublica`, `lib/rrhh/ausentismo/lecturas`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/facturacion/correo` | `lib/core/cuerpo`, `lib/facturacion/auth`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/facturacion/correo/webhook` | `lib/facturacion/correoEntrante`, `lib/facturacion/textoDelPdfEnElServidor`, `lib/supabase/admin` |
| `/api/facturacion/facturas/[id]/lineas` | `lib/compras/equipoDelPedido`, `lib/compras/productoOdoo`, `lib/core/cuerpo`, `lib/facturacion/analiticaDelEquipo`, `lib/facturacion/auth`, `lib/facturacion/lineas`, `lib/facturacion/sugerirAnalitica`, `lib/facturacion/sugerirCuenta`, `lib/odoo/catalogo`, `lib/odoo/catalogoContable`, `lib/odoo/client`, `lib/odoo/emisor`, `lib/odoo/historialDeImputacion`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/facturacion/facturas/[id]/odoo/borrador` | `lib/core/auditoria`, `lib/core/cuerpo`, `lib/facturacion/auth`, `lib/odoo/borradorDeOdoo`, `lib/odoo/client`, `lib/odoo/pushFactura`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/facturacion/facturas/[id]/odoo` | `lib/core/cuerpo`, `lib/facturacion/auth`, `lib/odoo/client`, `lib/odoo/pushFactura`, `lib/odoo/sincronizarFacturas`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/facturacion/facturas/[id]` | `lib/core/cuerpo`, `lib/facturacion/aprenderElCuit`, `lib/facturacion/auth`, `lib/facturacion/types`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/facturacion/facturas` | `lib/compras/productoOdoo`, `lib/core/fechas`, `lib/core/paginado`, `lib/facturacion/altaDeFactura`, `lib/facturacion/auth`, `lib/facturacion/comprobante`, `lib/facturacion/consultas`, `lib/facturacion/laLineaQueSeRepite`, `lib/facturacion/lineaPorElTotal`, `lib/facturacion/lineas`, `lib/odoo/catalogo`, `lib/odoo/client`, `lib/odoo/emisor`, `lib/odoo/historialDeImputacion`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/facturacion/odoo/sincronizar` | `lib/facturacion/auth`, `lib/odoo/client`, `lib/odoo/sincronizarFacturas`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/home/avisos` | `lib/core/types`, `lib/home/avisosDeUsuario`, `lib/supabase/server` |
| `/api/home/resumen/descartar` | `lib/supabase/server` |
| `/api/home/resumen` | `lib/cantera/consultas`, `lib/cantera/tablero`, `lib/cantera/types`, `lib/core/access`, `lib/core/fechas`, `lib/core/paginado`, `lib/core/types`, `lib/home/consultas`, `lib/home/ritmo`, `lib/home/tarjetaRrhh`, `lib/supabase/server` |
| `/api/inventario/articulos/[id]` | `lib/inventario/auth`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/inventario/articulos` | `lib/core/fechas`, `lib/inventario/reponer`, `lib/supabase/server` |
| `/api/inventario/lista/[id]` | `lib/inventario/auth`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/inventario/lista` | `lib/inventario/auth`, `lib/inventario/catalogos`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/inventario/movimientos` | `lib/core/auditoria`, `lib/inventario/auth`, `lib/inventario/espejo`, `lib/inventario/movimiento`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/inventario/reservas-taller-vial/[id]` | `lib/inventario/auth`, `lib/supabase/server` |
| `/api/inventario/reservas-taller-vial` | `lib/inventario/auth`, `lib/supabase/server` |
| `/api/inventario/sync` | `lib/inventario/auth`, `lib/inventario/sincronizar`, `lib/supabase/server` |
| `/api/mantenimiento/ausencias` | `lib/core/auditoria`, `lib/core/cuerpo`, `lib/core/fechas`, `lib/core/paginado`, `lib/mantenimiento/auth`, `lib/mantenimiento/disponibilidad`, `lib/mantenimiento/programacion`, `lib/rrhh/altaDeAusencia`, `lib/rrhh/engine/recalcular`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/mantenimiento/avisos/desestimar` | `lib/core/cuerpo`, `lib/core/fechas`, `lib/mantenimiento/auth`, `lib/mantenimiento/avisos`, `lib/mantenimiento/desestimarAviso`, `lib/mantenimiento/pendienteDelAviso`, `lib/mantenimiento/planillaDelAviso`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/mantenimiento/avisos/enlazar` | `lib/core/cuerpo`, `lib/mantenimiento/auth`, `lib/mantenimiento/avisos`, `lib/mantenimiento/enlazarOtAlAviso`, `lib/mantenimiento/marcarElAviso`, `lib/mantenimiento/pendienteDelAviso`, `lib/mantenimiento/planillaDelAviso`, `lib/mantenimiento/reutilizarOT`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/mantenimiento/avisos` | `lib/compras/areaDelUsuario`, `lib/core/fechas`, `lib/core/sheets`, `lib/mantenimiento/avisarDeLaCarga`, `lib/mantenimiento/avisos`, `lib/mantenimiento/claveDeCarga`, `lib/mantenimiento/enlaces`, `lib/mantenimiento/planilla`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/mantenimiento/avisos/sync` | `lib/mantenimiento/auth`, `lib/mantenimiento/sincronizar`, `lib/supabase/server` |
| `/api/mantenimiento/calendario` | `lib/core/fechas`, `lib/core/paginado`, `lib/mantenimiento/auth`, `lib/mantenimiento/calendarioDeOT`, `lib/mantenimiento/disponibilidad`, `lib/mantenimiento/genteDelDia`, `lib/mantenimiento/programacion`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/mantenimiento/ciclos/[id]/reiniciar` | `lib/core/fechas`, `lib/mantenimiento/auth`, `lib/mantenimiento/cierreDeOT`, `lib/mantenimiento/notas`, `lib/mantenimiento/ordenes`, `lib/mantenimiento/pendienteDeLaOT`, `lib/mantenimiento/planillaDeOT`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/mantenimiento/ciclos/[id]` | `lib/core/cuerpo`, `lib/mantenimiento/arranqueDelCiclo`, `lib/mantenimiento/auth`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/mantenimiento/comparativas` | `lib/core/fechas`, `lib/core/sheets`, `lib/mantenimiento/auth`, `lib/mantenimiento/comparativas`, `lib/mantenimiento/enlaces`, `lib/mantenimiento/planilla`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/mantenimiento/comparativas/sync` | `lib/mantenimiento/auth`, `lib/mantenimiento/sincronizar`, `lib/supabase/server` |
| `/api/mantenimiento/cuaderno/excel` | `lib/core/paginado`, `lib/mantenimiento/auth`, `lib/mantenimiento/cuadernoEnganche`, `lib/mantenimiento/cuadernoExcelArchivo`, `lib/mantenimiento/cuadernoOrigen`, `lib/mantenimiento/partesDeContratista`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/mantenimiento/cuaderno/fotos` | `lib/core/paginado`, `lib/mantenimiento/auth`, `lib/mantenimiento/cuadernoEnganche`, `lib/mantenimiento/cuadernoLectura`, `lib/mantenimiento/cuadernoOrigen`, `lib/mantenimiento/partesDeContratista`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/mantenimiento/cuaderno/generar` | `lib/agenda/alNacerLaOT`, `lib/core/cuerpo`, `lib/core/paginado`, `lib/mantenimiento/auth`, `lib/mantenimiento/cierreDeOT`, `lib/mantenimiento/cuadernoEstado`, `lib/mantenimiento/cuadernoGrupos`, `lib/mantenimiento/cuadernoOrden`, `lib/mantenimiento/formulario`, `lib/mantenimiento/ordenes`, `lib/mantenimiento/planillaDeOT`, `lib/mantenimiento/prioridad`, `lib/mantenimiento/reintentoDePendientes`, `lib/mantenimiento/sincronizar`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/mantenimiento/cuaderno/renglones/[id]` | `lib/core/auditoria`, `lib/core/paginado`, `lib/mantenimiento/auth`, `lib/mantenimiento/cuadernoEstado`, `lib/mantenimiento/cuadernoGrupos`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/mantenimiento/cuaderno/renglones` | `lib/core/cuerpo`, `lib/core/paginado`, `lib/mantenimiento/auth`, `lib/mantenimiento/cuadernoGrupos`, `lib/mantenimiento/partesDeContratista`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/mantenimiento/cuaderno/repetidos` | `lib/core/cuerpo`, `lib/core/paginado`, `lib/mantenimiento/auth`, `lib/mantenimiento/cuadernoRepetidos`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/mantenimiento/cuaderno` | `lib/core/cuerpo`, `lib/core/paginado`, `lib/mantenimiento/auth`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/mantenimiento/ejecuciones` | `lib/core/cuerpo`, `lib/core/fechas`, `lib/mantenimiento/vencimiento`, `lib/supabase/server` |
| `/api/mantenimiento/equipos-y-sectores` | `lib/core/paginado`, `lib/mantenimiento/sectores`, `lib/supabase/server` |
| `/api/mantenimiento/equipos/[id]/componentes` | `lib/mantenimiento/auth`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/mantenimiento/equipos/[id]/repuestos` | `lib/mantenimiento/auth`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/mantenimiento/equipos/[id]` | `lib/core/cuerpo`, `lib/mantenimiento/auth`, `lib/mantenimiento/ficha`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/mantenimiento/equipos/export` | `lib/core/fechas`, `lib/core/xlsxExport`, `lib/supabase/server` |
| `/api/mantenimiento/equipos/import` | `lib/core/excel`, `lib/core/paginado`, `lib/mantenimiento/auth`, `lib/mantenimiento/ficha`, `lib/mantenimiento/importacion`, `lib/mantenimiento/inventario`, `lib/mantenimiento/planilla`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/mantenimiento/fotos` | `lib/supabase/admin`, `lib/supabase/server` |
| `/api/mantenimiento/inventario` | `lib/core/cuerpo`, `lib/core/paginado`, `lib/core/validar`, `lib/mantenimiento/stock`, `lib/supabase/server` |
| `/api/mantenimiento/mtbf` | `lib/mantenimiento/alertas`, `lib/mantenimiento/auth`, `lib/mantenimiento/mtbfDatos`, `lib/supabase/server` |
| `/api/mantenimiento/operarios` | `lib/mantenimiento/auth`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/mantenimiento/ordenes-servicio` | `lib/compras/auth`, `lib/core/sheets`, `lib/mantenimiento/aprobacion`, `lib/mantenimiento/auth`, `lib/mantenimiento/denegacion`, `lib/mantenimiento/os`, `lib/mantenimiento/pendienteDeLaOS`, `lib/mantenimiento/planillaDeOS`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/mantenimiento/ordenes-servicio/sync` | `lib/mantenimiento/auth`, `lib/mantenimiento/sincronizar`, `lib/supabase/server` |
| `/api/mantenimiento/ordenes/[id]/calendario` | `lib/agenda/duenoDeLaOT`, `lib/agenda/evento`, `lib/agenda/mandarLaOT`, `lib/agenda/pedido`, `lib/agenda/sesion`, `lib/core/calendar`, `lib/core/validar`, `lib/mantenimiento/auth`, `lib/mantenimiento/programacion`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/mantenimiento/ordenes/[id]/gut` | `lib/core/validar`, `lib/mantenimiento/auth`, `lib/mantenimiento/gut`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/mantenimiento/ordenes/[id]/notas` | `lib/mantenimiento/auth`, `lib/mantenimiento/notas`, `lib/mantenimiento/planillaDeOT`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/mantenimiento/ordenes/[id]/postergar` | `lib/core/auditoria`, `lib/core/cuerpo`, `lib/mantenimiento/auth`, `lib/mantenimiento/formulario`, `lib/mantenimiento/notas`, `lib/mantenimiento/planillaDeOT`, `lib/mantenimiento/postergar`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/mantenimiento/ordenes/[id]/repuestos` | `lib/core/paginado`, `lib/mantenimiento/auth`, `lib/mantenimiento/riDelRepuesto`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/mantenimiento/ordenes/justificadas` | `lib/mantenimiento/auth`, `lib/supabase/server` |
| `/api/mantenimiento/ordenes/link` | `lib/core/cuerpo`, `lib/mantenimiento/auth`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/mantenimiento/ordenes/orden` | `lib/mantenimiento/auth`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/mantenimiento/ordenes/reutilizar` | `lib/supabase/server` |
| `/api/mantenimiento/ordenes` | `lib/agenda/alNacerLaOT`, `lib/core/cuerpo`, `lib/core/fechas`, `lib/core/paginado`, `lib/core/validar`, `lib/mantenimiento/altaDeOT`, `lib/mantenimiento/auth`, `lib/mantenimiento/avisarDeLaCarga`, `lib/mantenimiento/avisos`, `lib/mantenimiento/cierreAnteriorAlInicio`, `lib/mantenimiento/cierreDeOT`, `lib/mantenimiento/claveDeCarga`, `lib/mantenimiento/fallas`, `lib/mantenimiento/filtrosOt`, `lib/mantenimiento/formulario`, `lib/mantenimiento/gut`, `lib/mantenimiento/marcarElAviso`, `lib/mantenimiento/ordenes`, `lib/mantenimiento/pendienteDeLaOT`, `lib/mantenimiento/planillaDeOT`, `lib/mantenimiento/prioridad`, `lib/mantenimiento/reintentoDePendientes`, `lib/mantenimiento/repuestosDeLaOT`, `lib/mantenimiento/sincronizar`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/mantenimiento/ordenes/sync` | `lib/mantenimiento/auth`, `lib/mantenimiento/sincronizar`, `lib/supabase/server` |
| `/api/mantenimiento/partes-contratista/generar` | `lib/agenda/alNacerLaOT`, `lib/core/cuerpo`, `lib/core/paginado`, `lib/mantenimiento/auth`, `lib/mantenimiento/cierreDeOT`, `lib/mantenimiento/formulario`, `lib/mantenimiento/ordenes`, `lib/mantenimiento/partesDeContratista`, `lib/mantenimiento/planillaDeOT`, `lib/mantenimiento/prioridad`, `lib/mantenimiento/reintentoDePendientes`, `lib/mantenimiento/sincronizar`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/mantenimiento/partes-contratista` | `lib/core/cuerpo`, `lib/core/paginado`, `lib/mantenimiento/auth`, `lib/mantenimiento/partesDeContratista`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/mantenimiento/personal` | `lib/core/auditoria`, `lib/core/fechas`, `lib/mantenimiento/auth`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/mantenimiento/planificacion/[id]/calendario` | `lib/agenda/evento`, `lib/agenda/mandarLaOT`, `lib/agenda/sesion`, `lib/core/fechas`, `lib/core/paginado`, `lib/core/validar`, `lib/mantenimiento/auth`, `lib/mantenimiento/planAlCalendario`, `lib/mantenimiento/programacion`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/mantenimiento/planificacion/[id]/operarios` | `lib/core/cuerpo`, `lib/mantenimiento/auth`, `lib/mantenimiento/operariosDelParte`, `lib/supabase/server` |
| `/api/mantenimiento/planificacion/[id]` | `lib/core/cuerpo`, `lib/mantenimiento/auth`, `lib/supabase/server` |
| `/api/mantenimiento/planificacion` | `lib/core/cuerpo`, `lib/mantenimiento/auth`, `lib/supabase/server` |
| `/api/mantenimiento/produccion` | `lib/mantenimiento/auth`, `lib/mantenimiento/produccion`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/mantenimiento/programacion/pisadas` | `lib/core/fechas`, `lib/mantenimiento/auth`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/mantenimiento/programacion/referencia` | `lib/core/auditoria`, `lib/core/cuerpo`, `lib/core/fechas`, `lib/mantenimiento/auth`, `lib/mantenimiento/disponibilidad`, `lib/mantenimiento/programacion`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/mantenimiento/programacion` | `lib/core/fechas`, `lib/core/paginado`, `lib/mantenimiento/auth`, `lib/mantenimiento/disponibilidad`, `lib/mantenimiento/programacion`, `lib/mantenimiento/referenciaDelTaller`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/mantenimiento/proveedores` | `lib/core/paginado`, `lib/core/proveedores`, `lib/mantenimiento/auth`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/mantenimiento/proveedores/sueltos` | `lib/core/paginado`, `lib/core/proveedores`, `lib/mantenimiento/auth`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/mantenimiento/razones-postergacion` | `lib/core/cuerpo`, `lib/mantenimiento/auth`, `lib/mantenimiento/postergar`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/mantenimiento/sectores/status` | `lib/core/cuerpo`, `lib/mantenimiento/auth`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/mantenimiento/sheets/webhook` | `lib/mantenimiento/sincronizar` |
| `/api/mantenimiento/tareas-preventivas` | `lib/core/cuerpo`, `lib/core/fechas`, `lib/core/paginado`, `lib/mantenimiento/auth`, `lib/mantenimiento/catalogoConfirmado`, `lib/mantenimiento/tareasPreventivas`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/mantenimiento/tarifa-hora` | `lib/mantenimiento/auth`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/mantenimiento/tipos` | `lib/mantenimiento/auth`, `lib/mantenimiento/ficha`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/mensajes/destinatarios` | `lib/core/correo`, `lib/core/validar`, `lib/mensajes/entidades`, `lib/mensajes/pedidos`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/mensajes/mios` | `lib/core/mensajes`, `lib/core/paginado`, `lib/core/validar`, `lib/mensajes/avisos`, `lib/mensajes/entidades`, `lib/mensajes/menciones`, `lib/mensajes/pedidos`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/mensajes` | `lib/core/auth-links`, `lib/core/correo`, `lib/core/mensajes`, `lib/core/paginado`, `lib/core/validar`, `lib/mensajes/avisos`, `lib/mensajes/entidades`, `lib/mensajes/forma`, `lib/mensajes/pedidos`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/mi-cuenta/password` | `lib/core/cuerpo`, `lib/supabase/server` |
| `/api/odoo/ping` | `lib/core/route-utils`, `lib/odoo/client`, `lib/supabase/server` |
| `/api/odoo/proveedores/enlazar` | `lib/core/paginado`, `lib/core/route-utils`, `lib/odoo/client`, `lib/odoo/proveedores`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/odoo/proveedores/preview` | `lib/core/paginado`, `lib/core/route-utils`, `lib/odoo/client`, `lib/odoo/proveedores`, `lib/supabase/server` |
| `/api/produccion/molinos/importar` | `lib/produccion/auth`, `lib/produccion/molinos/sincronizar`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/produccion/molinos/paradas` | `lib/core/cuerpo`, `lib/core/validar`, `lib/mantenimiento/auth`, `lib/produccion/auth`, `lib/produccion/molinos/paradas`, `lib/supabase/server` |
| `/api/produccion/partes` | `lib/core/cuerpo`, `lib/core/paginado`, `lib/inventario/enlaces`, `lib/produccion/auth`, `lib/produccion/cantidades`, `lib/produccion/consultas`, `lib/produccion/espejo`, `lib/produccion/turnos`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/produccion/planilla/reintentar` | `lib/core/cuerpo`, `lib/produccion/auth`, `lib/produccion/consultas`, `lib/produccion/espejo`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/produccion/productos` | `lib/core/cuerpo`, `lib/produccion/auth`, `lib/produccion/consultas`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/push/suscripcion` | `lib/core/cuerpo`, `lib/supabase/server` |
| `/api/remises/asistencia` | `lib/core/cuerpo`, `lib/remises/route-utils`, `lib/supabase/server` |
| `/api/remises/asistencia/seed-default` | `lib/core/cuerpo`, `lib/remises/route-utils`, `lib/supabase/server` |
| `/api/remises/choferes/[id]` | `lib/core/cuerpo`, `lib/remises/route-utils`, `lib/supabase/server` |
| `/api/remises/choferes` | `lib/core/cuerpo`, `lib/remises/route-utils`, `lib/supabase/server` |
| `/api/remises/configuracion` | `lib/core/cuerpo`, `lib/remises/route-utils`, `lib/supabase/server` |
| `/api/remises/empleados/[id]/cuenta` | `lib/core/cuerpo`, `lib/remises/route-utils`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/remises/empleados/[id]` | `lib/core/cuerpo`, `lib/core/validar`, `lib/remises/route-utils`, `lib/supabase/server` |
| `/api/remises/empleados` | `lib/remises/route-utils`, `lib/supabase/server` |
| `/api/remises/export` | `lib/core/xlsxExport`, `lib/remises/exportRows`, `lib/remises/route-utils`, `lib/supabase/server` |
| `/api/remises/generar` | `lib/core/cuerpo`, `lib/remises/generarRutas`, `lib/remises/route-utils`, `lib/supabase/server` |
| `/api/remises/geocode` | `lib/core/cuerpo`, `lib/remises/engine/geocode`, `lib/remises/route-utils`, `lib/supabase/server` |
| `/api/remises/historial/reutilizar` | `lib/core/cuerpo`, `lib/remises/generarRutas`, `lib/remises/route-utils`, `lib/supabase/server` |
| `/api/remises/historial` | `lib/remises/route-utils`, `lib/supabase/server` |
| `/api/remises/hojas-ruta/[id]/asientos/[empleadoId]` | `lib/core/cuerpo`, `lib/remises/refrescarGeometria`, `lib/remises/route-utils`, `lib/supabase/server` |
| `/api/remises/hojas-ruta/[id]/asientos` | `lib/core/cuerpo`, `lib/remises/refrescarGeometria`, `lib/remises/route-utils`, `lib/supabase/server` |
| `/api/remises/hojas-ruta/[id]` | `lib/core/cuerpo`, `lib/core/validar`, `lib/remises/route-utils`, `lib/supabase/server` |
| `/api/remises/hojas-ruta` | `lib/core/cuerpo`, `lib/remises/generarRutas`, `lib/remises/route-utils`, `lib/supabase/server` |
| `/api/remises/mi-remis` | `lib/core/fechas`, `lib/supabase/server` |
| `/api/remises/plan-semana/generar` | `lib/core/cuerpo`, `lib/remises/generarRutas`, `lib/remises/route-utils`, `lib/supabase/server` |
| `/api/remises/plan-semana` | `lib/core/cuerpo`, `lib/remises/route-utils`, `lib/supabase/server` |
| `/api/remises/plan-semana/seleccionar-todos` | `lib/core/cuerpo`, `lib/core/paginado`, `lib/remises/route-utils`, `lib/supabase/server` |
| `/api/remises/plantillas/[id]/aplicar` | `lib/core/cuerpo`, `lib/remises/generarRutas`, `lib/remises/route-utils`, `lib/supabase/server` |
| `/api/remises/plantillas/[id]` | `lib/remises/route-utils`, `lib/supabase/server` |
| `/api/remises/plantillas` | `lib/core/cuerpo`, `lib/remises/route-utils`, `lib/supabase/server` |
| `/api/remises/turnos/[id]` | `lib/core/cuerpo`, `lib/remises/route-utils`, `lib/supabase/server` |
| `/api/remises/turnos` | `lib/core/cuerpo`, `lib/remises/route-utils`, `lib/supabase/server` |
| `/api/remises/vehiculos/[id]` | `lib/core/cuerpo`, `lib/remises/route-utils`, `lib/supabase/server` |
| `/api/remises/vehiculos/import` | `lib/core/excel`, `lib/remises/route-utils`, `lib/supabase/server` |
| `/api/remises/vehiculos` | `lib/core/cuerpo`, `lib/remises/route-utils`, `lib/supabase/server` |
| `/api/remises/vehiculos/template` | `lib/core/xlsxExport`, `lib/remises/route-utils`, `lib/supabase/server` |
| `/api/rrhh/analitico/ausentismo-por-mes` | `lib/rrhh/constants`, `lib/rrhh/dashboardHelpers`, `lib/rrhh/dates`, `lib/rrhh/paginado`, `lib/rrhh/route-utils`, `lib/supabase/server` |
| `/api/rrhh/analitico/por-antiguedad` | `lib/rrhh/dates`, `lib/rrhh/route-utils`, `lib/supabase/server` |
| `/api/rrhh/analitico/por-empresa` | `lib/rrhh/route-utils`, `lib/supabase/server` |
| `/api/rrhh/analitico/por-genero` | `lib/rrhh/route-utils`, `lib/supabase/server` |
| `/api/rrhh/analitico/resumen` | `lib/rrhh/analiticoResumen`, `lib/rrhh/route-utils`, `lib/supabase/server` |
| `/api/rrhh/asistencia/dia` | `lib/rrhh/constants`, `lib/rrhh/dates`, `lib/rrhh/route-utils`, `lib/supabase/server` |
| `/api/rrhh/asistencia/empleado/[id]/export` | `lib/core/xlsxExport`, `lib/rrhh/asistenciaDeEmpleado`, `lib/rrhh/marcacionesDelMes`, `lib/rrhh/rangoPedido`, `lib/rrhh/route-utils`, `lib/supabase/server` |
| `/api/rrhh/asistencia/empleado/[id]` | `lib/rrhh/asistenciaDeEmpleado`, `lib/rrhh/rangoPedido`, `lib/rrhh/route-utils`, `lib/supabase/server` |
| `/api/rrhh/asistencia/faltas-sin-clasificar` | `lib/rrhh/route-utils`, `lib/supabase/server` |
| `/api/rrhh/asistencia/horas-manual` | `lib/core/cuerpo`, `lib/rrhh/engine/recalcular`, `lib/rrhh/route-utils`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/rrhh/asistencia/resumen` | `lib/rrhh/constants`, `lib/rrhh/paginado`, `lib/rrhh/route-utils`, `lib/supabase/server` |
| `/api/rrhh/asistencia/validar` | `lib/core/cuerpo`, `lib/rrhh/route-utils`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/rrhh/ausencias/[id]` | `lib/core/auditoria`, `lib/core/cuerpo`, `lib/core/validar`, `lib/rrhh/engine/recalcular`, `lib/rrhh/route-utils`, `lib/rrhh/tiposAusencia`, `lib/rrhh/vacacionesDeAusencia`, `lib/supabase/server` |
| `/api/rrhh/ausencias/export` | `lib/core/xlsxExport`, `lib/rrhh/route-utils`, `lib/rrhh/tiposAusencia`, `lib/supabase/server` |
| `/api/rrhh/ausencias` | `lib/core/cuerpo`, `lib/rrhh/altaDeAusencia`, `lib/rrhh/route-utils`, `lib/supabase/server` |
| `/api/rrhh/configuracion` | `lib/core/cuerpo`, `lib/rrhh/recalculoProgramado`, `lib/rrhh/route-utils`, `lib/supabase/server` |
| `/api/rrhh/dashboard/detalle-hoy` | `lib/rrhh/resumenHoy`, `lib/rrhh/route-utils`, `lib/supabase/server` |
| `/api/rrhh/dashboard/detalle-sector` | `lib/rrhh/constants`, `lib/rrhh/dashboardHelpers`, `lib/rrhh/engine/recalcular`, `lib/rrhh/route-utils`, `lib/rrhh/valorHora`, `lib/supabase/server` |
| `/api/rrhh/dashboard/horas-extra-por-sector` | `lib/rrhh/dashboardHelpers`, `lib/rrhh/engine/recalcular`, `lib/rrhh/paginado`, `lib/rrhh/route-utils`, `lib/supabase/server` |
| `/api/rrhh/dashboard/horas-por-sector` | `lib/rrhh/constants`, `lib/rrhh/dashboardHelpers`, `lib/rrhh/paginado`, `lib/rrhh/route-utils`, `lib/supabase/server` |
| `/api/rrhh/dashboard/resumen-hoy` | `lib/rrhh/resumenHoy`, `lib/rrhh/route-utils`, `lib/supabase/server` |
| `/api/rrhh/dashboard/top-ausencias` | `lib/rrhh/dashboardHelpers`, `lib/rrhh/paginado`, `lib/rrhh/route-utils`, `lib/supabase/server` |
| `/api/rrhh/dashboard/top-tardanzas` | `lib/rrhh/dashboardHelpers`, `lib/rrhh/paginado`, `lib/rrhh/route-utils`, `lib/supabase/server` |
| `/api/rrhh/empleados/[id]` | `lib/core/cuerpo`, `lib/core/validar`, `lib/rrhh/auth`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/rrhh/empleados/import/confirm` | `lib/core/catalogo`, `lib/core/cuerpo`, `lib/core/fechas`, `lib/rrhh/auth`, `lib/rrhh/excelImport`, `lib/rrhh/staging`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/rrhh/empleados/import/preview-sheet` | `lib/core/cuerpo`, `lib/rrhh/auth`, `lib/rrhh/excelImport`, `lib/rrhh/staging`, `lib/supabase/server` |
| `/api/rrhh/empleados/import/preview` | `lib/rrhh/auth`, `lib/rrhh/excelImport`, `lib/rrhh/staging`, `lib/supabase/server` |
| `/api/rrhh/empleados` | `lib/core/cuerpo`, `lib/rrhh/auth`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/rrhh/feriados/[id]` | `lib/rrhh/recalculoProgramado`, `lib/rrhh/route-utils`, `lib/supabase/server` |
| `/api/rrhh/feriados` | `lib/core/cuerpo`, `lib/rrhh/recalculoProgramado`, `lib/rrhh/route-utils`, `lib/supabase/server` |
| `/api/rrhh/fichadas/[id]` | `lib/core/cuerpo`, `lib/rrhh/dates`, `lib/rrhh/engine/recalcular`, `lib/rrhh/fichadas/marcarDia`, `lib/rrhh/fichadas/turnoDeNoche`, `lib/rrhh/route-utils`, `lib/supabase/server` |
| `/api/rrhh/fichadas/export` | `lib/core/xlsxExport`, `lib/rrhh/dates`, `lib/rrhh/paginado`, `lib/rrhh/route-utils`, `lib/supabase/server` |
| `/api/rrhh/fichadas/import/confirm` | `lib/core/cuerpo`, `lib/rrhh/dates`, `lib/rrhh/excelImport`, `lib/rrhh/fichadas/aplicar`, `lib/rrhh/fichadas/turnoDeNoche`, `lib/rrhh/route-utils`, `lib/rrhh/staging`, `lib/supabase/admin`, `lib/supabase/server` |
| `/api/rrhh/fichadas/import/preview-sheet` | `lib/core/cuerpo`, `lib/rrhh/excelImport`, `lib/rrhh/route-utils`, `lib/rrhh/staging`, `lib/supabase/server` |
| `/api/rrhh/fichadas/import/preview` | `lib/rrhh/excelImport`, `lib/rrhh/route-utils`, `lib/rrhh/staging`, `lib/supabase/server` |
| `/api/rrhh/fichadas/lenox/sincronizar` | `lib/core/cuerpo`, `lib/core/validar`, `lib/rrhh/lenox/cliente`, `lib/rrhh/lenox/corrida`, `lib/rrhh/lenox/rango`, `lib/rrhh/route-utils`, `lib/supabase/server` |
| `/api/rrhh/fichadas` | `lib/core/cuerpo`, `lib/core/paginado`, `lib/rrhh/dates`, `lib/rrhh/engine/recalcular`, `lib/rrhh/fichadas/calculoDelDia`, `lib/rrhh/fichadas/marcarDia`, `lib/rrhh/fichadas/turnoDeNoche`, `lib/rrhh/route-utils`, `lib/supabase/server` |
| `/api/rrhh/francos/[id]` | `lib/core/cuerpo`, `lib/core/fechas`, `lib/rrhh/route-utils`, `lib/supabase/server` |
| `/api/rrhh/francos/export` | `lib/core/xlsxExport`, `lib/rrhh/route-utils`, `lib/supabase/server` |
| `/api/rrhh/francos` | `lib/rrhh/route-utils`, `lib/supabase/server` |
| `/api/rrhh/horas-a-realizar` | `lib/core/cuerpo`, `lib/core/fechas`, `lib/core/paginado`, `lib/core/validar`, `lib/rrhh/ausentismo/vigencias`, `lib/rrhh/route-utils`, `lib/supabase/server` |
| `/api/rrhh/jornadas/[id]` | `lib/core/cuerpo`, `lib/rrhh/recalculoProgramado`, `lib/rrhh/route-utils`, `lib/supabase/server` |
| `/api/rrhh/jornadas` | `lib/core/cuerpo`, `lib/rrhh/recalculoProgramado`, `lib/rrhh/route-utils`, `lib/supabase/server` |
| `/api/rrhh/liquidaciones/[id]/cerrar` | `lib/core/auditoria`, `lib/rrhh/route-utils`, `lib/supabase/server` |
| `/api/rrhh/liquidaciones/[id]/export` | `lib/core/xlsxExport`, `lib/rrhh/route-utils`, `lib/supabase/server` |
| `/api/rrhh/liquidaciones/[id]` | `lib/rrhh/route-utils`, `lib/supabase/server` |
| `/api/rrhh/liquidaciones/export-planilla` | `lib/core/xlsxExport`, `lib/rrhh/planillaGeneral`, `lib/rrhh/route-utils`, `lib/supabase/server` |
| `/api/rrhh/liquidaciones/generar` | `lib/core/cuerpo`, `lib/rrhh/engine/recalcular`, `lib/rrhh/route-utils`, `lib/rrhh/valorHora`, `lib/supabase/server` |
| `/api/rrhh/liquidaciones/planilla` | `lib/rrhh/planillaGeneral`, `lib/rrhh/route-utils`, `lib/supabase/server` |
| `/api/rrhh/liquidaciones` | `lib/rrhh/route-utils`, `lib/supabase/server` |
| `/api/rrhh/vacaciones/[id]/balance` | `lib/rrhh/engine/vacaciones`, `lib/rrhh/route-utils`, `lib/supabase/server` |
| `/api/rrhh/vacaciones/[id]` | `lib/core/cuerpo`, `lib/core/validar`, `lib/rrhh/engine/recalcular`, `lib/rrhh/route-utils`, `lib/supabase/server` |
| `/api/rrhh/vacaciones/export` | `lib/core/xlsxExport`, `lib/rrhh/route-utils`, `lib/supabase/server` |
| `/api/rrhh/vacaciones` | `lib/core/cuerpo`, `lib/rrhh/engine/recalcular`, `lib/rrhh/route-utils`, `lib/supabase/server` |
| `/api/seguridad-higiene/condiciones/[id]` | `lib/core/auditoria`, `lib/core/fechas`, `lib/core/validar`, `lib/seguridadHigiene/auth`, `lib/seguridadHigiene/cambioDeCondicion`, `lib/supabase/server` |
| `/api/seguridad-higiene/condiciones` | `lib/core/paginado`, `lib/core/validar`, `lib/seguridadHigiene/auth`, `lib/seguridadHigiene/cuerpoDeCondicion`, `lib/seguridadHigiene/fotoDeCondicion`, `lib/seguridadHigiene/guardarLaFoto`, `lib/supabase/server` |
| `/api/seguridad-higiene/fotos/[id]` | `lib/seguridadHigiene/guardarLaFoto`, `lib/supabase/server` |
| `/api/seguridad-higiene/fotos` | `lib/seguridadHigiene/auth`, `lib/seguridadHigiene/fotoDeCondicion`, `lib/seguridadHigiene/guardarLaFoto`, `lib/supabase/server` |
| `/api/seguridad-higiene/peligros` | `lib/core/paginado`, `lib/seguridadHigiene/auth`, `lib/supabase/server` |
| `/api/taller-vial/cargas` | `lib/supabase/server`, `lib/tallerVial/auth`, `lib/tallerVial/consultas`, `lib/tallerVial/espejo` |
| `/api/taller-vial/estados` | `lib/supabase/server`, `lib/tallerVial/auth`, `lib/tallerVial/consultas`, `lib/tallerVial/espejo`, `lib/tallerVial/estados` |
| `/api/taller-vial/informes/export` | `lib/supabase/server`, `lib/tallerVial/auth`, `lib/tallerVial/combustible`, `lib/tallerVial/consultas`, `lib/tallerVial/equipos`, `lib/tallerVial/estados`, `lib/tallerVial/informe` |
| `/api/taller-vial/inventario` | `lib/supabase/server`, `lib/tallerVial/auth`, `lib/tallerVial/equipos` |
| `/api/taller-vial/reparaciones` | `lib/core/cuerpo`, `lib/supabase/server`, `lib/tallerVial/auth`, `lib/tallerVial/consultas` |
| `/api/taller-vial/repuestos` | `lib/core/cuerpo`, `lib/supabase/server`, `lib/tallerVial/auth`, `lib/tallerVial/consultas` |
| `/api/taller-vial/services` | `lib/core/cuerpo`, `lib/supabase/server`, `lib/tallerVial/auth`, `lib/tallerVial/consultas`, `lib/tallerVial/service` |
| `/api/taller-vial/sync` | `lib/supabase/server`, `lib/tallerVial/auth`, `lib/tallerVial/importar` |
| `/api/trituracion/informes/export` | `lib/supabase/server`, `lib/trituracion/auth`, `lib/trituracion/consultas`, `lib/trituracion/informeExcel`, `lib/trituracion/informeMensual` |
| `/api/trituracion/partes` | `lib/supabase/server`, `lib/trituracion/auth`, `lib/trituracion/cantidades`, `lib/trituracion/consultas`, `lib/trituracion/espejo`, `lib/trituracion/vocabulario` |
| `/api/trituracion/plantas` | `lib/supabase/server`, `lib/trituracion/auth`, `lib/trituracion/consultas` |
| `/api/ventas/actividades/[id]` | `lib/core/validar`, `lib/supabase/server`, `lib/ventas/auth`, `lib/ventas/crm/cuerpos` |
| `/api/ventas/actividades` | `lib/core/paginado`, `lib/core/validar`, `lib/supabase/server`, `lib/ventas/auth`, `lib/ventas/crm/cuerpos` |
| `/api/ventas/clientes/[id]` | `lib/core/auditoria`, `lib/core/validar`, `lib/supabase/server`, `lib/ventas/auth`, `lib/ventas/crm/cuerpos` |
| `/api/ventas/clientes/importar/confirmar` | `lib/core/validar`, `lib/supabase/server`, `lib/ventas/auth` |
| `/api/ventas/clientes/importar/plantilla` | `lib/core/xlsxExport`, `lib/supabase/server`, `lib/ventas/auth`, `lib/ventas/crm/importarClientes` |
| `/api/ventas/clientes/importar` | `lib/core/cuit`, `lib/core/excel`, `lib/core/paginado`, `lib/supabase/server`, `lib/ventas/auth`, `lib/ventas/crm/importarClientes` |
| `/api/ventas/clientes` | `lib/core/paginado`, `lib/core/validar`, `lib/supabase/server`, `lib/ventas/auth`, `lib/ventas/crm/cuerpos` |
| `/api/ventas/contactos/[id]` | `lib/core/validar`, `lib/supabase/server`, `lib/ventas/auth`, `lib/ventas/crm/cuerpos` |
| `/api/ventas/contactos` | `lib/core/validar`, `lib/supabase/server`, `lib/ventas/auth`, `lib/ventas/crm/cuerpos` |
| `/api/ventas/oportunidades/[id]` | `lib/core/fechas`, `lib/core/validar`, `lib/supabase/server`, `lib/ventas/auth`, `lib/ventas/crm/cuerpos`, `lib/ventas/crm/etapas` |
| `/api/ventas/oportunidades` | `lib/core/fechas`, `lib/core/paginado`, `lib/core/validar`, `lib/supabase/server`, `lib/ventas/auth`, `lib/ventas/crm/cuerpos`, `lib/ventas/crm/etapas` |
