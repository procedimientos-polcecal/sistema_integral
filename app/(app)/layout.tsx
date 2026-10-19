import { redirect } from "next/navigation";
import { logout } from "@/app/login/actions";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/Sidebar";
import { Header } from "@/components/Header";
import { NavMovilProvider } from "@/components/NavMovil";
import { BarraInstalar } from "@/components/BarraInstalar";
import { CargasEsperando } from "@/components/CargasEsperando";
import { RegistrarServiceWorker } from "@/components/RegistrarServiceWorker";
import { modulosVisibles, nivelEnModulo, puedeUsarAsistente, MODULOS_ORDEN } from "@/lib/core/access";
import { puedeAprobarCompras, puedeAprobarOS } from "@/lib/compras/auth";
import type { Rol, UsuarioModulo } from "@/lib/core/types";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: usuario } = await supabase
    .from("usuarios")
    .select("nombre, apellido, rol, empleado_id, activo, puede_usar_asistente")
    .eq("id", user.id)
    .single();

  // Sin fila en `usuarios`, o dado de baja: no entra.
  //
  // Se muestra en el lugar y no con redirect: el middleware manda a "/" a
  // cualquiera con sesión válida, así que redirigir a /login haría un bucle.
  // El botón cierra la sesión, que es la única salida real.
  if (!usuario || !usuario.activo) {
    const desactivado = Boolean(usuario) && !usuario?.activo;
    return (
      <main className="flex min-h-dvh items-center justify-center p-6 text-center">
        <div className="max-w-sm">
          <p className="text-lg font-semibold">
            {desactivado ? "Tu cuenta está desactivada." : "Tu cuenta todavía no fue habilitada."}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            {desactivado
              ? "Un administrador dio de baja tu acceso. Si creés que es un error, avisale."
              : "Pedile a un administrador que te dé acceso."}
          </p>
          <form action={logout}>
            <button
              type="submit"
              className="mt-5 rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              Cerrar sesión
            </button>
          </form>
        </div>
      </main>
    );
  }

  const { data: grants } = await supabase
    .from("usuario_modulos")
    .select("id, usuario_id, modulo, nivel")
    .eq("usuario_id", user.id);

  const rol = usuario.rol as Rol;
  const grantsList = (grants ?? []) as UsuarioModulo[];
  const modulos = modulosVisibles(rol, grantsList);
  const modulosAdmin = MODULOS_ORDEN.filter((m) => nivelEnModulo(rol, grantsList, m) === "admin");

  // Aprobar no depende del nivel: sale de una lista. Son dos, y en paralelo
  // porque no dependen entre sí: los requerimientos los aprueba una y las
  // órdenes de servicio la otra.
  const [esAprobadorCompras, esAprobadorOS] = await Promise.all([
    puedeAprobarCompras(supabase, user.id),
    puedeAprobarOS(supabase, user.id),
  ]);

  return (
    <NavMovilProvider>
      {/* `h-dvh` y no `h-screen`: en Safari de iPhone `100vh` es la altura
          **con las barras ocultas**, no la que se ve, así que el armazón mide
          más que la pantalla y el layout se recalcula cada vez que Safari
          colapsa o expande su barra al scrollear — se siente como que la
          pantalla no está firme, y se nota sobre todo abajo, que es donde vive
          la barra de instalar. `100dvh` es la altura real en cada momento.
          No lleva reserva a `100vh`: Tailwind 4 ya exige Safari 16.4+, y `dvh`
          existe desde la 15.4, así que no hay navegador soportado sin él —
          Lightning CSS borra la reserva por muerta, medido. */}
      <div className="flex h-dvh flex-col">
        <Header
          usuarioNombre={`${usuario.nombre} ${usuario.apellido}`.trim()}
          asistenteHabilitado={puedeUsarAsistente({ rol, puede_usar_asistente: usuario.puede_usar_asistente })}
        />
        {/* Arriba de todo y no al pie junto a `BarraInstalar`, y la diferencia
            es qué es cada barra. Aquélla es una oferta que se puede ignorar
            para siempre; ésta es trabajo de alguien que no entró al sistema y
            puede llevar días ahí. El pie de una pantalla que scrollea es el
            último lugar donde se mira —y en el teléfono suele estar fuera de
            cuadro—, así que la red de abajo del diseño sin señal quedaría donde
            menos se ve. Se dibuja sola o no se dibuja nada: decide con lo que
            haya guardado el teléfono de quien mira.

            `conMantenimiento` por lo mismo que el ítem del menú: lo que la
            barra cuenta son avisos y órdenes de trabajo, y su botón lleva a
            `/cargar`, que al vivir fuera del grupo `(app)` **se abre igual**
            para cualquiera con sesión. O sea que acá no alcanza con que el
            destino rebote: si no se filtra, no filtra nadie.

            Y `usuarioId` es la excepción a ese filtro, que existe por la misma
            puerta abierta: sin red el service worker manda cualquier navegación
            a `/cargar`, así que alguien sin el módulo puede llegar a encolar
            algo. A nadie se le esconde lo que cargó él. El porqué está en el
            componente. */}
        <CargasEsperando
          conMantenimiento={modulos.includes("mantenimiento")}
          usuarioId={user.id}
        />

        <div className="flex min-h-0 flex-1">
          <Sidebar
            modulos={modulos}
            modulosAdmin={modulosAdmin}
            rol={rol}
            esAprobadorCompras={esAprobadorCompras}
            esAprobadorOS={esAprobadorOS}
            esEmpleadoRemises={!!usuario.empleado_id}
          />
          {/* En un teléfono cada píxel de ancho cuenta: 24 de padding por lado
              eran 48 de los 375 que hay. `min-w-0` es lo que deja que las
              tablas scrolleen adentro en vez de estirar la página entera. */}
          <main className="min-w-0 flex-1 overflow-auto p-4 md:p-6">{children}</main>
        </div>

        {/* La ofrece a quien todavía no la instaló. Se dibuja sola o no se
            dibuja nada: decide por el navegador de quien mira, y en la
            computadora no aparece nunca.

            Va acá adentro, como último hijo de la columna de altura de
            pantalla, y no suelta al final: así ocupa lugar de verdad y le quita
            alto al `<main>` que scrollea. Cuando estaba `fixed` no se lo quitaba
            a nadie y tapaba los últimos 52 a 86 px de todas las pantallas. */}
        <BarraInstalar />
      </div>

      {/* Registra el service worker, que es lo que hace instalable a la app.
          No dibuja nada; va en el layout porque tiene que correr para todos y
          en cada carga, no detrás de un botón. */}
      <RegistrarServiceWorker />
    </NavMovilProvider>
  );
}
