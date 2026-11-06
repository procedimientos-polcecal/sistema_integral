-- ============================================================
-- SdG — Seguridad e Higiene: las descripciones del glosario de peligros
--
-- DML, sin DDL: se puede correr en el editor SQL o aplicar por PostgREST. Es la
-- misma sentencia, y es idempotente.
--
-- La migración 20261029111053 sembró los 32 peligros con el nombre y la
-- descripción en null —salvo «Caída de altura»—, porque quien la escribió no
-- tenía el Excel a mano. El texto es el de la hoja «Glosario Peligros» de
-- `21-10-26.xlsm`, tal cual: es lo que hace que dos personas que miran la misma
-- condición elijan el mismo peligro, así que no se resume ni se corrige,
-- incluso donde la redacción es torpe o tiene erratas («celulara», «puedo
-- ocasionar»).
--
-- El nombre de «Vuelco de vehículos» va con tilde, como lo sembró la migración
-- anterior, y no como lo escribe la planilla («vehiculos»): el `where` compara
-- por igualdad y con el de la planilla esa fila quedaba sin actualizar, sin
-- error y sin aviso. Se encontró contrastando los 32 nombres de la base con los
-- del Excel antes de aplicarla. La descripción sí es la de la planilla, con su
-- falta de tilde.
--
-- «Torceduras» no tiene descripción en el original, y así queda: inventarle una
-- sería escribir en el glosario algo que la planilla no dice.
--
-- `where descripcion is null` hace que correrla dos veces no pise nada, y que
-- una descripción que alguien ya editó desde la pantalla de administración
-- sobreviva. Por eso tampoco toca a «Caída de altura», que ya la tenía.
-- ============================================================

update public.syh_peligros p
   set descripcion = v.descripcion
  from (values
  ('Agresión de terceros', 'Peligro de agresión de todo tipo en el ámbito de trabajo.'),
  ('Ambiente térmico inadecuado', 'Peligro que deriva de trabajos en lugares con alta temperatura producidas por fuentes de calor'),
  ('Arco eléctrico', 'Descarga de energía explosiva provocada por el paso de corriente eléctrica entre dos fuentes de energía de distinto potencial a través de gases o vapores ionizados o una fuente de energía y la tierra.'),
  ('Atmósfera inadecuada', 'Atmósfera no apta para la respiración ya sea por falta de oxígeno como por presencia de agentes químicos contaminantes en el ambiente.'),
  ('Atrapado por', 'Atrapamiento de cualquier parte del cuerpo entre dos objetos.'),
  ('Atropellamiento por vehículos', 'Evento donde uno o más vehículos impactan sobre el trabajador.'),
  ('Caída a desnivel', 'Caída producida en presencia de un desnivel (escaleras, cordón de vereda, pozo)'),
  ('Caída a nivel', 'Caída producida a nivel de piso (por ejemplo por presencia de aceite o por algún obstáculo)'),
  ('Caída de altura', 'Caída que se produce por encima de los dos metros. (< 2m)'),
  ('Choques contra', 'Evento donde uno o más vehículos impactan entre sí o con otros objetos.'),
  ('Contacto con sustancias químicas', 'Contacto de la piel (especialmente manos) al manipular sustancias químicas corrosivas o tóxicas por absorción de la piel.'),
  ('Contacto directo', 'Contacto de cualquier parte del cuerpo con partes activas (con tensión) de una instalación derivándose la corriente a través del cuerpo a tierra.'),
  ('Contacto indirecto', 'Contacto de cualquier parte del cuerpo con alguna parte de un equipo que no debería estar con tensión pero que por pérdida de aislación si lo está.'),
  ('Cortes/Pinchaduras', 'Cortes o pinchaduras producidas por cualquier tipo de elemento cortante, partes de herramientas afiladas o elementos con punta.'),
  ('Desprendimiento de tierra / escombros', 'Desprendimiento de tierra en excavaciones o escombros con sepultamiento parcial o total de las personas'),
  ('Ergonómicos', 'Peligros producidos por mala postura, esfuerzos físicos excesivos, esfuerzos por trabajos de tipo repetitivo (trabajo en PC, movimiento de materiales, etc.)'),
  ('Explosión', 'Liberación de energía violenta y rápida con liberación abrupta de calor, llama, vapores candentes, gases y/o elementos sólidos.'),
  ('Exposición a radiaciones ionizantes', 'Destrucción celulara y/o quemaduras (corto plazo) Cáncer a largo plazo'),
  ('Golpeado por', 'Golpe por partes móviles de máquinas, equipos, herramientas u objetos que caen, etc.'),
  ('Golpeado contra', 'Golpes con estructuras, equipos, etc'),
  ('Iluminación deficiente', 'Sectores de trabajo donde el nivel de iluminación este por debajo del mínimo que exige la ley, puedo ocasionar accidentes/incidentes.'),
  ('Incendio', 'Liberación de energía con llama por combustión de los elementos combustibles en el ámbito de trabajo.'),
  ('Inhalación de partículas / gases o sustancias tóxicas', 'Inhalación por vía respiratoria y/o digestiva de sustancias nocivas para la salud.'),
  ('Mordeduras / picaduras', 'Cortes, desgarros, fracturas, infecciones y/o envenenamiento producidos por mordeduras y/o picaduras de animales e insectos'),
  ('Proyección de partículas', 'Daño en los ojos, rostro o cuerpo derivado de proyecciones y/o ingreso de material particulado.'),
  ('Quemaduras', 'Contacto con superficies calientes o fuente de ignición'),
  ('Radiación no ionizante', 'Fuentes de calor con llama, trabajos de soldadura, fuentes de microondas.'),
  ('Radiaciones ionizantes', 'Peligro por exposición a radiaciones ionizantes'),
  ('Ruidos y vibraciones', 'Peligro de daño por ruido y/o vibraciones.'),
  ('Salpicaduras', 'Peligro de daño derivado de la salpicaduras de sustancias químicas, toxicas, etc.'),
  ('Vuelco de vehículos', 'Peligro de vuelco de vehiculos')
  ) as v(nombre, descripcion)
 where p.nombre = v.nombre
   and p.descripcion is null;
