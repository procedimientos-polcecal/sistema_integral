# El semáforo de pedidos y el reclamo a Compras — Plan de implementación

> **Para quien lo ejecute:** SUB-SKILL REQUERIDA: usar superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans para implementarlo tarea por tarea. Los pasos usan casillas (`- [ ]`).

**Objetivo:** que el área vea en `/mis-pedidos` cuáles de sus pedidos están dormidos y pueda pedirle a Compras una justificación del atraso en un clic.

**Arquitectura:** una función pura en `lib/compras/semaforo.ts` decide el color y el conjunto reclamable; `/mis-pedidos` la usa para pintar una franja de conteos y un punto por renglón, y el botón «Reclamar» abre el hilo de mensajes que ya existe con el texto y los destinatarios puestos. No hay tabla nueva ni migración.

**Stack:** Next.js 16 (App Router), Supabase JS en el cliente, vitest sobre funciones puras, Tailwind v4.

**Spec:** [docs/superpowers/specs/2026-11-12-compras-semaforo-y-reclamo-design.md](../specs/2026-11-12-compras-semaforo-y-reclamo-design.md)

## Restricciones globales

- Todo en **castellano**: nombres, comentarios, textos de pantalla y mensajes de commit.
- Los cortes son **30 y 90 días** sobre `compras_requerimientos.fecha`, y viven en un solo lugar.
- Reclamable = `estado_compra` en `SIN_INICIAR` · `EN_COMPARATIVA` · `PARA_COMPRAR` · `APROBADO`, y `estado_aprobacion != 'DENEGADA'`. Nada de `PEDIDO`, `RECIBIDO`, `DENEGADO` ni `EN_ESPERA`.
- Destinatarios del reclamo: **grant explícito `edicion` o `admin` en `usuario_modulos` para el módulo `compras`**. Nunca `nivelEnModulo()`, que le da `admin` a todo `admin_sistema`.
- Un desplegable se escribe `<Select>`. Una grilla de tres columnas lleva breakpoint. No poner `w-*` al lado de `.input` ni `text-*` al lado de un `.btn-*`.
- Esta pantalla **no escribe en ninguna planilla**, así que no hay que exportar nada.

## Foco de revisión

Cinco entradas que el diseño implica y que ningún test de tarea ejercitaría
solo. **Sólo la primera se puede fijar con un test**: en este repo las
pantallas no tienen tests, así que las otras cuatro se comprueban leyendo el
código al cerrar su tarea y mirando la pantalla en producción. Decirlo es parte
de la entrega: una lista que promete cobertura que no existe es peor que no
tenerla.

1. **Un pedido con `fecha` futura** — medido: el mínimo de hoy es −1 día. Tiene que caer en verde, no en un cuarto estado ni romper. (Tarea 1)
2. **Cambiar alcance o búsqueda con un chip activo** — los conteos son de otro conjunto; el filtro por color tiene que limpiarse. Si no, la franja dice «15 rojos» y la lista muestra otra cosa. (Tarea 2)
3. **Una persona sin área asignada** — hay seis. Abre en «Todos», donde ningún pedido es suyo, así que no ve un solo botón «Reclamar»: la pantalla tiene que decir por qué en vez de parecer rota. (Tarea 4)
4. **Un gestor de Compras que ya no puede ser mencionado** — la preselección tiene que descartarlo en silencio. Mandar un id que el servidor rechaza tira el mensaje entero. (Tarea 4)
5. **Un pedido sin `area_id`** — `esMio()` da falso y no tiene que explotar ni mostrar botón. (Tarea 3)

---

### Tarea 1: La función que decide el color

**Archivos:**
- Crear: `lib/compras/semaforo.ts`
- Test: `lib/compras/semaforo.test.ts`

**Interfaces:**
- Consume: `EstadoCompra`, `EstadoAprobacion` de `lib/compras/types`.
- Produce:
  - `DIAS_VERDE = 30`, `DIAS_AMARILLO = 90`
  - `type ColorDelPedido = "verde" | "amarillo" | "rojo"`
  - `esReclamable(p: { estado_compra: string; estado_aprobacion: string }): boolean`
  - `colorDelPedido(fecha: string, hoy: Date): ColorDelPedido`
  - `diasEsperando(fecha: string, hoy: Date): number`
  - `rangoDeColor(color: ColorDelPedido, hoy: Date): { desde?: string; hasta?: string }` — las fechas ISO con las que se filtra en PostgREST, para contar sin traer filas.

