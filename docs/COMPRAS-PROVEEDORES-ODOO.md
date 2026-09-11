# Cruce de proveedores con Odoo — qué destraba las órdenes de compra

Medido el 2026-09-11 contra `polcecal-staging-37495859`.

> El padrón de Odoo que se leyó es el de **staging**, que es una copia del 03/09.
> Los CUIT de acá sirven para decidir, pero antes de enlazar en serio conviene
> reconfirmarlos contra producción: un proveedor dado de alta después no está en
> esta copia.
Padrones: **293** proveedores del SdG, **611** partners proveedores de Odoo.

## Lo primero: el botón de enlazar ya no tiene nada que hacer

Correr el cruce de `/compras/configuracion` hoy escribe **0 filas nuevas**: las 209
que se pueden deducir por CUIT ya están. Lo que falta no sale de volver a cruzar,
sale de arreglar los datos. Son tres cosas, y la primera es barata.

## El estado, sobre los pedidos que importan

| | RI |
|---|---|
| En PEDIDO con proveedor y costo cargado | 1682 |
| **Pueden generar orden hoy** | **1305** |
| Trabados por el proveedor | 377 |

## 1. CUIT duplicados dentro del padrón del SdG — 0, 0 RI

El cruce **no enlaza un CUIT que aparece dos veces en el SdG**, y con razón: dos
filas apuntando al mismo partner después no se sabe cuál es cuál. El caso típico es
una **persona** cargada con el CUIT de la empresa para la que trabaja; sacándole el
CUIT a la persona, el cruce enlaza la empresa solo.

**Ninguno hoy.** El 11/09/2026 eran tres y trababan 135 pedidos —`Diego Guarrochena`
con el CUIT de *Todo Ruleman*, `Gimena Trackmar` con el de *Track Mar*, y tres Priola
con el de *Zito y Priola*—. Se les sacó el CUIT y quedaron enlazadas las dos empresas
con pedidos; los ids de partner se verificaron contra producción antes de escribirlos.

## 2. 153 proveedores sin CUIT en el SdG — 355 RI

Es la causa grande, y no se arregla cruzando: **sin CUIT no hay por dónde**. Lo que
sí se puede es proponer, y que alguien confirme. Abajo, cada proveedor con los
partners de Odoo que se le parecen por nombre.

**Ninguno de estos está enlazado ni lo va a estar solo.** Enlazar al que se le parece
es la trampa que este módulo ya pagó: un enlace equivocado manda la orden al CUIT de
otro y no se nota nunca. La forma de resolverlo es **cargarle el CUIT al proveedor del
SdG** — el de la columna de la derecha, si es el correcto — y volver a correr el cruce,
que ahí sí lo va a enlazar por CUIT y no por parecido.

### Con candidato en Odoo — 52 proveedores, 259 RI

La columna **Seguridad** dice cuánto del nombre del SdG aparece en el de Odoo.
Un `parcial` es una coincidencia de una sola palabra y hay que mirarlo dos veces:
`MERCADO LIBRE` engancha con `COMPAÑIA ADMINIST DEL MERCADO MAYORISTA ELECTRICO`
nada más que por la palabra *MERCADO*, y es otra empresa. Eso, cargado sin mirar,
manda 33 órdenes de compra al CUIT equivocado.

| RI | Proveedor del SdG | Candidato en Odoo | CUIT que le pondría | Empresas | Seguridad |
|---:|---|---|---|---|---|
| 67 | FUNDICIONES NAVARRO | FUNDICION ELECTRICA NAVARRO S.A. | `30710597363` | Polysan S.A, Polcecal S.A | **parcial** |
| 33 | MERCADO LIBRE | COMPA#IA ADMINIST DEL MERCADO MAYORISTA ELECTRICO SOC ANONIMA | `30655373094` | Polcecal S.A | **parcial** |
| 20 | PAGANO | PAGANO BIASSI VICTOR | `20223886230` | Polysan S.A, Polcecal S.A | entero |
|  |  | Pagano Y kopaitch | `30673989515` | Polcecal S.A | entero |
|  |  | pagano victor | `—` | COMPARTIDO | entero |
| 16 | PETROTANDIL | PETROTANDIL SOCIEDAD ANONIMA COMERCIAL INDUSTRIAL E INMOBILIARIA | `30535230842` | Polysan S.A, Polcecal S.A | entero |
| 14 | ZITO Y PRIOLA | ZITO Y PRIOLA S.R.L. | `30711820279` | Polcecal S.A, Polysan S.A | entero |
|  |  | PRIOLA MARCOS OMAR | `20200631723` | Polcecal S.A | **parcial** |
| 12 | ZMG | ZMG ARGENTINA OLAVARRIA SOCIEDAD DE RESPONSABILIDAD LIMITADA S. R. L. | `30718163966` | COMPARTIDO | entero |
|  |  | ZMG ARGENTINA SRL | `30710376170` | COMPARTIDO | entero |
| 9 | BERNER | BERNER S A | `30707934219` | Polysan S.A, Polcecal S.A | entero |
| 8 | FIPH SA | FIPH S.A. | `30711432899` | Polysan S.A, Polcecal S.A | entero |
|  |  | fiph | `—` | COMPARTIDO | entero |
| 7 | RIGO | RIGO GUSTAVO IVAN | `23215742989` | COMPARTIDO | entero |
| 5 | REY Y RONZONI | REY Y RONZONI S R L | `33526975869` | Polysan S.A | entero |
| 5 | ORITI | ORITI GUSTAVO RICARDO ORITI CARLOS ANGEL | `30666617130` | Polcecal S.A, Polysan S.A | entero |
| 5 | PAPEL MISIONERO | PAPEL MISIONERO S A I F C | `30540372892` | Polcecal S.A, Polysan S.A | entero |
| 3 | G&L ENVASES | ENVASES RECICLADOS S.A. | `30714428744` | Polysan S.A, Polcecal S.A | entero |
| 3 | ESTO MATERIALES | ARREMAT MATERIALES Y EQUIPAMIENTOS S. A. | `30717435059` | Polcecal S.A | **parcial** |
|  |  | EL MANU MATERIALES RURALES DE OLAVARRIA S. R. L. | `30717444074` | Polcecal S.A, Polysan S.A | **parcial** |
|  |  | MATERIALES EL HANGAR S.A. | `30710844972` | Polcecal S.A, Polysan S.A | **parcial** |
| 3 | EL HANGAR | MATERIALES EL HANGAR S.A. | `30710844972` | Polcecal S.A, Polysan S.A | entero |
| 3 | EL MANU MATERIALES | EL MANU MATERIALES RURALES DE OLAVARRIA S. R. L. | `30717444074` | Polcecal S.A, Polysan S.A | entero |
|  |  | ARREMAT MATERIALES Y EQUIPAMIENTOS S. A. | `30717435059` | Polcecal S.A | **parcial** |
|  |  | MATERIALES EL HANGAR S.A. | `30710844972` | Polcecal S.A, Polysan S.A | **parcial** |
| 2 | FARA | FARA SCA | `30504156342` | COMPARTIDO, Polcecal S.A | entero |
| 2 | HOFFER | HOFFER JOSE ALBERTO | `20258253257` | Polcecal S.A, Polysan S.A | entero |
| 2 | BULL VIAL | BULL VIAL S.R.L. | `30708017570` | Polcecal S.A, Polysan S.A | entero |
| 2 | GRASSO | GRASSO MARIA LAURA | `27302759788` | Polysan S.A, Polcecal S.A | entero |
| 2 | RAS | RAS SA | `30620743336` | Polcecal S.A | entero |
| 2 | MARIO MARTINEZ | MARTINEZ MARIO JOSE | `20178466675` | Polcecal S.A, Polysan S.A | entero |
|  |  | LOPEZ MARIO ALBERTO | `20276056450` | COMPARTIDO | **parcial** |
|  |  | MARTINEZ ESCALADA S A | `30506525418` | Polysan S.A, Polcecal S.A | **parcial** |
| 2 | BULL-VIAL | BULL VIAL S.R.L. | `30708017570` | Polcecal S.A, Polysan S.A | entero |
| 2 | RESORTES RULCON | RESORTES ALMEYRA S.R.L. | `30714966061` | Polysan S.A, Polcecal S.A | **parcial** |
| 2 | RAVIOLI | RAVIOLI RODAMIENTOS S.R.L. | `30714522716` | Polcecal S.A | entero |
| 2 | TORRACO | TORRACO PABLO JAVIER | `23214811839` | Polysan S.A, Polcecal S.A | entero |
| 1 | TALLEI | TALLEI EMILIO Y TALLEI JUAN MANUEL | `30715457268` | Polcecal S.A | entero |
| 1 | SABATINI | DISTRIBUIDORA SABATINI SRL | `30709532509` | Polcecal S.A, Polysan S.A | entero |
| 1 | VALES | VALES OSCAR ALEJANDRO | `20226781448` | Polysan S.A | entero |
| 1 | FLEXIRIGS, BRALBOL | BRALBOL S.A. | `30715153528` | Polcecal S.A, Polysan S.A | **parcial** |
| 1 | TORRACO, BOLSAGRO | BOLSAGRO E HIJOS S. R. L. | `30718011678` | Polysan S.A, Polcecal S.A | **parcial** |
|  |  | TORRACO PABLO JAVIER | `23214811839` | Polysan S.A, Polcecal S.A | **parcial** |
| 1 | MARTINEZ MARIO | MARTINEZ MARIO JOSE | `20178466675` | Polcecal S.A, Polysan S.A | entero |
|  |  | LOPEZ MARIO ALBERTO | `20276056450` | COMPARTIDO | **parcial** |
|  |  | MARTINEZ ESCALADA S A | `30506525418` | Polysan S.A, Polcecal S.A | **parcial** |
| 1 | BOLSAGRO, TORRACO | BOLSAGRO E HIJOS S. R. L. | `30718011678` | Polysan S.A, Polcecal S.A | **parcial** |
|  |  | TORRACO PABLO JAVIER | `23214811839` | Polysan S.A, Polcecal S.A | **parcial** |
| 1 | TORRACO, BOLSAFLEX, RECUPERADORA DEL SUR | COOPERATIVA RECUPERADORA DEL SUR LIMITADA | `30718215044` | Polysan S.A, Polcecal S.A | **parcial** |
| 1 | BOLSAFLEX, TORRACO, RECUPERADORA DEL SUR | COOPERATIVA RECUPERADORA DEL SUR LIMITADA | `30718215044` | Polysan S.A, Polcecal S.A | **parcial** |
| 1 | SINGLA, FASE 3 | FASE 3 DE DIEGO ENRIQUE CORIA,MAXIMILIANO DAMIAN CORIA Y YESICA VANESA PEREZ DE ALESANDRE | `30711482306` | Polysan S.A, Polcecal S.A | **parcial** |
|  |  | SINGLA ELECTRICIDAD S.A. | `30666555097` | Polcecal S.A, Polysan S.A | **parcial** |
| 1 | TORRACO, BOLSAFLEX | TORRACO PABLO JAVIER | `23214811839` | Polysan S.A, Polcecal S.A | **parcial** |
| 1 | MAGNUM | ESTABLECIMIENTOS ELECTROMECANICOS MAGNUM SRL | `30568794296` | Polysan S.A | entero |
| 1 | TRACK MAR - EQUIPARTES | TRACK MAR SACI | `30563044914` | Polcecal S.A, Polysan S.A | **parcial** |
| 1 | KAKTUS PAMPA | KAKTUS PAMPA S. A. | `30718062426` | Polysan S.A | entero |
| 1 | ARISTÓBULO GOMEZ RUPEREZ | ARISTOBULO GOMEZ RUPEREZ SOCIEDAD ANONIMA | `30602846063` | Polysan S.A | entero |
| 1 | TORRACO, TRADECOR | TORRACO PABLO JAVIER | `23214811839` | Polysan S.A, Polcecal S.A | **parcial** |
|  |  | TRADECOR COMEX | `30719122198` | Polysan S.A | **parcial** |
| 1 | MARTIN LABACA | LABACA MARTIN ALBERTO | `20224464704` | Polysan S.A | entero |
|  |  | ALBORNOZ MARTIN ARNALDO | `20265322337` | COMPARTIDO | **parcial** |
|  |  | CAPRI MARTIN | `20290234752` | Polcecal S.A, Polysan S.A | **parcial** |
| 1 | TRADECOR | TRADECOR COMEX | `30719122198` | Polysan S.A | entero |
| 1 | TODO RULEMAN, EQUIPARTES | TODO RULEMAN 7400 S. A. | `30590139072` | Polysan S.A, Polcecal S.A | **parcial** |
| 1 | ECHEVARNE | ECHEVARNE HNOS. S.A. | `30710606923` | Polysan S.A | entero |
| 1 | TRACK MAR, EQUIPARTES | TRACK MAR SACI | `30563044914` | Polcecal S.A, Polysan S.A | **parcial** |
| 1 | PETERSEN | PETERSEN CHRISTIAN  MARIANO | `20243393036` | Polysan S.A | entero |
| 1 | TRACK MAR, REPUESTOS GRASSO | TRACK MAR SACI | `30563044914` | Polcecal S.A, Polysan S.A | **parcial** |
| 1 | ELECTROMECÁNICA PELLEGRINI | ELECTROMECANICA PELLEGRINI DE OCCHI Y OROQUIETA EDUARDO | `30666548279` | Polysan S.A, COMPARTIDO | entero |
|  |  | "ELECTROMECANICA CATTOZZO  SRL" | `30708699574` | Polcecal S.A | **parcial** |
|  |  | Materiales Pellegrini | `30698638199` | Polysan S.A | **parcial** |
| 1 | Sur Técnica | COOPERATIVA RECUPERADORA DEL SUR LIMITADA | `30718215044` | Polysan S.A, Polcecal S.A | **parcial** |
| 1 | BOGGIO | INGENIERIA BOGGIO S A | `30502613126` | Polcecal S.A, Polysan S.A | entero |