- [ ] **Paso 1: Escribir el test que falla**

```ts
describe("esReclamable", () => {
  it("acepta los cuatro estados que esperan a Compras", () => {
    for (const e of ["SIN_INICIAR", "EN_COMPARATIVA", "PARA_COMPRAR", "APROBADO"])
      expect(esReclamable({ estado_compra: e, estado_aprobacion: "APROBADA" })).toBe(true);
  });
  it("deja afuera lo ya pedido, lo recibido y lo denegado", () => {
    for (const e of ["PEDIDO", "RECIBIDO", "DENEGADO"])
      expect(esReclamable({ estado_compra: e, estado_aprobacion: "APROBADA" })).toBe(false);
  });
  // 9 de los 10 más viejos están acá: sin esta línea, lo primero que ve el
  // área son pedidos que alguien congeló a propósito.
  it("deja afuera EN_ESPERA, que es un desvío y no una etapa", () => {
    expect(esReclamable({ estado_compra: "EN_ESPERA", estado_aprobacion: "APROBADA" })).toBe(false);
  });
  it("deja afuera lo denegado por gerencia aunque la compra no se haya tocado", () => {
    expect(esReclamable({ estado_compra: "SIN_INICIAR", estado_aprobacion: "DENEGADA" })).toBe(false);
  });
});

describe("colorDelPedido", () => {
  const hoy = new Date("2026-11-12T10:00:00Z");
  it("verde hasta 30 días", () => {
    expect(colorDelPedido("2026-11-12", hoy)).toBe("verde");
    expect(colorDelPedido("2026-10-13", hoy)).toBe("verde"); // 30
  });
  it("amarillo de 31 a 90", () => {
    expect(colorDelPedido("2026-10-12", hoy)).toBe("amarillo"); // 31
    expect(colorDelPedido("2026-08-14", hoy)).toBe("amarillo"); // 90
  });
  it("rojo a partir de 91", () => {
    expect(colorDelPedido("2026-08-13", hoy)).toBe("rojo"); // 91
  });
  // Medido: el pedido más nuevo de hoy tiene -1 día.
  it("una fecha futura es verde y no un cuarto estado", () => {
    expect(colorDelPedido("2026-11-20", hoy)).toBe("verde");
    expect(diasEsperando("2026-11-20", hoy)).toBeLessThan(0);
  });
});

describe("rangoDeColor", () => {
  const hoy = new Date("2026-11-12T10:00:00Z");
  it("el rojo es todo lo anterior al corte de 90", () => {
    expect(rangoDeColor("rojo", hoy)).toEqual({ hasta: "2026-08-13" });
  });
  it("el amarillo tiene las dos puntas", () => {
    expect(rangoDeColor("amarillo", hoy)).toEqual({ desde: "2026-08-14", hasta: "2026-10-12" });
  });
  it("el verde no tiene tope: una fecha futura entra", () => {
    expect(rangoDeColor("verde", hoy)).toEqual({ desde: "2026-10-13" });
  });
});
```

- [ ] **Paso 2: Correrlo y ver que falla**

Run: `npx vitest run lib/compras/semaforo.test.ts`
Esperado: FAIL, «Failed to resolve import».

- [ ] **Paso 3: Escribir `lib/compras/semaforo.ts`**

El encabezado del archivo explica por qué los cortes son 30/90 y no 10/30, con los números del spec: con 10/30 quedaban 50 de 106 en rojo y Mantenimiento abría con 33 reclamos; con 30/90 abre con 11. Y por qué `EN_ESPERA` queda afuera.

`rangoDeColor` tiene que ser **consistente con `colorDelPedido`**: los bordes de los tests de arriba son los mismos días. Conviene derivar las dos de una sola función que calcule la fecha de corte.

- [ ] **Paso 4: Correr y ver que pasa**

Run: `npx vitest run lib/compras/semaforo.test.ts`
Esperado: PASS

- [ ] **Paso 5: Commit**

```bash
git add lib/compras/semaforo.ts lib/compras/semaforo.test.ts
git commit -m "feat(compras): la regla del semaforo de pedidos, con sus cortes en 30 y 90 dias"
```

---

### Tarea 2: La franja de conteos, el filtro y el orden

**Archivos:**
- Modificar: `app/(app)/mis-pedidos/MisPedidosClient.tsx`

**Interfaces:**
- Consume: `rangoDeColor`, `ColorDelPedido`, `DIAS_VERDE`, `DIAS_AMARILLO` de la Tarea 1.
- Produce: el estado `color: ColorDelPedido | null` que la Tarea 3 lee para saber si hay filtro activo.

Tres chips arriba de la lista con el conteo de cada color, que al tocarse filtran. Los conteos son del **conjunto filtrado completo**, no de la página: tres consultas `{ count: "exact", head: true }` con los mismos filtros de alcance y búsqueda que la lista, más el rango de `fecha` de `rangoDeColor` y los estados reclamables. No traen filas.

**Al filtrar por color, la consulta de la lista ordena por `fecha` ascendente** —del más dormido al más nuevo— en vez de `nro_ri` descendente. Sin filtro, el orden no cambia: la pantalla también se usa para buscar si alguien ya pidió lo mismo, y eso se navega por número.

- [ ] **Paso 1: Agregar el estado del color y recalcular los conteos**

El `filtro` que resetea la página ya existe y es `` `${alcance}|${busquedaAplicada}` ``. **Agregarle el color**, y además limpiar el color cuando cambian alcance o búsqueda — si no, la franja dice «15 rojos» de otro conjunto mientras la lista muestra éste.

- [ ] **Paso 2: Los tres chips**

Van arriba de la lista, con el conteo y la etiqueta (`hasta 30 días`, `31 a 90 días`, `más de 90 días`, armadas con las constantes). El chip activo se distingue, y volver a tocarlo saca el filtro. En 343 px entran los tres como chips; tres tarjetas no.

Los conteos se muestran **sólo cuando la lista no está cargando**, igual que el total que ya está al lado.

- [ ] **Paso 3: Comprobar en el navegador**

Esta parte no tiene test automático: la pantalla está detrás del login. Verificar con `npm run build` que compila, y dejar anotado que el filtro y los conteos se comprueban en producción con un RI real.

- [ ] **Paso 4: Verificar**

Run: `npx tsc --noEmit && node scripts/revisar-responsive.mjs`
Esperado: tsc sin salida · ROMPE 0

- [ ] **Paso 5: Commit**

```bash
git add "app/(app)/mis-pedidos/MisPedidosClient.tsx"
git commit -m "feat(compras): la franja del semaforo en Mis pedidos, que filtra y reordena"
```

---

### Tarea 3: El punto en cada renglón

**Archivos:**
- Modificar: `app/(app)/mis-pedidos/MisPedidosClient.tsx`

**Interfaces:**
- Consume: `colorDelPedido`, `esReclamable`, `diasEsperando` de la Tarea 1.
- Produce: el componente local `PuntoDelSemaforo({ pedido })`, que la Tarea 4 usa para decidir si va el botón.

El punto va en las dos vistas: la tarjeta del teléfono y la tabla de escritorio. **Un pedido que no es reclamable no lleva punto** —ni gris ni nada— y se sigue listando igual: el semáforo es una capa sobre la lista de siempre.

Al lado del punto, los días que lleva esperando.

- [ ] **Paso 1: Escribir el test de la etiqueta**

En `lib/compras/semaforo.test.ts`, para `textoDeEspera(dias: number): string` —la única parte con decisiones: el singular, y qué decir de una fecha futura.

```ts
describe("textoDeEspera", () => {
  it("dice los días", () => expect(textoDeEspera(53)).toBe("53 días"));
  it("en singular con uno", () => expect(textoDeEspera(1)).toBe("1 día"));
  it("hoy no son cero días", () => expect(textoDeEspera(0)).toBe("hoy"));
  it("una fecha futura tampoco cuenta días", () => expect(textoDeEspera(-3)).toBe("hoy"));
});
```

- [ ] **Paso 2: Correrlo y ver que falla**

Run: `npx vitest run lib/compras/semaforo.test.ts`
Esperado: FAIL, `textoDeEspera is not a function`