### Sin ningún candidato — 36 proveedores, 96 RI

O están en Odoo con un nombre que no se parece, o no están. Hay que buscarlos a mano
o darlos de alta allá.

- 36 RI — **RANDAZZO**
- 6 RI — **PINTURERIA ARCO IRIS**
- 5 RI — **FLEXIRIGS**
- 5 RI — **Prestigio**
- 5 RI — **ARCO IRIS**
- 2 RI — **ACERO RINCON**
- 2 RI — **ESTILO ROLLER**
- 2 RI — **PETTACHI**
- 2 RI — **TRAXION**
- 2 RI — **DANILO**
- 2 RI — **EL CLÁSICO**
- 2 RI — **MEMBRANERO FEDE**
- 2 RI — **CIUFFO**
- 1 RI — **GL TECHNO**
- 1 RI — **SHELL**
- 1 RI — **ORITTI**
- 1 RI — **KLUBERTOP**
- 1 RI — **PLATINO, ZMG, TRACK MAR, EQUIPARTES**
- 1 RI — **PREPOLIMER**
- 1 RI — **COMPRA GAMER**
- 1 RI — **PAPELERA M Y M**
- 1 RI — **BOLSAGRO, TORRACO, BOLSAFLEX**
- 1 RI — **MAXI**
- 1 RI — **TORRACO, BOLSERA, BOLSAFLEX**
- 1 RI — **TORRACO, RECYCLE BAGS**
- 1 RI — **ALERTA 2DA OFERTA**
- 1 RI — **CHANTIRI**
- 1 RI — **RECYCLE BAGS, BRALBOL**
- 1 RI — **FORJA CÓRDOBA**
- 1 RI — **Megaclean**
- 1 RI — **MESSINEO**
- 1 RI — **G & L**
- 1 RI — **BOLSAFLEX, BOLSERA, TORRACO, RECYCLE BAG**
- 1 RI — **BOLSAFLEX, TORRACO, RECYCLE BAG**
- 1 RI — **FORJA CÓRDIOBA**
- 1 RI — **FERRAMSUR**