- [ ] **Paso 3: Implementar `textoDeEspera` y el punto**

`textoDeEspera` va en `lib/compras/semaforo.ts`. `PuntoDelSemaforo` es un componente local de `MisPedidosClient.tsx`, como `Chip` y `Solicitante`.

El color se pone con `style` y no con una clase de Tailwind al lado de otra cosa.

- [ ] **Paso 4: Verificar**

Run: `npx vitest run lib/compras/semaforo.test.ts && npx tsc --noEmit && node scripts/revisar-responsive.mjs`
Esperado: PASS · sin salida · ROMPE 0

- [ ] **Paso 5: Commit**

```bash
git add lib/compras/semaforo.ts lib/compras/semaforo.test.ts "app/(app)/mis-pedidos/MisPedidosClient.tsx"
git commit -m "feat(compras): el punto del semaforo en cada renglon de Mis pedidos"
```

---

### Tarea 4: El botón «Reclamar»

**Archivos:**
- Modificar: `components/HiloDeMensajes.tsx` (props nuevas)
- Modificar: `app/(app)/mis-pedidos/ConversacionDelPedido.tsx` (pasarlas)
- Modificar: `app/(app)/mis-pedidos/MisPedidosClient.tsx` (el botón)
- Modificar: `app/(app)/mis-pedidos/page.tsx` (los ids de los gestores)
- Crear: `lib/compras/reclamo.ts` + `lib/compras/reclamo.test.ts`

**Interfaces:**
- Consume: `colorDelPedido`, `diasEsperando`, `esReclamable` de la Tarea 1.
- Produce:
  - `textoDelReclamo(p: { nro_ri: number; descripcion: string | null; dias: number; estado: string }): string`
  - `HiloDeMensajes` acepta `textoInicial?: string` y `mencionesIniciales?: string[]`
  - `MisPedidosClient` acepta `gestoresDeCompras: string[]`

El botón aparece **en los renglones amarillos y rojos de pedidos del área propia**. En «Todos», sobre los de otra área, se ve el punto pero no el botón.

Abre el mismo diálogo que «Mensajes», con el texto redactado y los gestores preseleccionados.

- [ ] **Paso 1: Escribir el test del texto**

```ts
describe("textoDelReclamo", () => {
  it("nombra el RI, los días y el estado", () => {
    expect(textoDelReclamo({ nro_ri: 771, descripcion: "Perfil C", dias: 253, estado: "APROBADO" }))
      .toBe("El RI 771 (Perfil C) lleva 253 días sin avanzar, en estado Aprobado. ¿Nos pueden decir por qué está demorado?");
  });
  it("un pedido sin descripción no deja un paréntesis vacío", () => {
    expect(textoDelReclamo({ nro_ri: 12, descripcion: null, dias: 40, estado: "SIN_INICIAR" }))
      .toBe("El RI 12 lleva 40 días sin avanzar, en estado Sin iniciar. ¿Nos pueden decir por qué está demorado?");
  });
});
```

La etiqueta del estado sale de `COMPRA_LABELS` de `lib/compras/constants`, no de una copia.

- [ ] **Paso 2: Correrlo y ver que falla**

Run: `npx vitest run lib/compras/reclamo.test.ts`
Esperado: FAIL, «Failed to resolve import»

- [ ] **Paso 3: Implementar `textoDelReclamo`**

- [ ] **Paso 4: Las props nuevas del hilo**

`textoInicial` arranca el estado `texto`. `mencionesIniciales` **se aplica cuando llegan los `destinatarios`**, no al montar: la lista es asíncrona y preseleccionar un id que no está en ella mandaría al servidor una mención que rechaza, y el POST falla entero. **Se filtra contra `destinatarios` y lo que no está se descarta en silencio** — un gestor al que le sacaron el módulo no puede trabar el reclamo de otro.

El comentario de esas dos props dice que existen para el reclamo de Compras y que el texto es un borrador editable, no un formulario.

- [ ] **Paso 5: Los gestores, del servidor**

En `app/(app)/mis-pedidos/page.tsx`, con el **cliente admin**: `usuario_modulos` filtrado por `modulo = 'compras'` y `nivel` en (`edicion`, `admin`), cruzado con los usuarios activos. Se pasa a `MisPedidosClient` como `gestoresDeCompras`.