## 3. 16 RI de pedidos AMBAS con el proveedor en una sola empresa

El proveedor está enlazado, pero sólo en una de las dos. Un RI que pagan las dos
necesita las dos órdenes, así que falta darlo de alta en Odoo en la otra empresa.

- 5 RI — **Marfra** (cuit 30-71441233-3) — sólo en POLCECAL
- 3 RI — **Tecnicor** (cuit 27-25039187-6) — sólo en POLCECAL
- 3 RI — **Da Vinci** (cuit 23-25825469-4) — sólo en POLCECAL
- 3 RI — **Lüsqtoff** (cuit 30-71843251-7) — sólo en POLYSAN
- 1 RI — **Matelec** (cuit 30-54259670-4) — sólo en POLCECAL
- 1 RI — **Bazar "La esquina"** (cuit 20-36215654-9) — sólo en POLCECAL

## 4. 15 con CUIT que no están en Odoo — 0 RI en PEDIDO

Tienen CUIT válido y ningún partner con ese CUIT del otro lado. **Ninguno tiene
pedidos hoy**, así que no urge: se resuelven cuando aparezca el primero.

- Matafuegos Messineo — `33-66656441-9`
- FAS S.A. — `30689471524`
- Ecofilt S.A. — `30-61555576-9`
- Agrorepuestos Olavarría — `30-64141862-1`
- Ámbito — `30-70766070-4`
- Biar — `30-70824319-8`
- Ferreteria Victor — `33-70800536-9`
- Flexatec — `30-71487501-5`
- Frenos Norte — `30-71815239-5`
- Galarza — `30-58556944-1`
- Gasatex — `30-64441641-7`
- Movimientos Indumec — `30-71110449-2`
- OLAFIL — `30-71495169-2`
- Tornería TIN — `30-70966771-4`
- Uldem — `20-45620998-0`