**No usar `nivelEnModulo()`**: le da `admin` a todo `admin_sistema` y metería a quien tiene `lectura` explícita. Hoy la diferencia es una persona.

- [ ] **Paso 6: El botón**

En la tarjeta y en la fila, al lado de «Mensajes». Abre el mismo diálogo pasando `textoInicial` y `mencionesIniciales`.

Si `misAreas` está vacío, arriba de la lista va una línea que lo diga: sin área asignada no hay nada que reclamar, y se pide en Administración → Usuarios. Son seis personas hoy.

- [ ] **Paso 7: Verificar**

Run: `npm test && npx tsc --noEmit && npm run build`
Esperado: todo verde

- [ ] **Paso 8: Commit**

```bash
git add lib/compras/reclamo.ts lib/compras/reclamo.test.ts components/HiloDeMensajes.tsx "app/(app)/mis-pedidos/ConversacionDelPedido.tsx" "app/(app)/mis-pedidos/MisPedidosClient.tsx" "app/(app)/mis-pedidos/page.tsx"
git commit -m "feat(compras): el boton de reclamo abre el hilo con el texto y los gestores puestos"
```

---

### Tarea 5: Cuándo fue el último mensaje

**Archivos:**
- Modificar: `app/(app)/mis-pedidos/MisPedidosClient.tsx`

**Interfaces:**
- Consume: nada nuevo.

Después de cargar la página de pedidos, una consulta a `mensajes` por los ids que están en pantalla —`entidad_tipo = 'requerimiento'`, `entidad_id.in(…)`, a lo sumo 50 ids, que es un `.in()` chico— y se guarda el `creado_en` más nuevo de cada uno. El índice `mensajes_entidad_idx` ya cubre esa consulta.

**La etiqueta dice «Último mensaje el …», no «Reclamado el …»**, y es deliberado: el hilo guarda cualquier conversación sobre el pedido, no sólo reclamos, y llamarlo reclamo afirmaría algo que el dato no sabe. Sirve igual para lo que tiene que servir: ver que ese pedido ya se habló antes de volver a escribir.

La tabla `mensajes` está **vacía** hoy —la mensajería se desplegó el 11/11/2026—, así que al principio no se va a ver en ningún renglón. Eso es lo esperado, no un error.

- [ ] **Paso 1: Traer los últimos mensajes**

Un `useCargar` aparte, que corre cuando cambia la lista de pedidos. Un fallo acá **no rompe la pantalla**: se muestra la lista sin la etiqueta.

- [ ] **Paso 2: Mostrarlo en el renglón**

En la tarjeta y en la fila, junto al botón.

- [ ] **Paso 3: Verificar**

Run: `npx tsc --noEmit && npm run build && node scripts/revisar-responsive.mjs`
Esperado: todo verde

- [ ] **Paso 4: Commit**

```bash
git add "app/(app)/mis-pedidos/MisPedidosClient.tsx"
git commit -m "feat(compras): el renglon dice cuando fue el ultimo mensaje del pedido"
```

---

### Tarea 6: Dejarlo escrito

**Archivos:**
- Modificar: `docs/COMPRAS.md`
- Modificar: `CLAUDE.md`

Una sección en `docs/COMPRAS.md` con lo que no se deduce del código: que los cortes son 30/90 y por qué no 10/30 (los números), que `EN_ESPERA` queda afuera y que 9 de los 10 más viejos eran de ésos, que el destinatario sale del grant explícito y no de `nivelEnModulo()`, y que 5 de los 106 esperan a un aprobador y no a Compras.

En `CLAUDE.md`, la fila de Compras suma el enlace al spec y al plan.

- [ ] **Paso 1: Escribirlo**
- [ ] **Paso 2: Verificar todo junto**

Run: `npm test && npx tsc --noEmit && npm run build && node scripts/revisar-arbol-commiteado.mjs && node scripts/revisar-responsive.mjs && node scripts/revisar-exportaciones.mjs`

- [ ] **Paso 3: Commit**

```bash
git add docs/COMPRAS.md CLAUDE.md
git commit -m "docs(compras): el semaforo de pedidos y el reclamo, con lo que no se deduce del codigo"
```
