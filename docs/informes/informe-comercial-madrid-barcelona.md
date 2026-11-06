# Vendedores potenciales en Madrid y Barcelona

**Informe comercial · 6 de noviembre de 2026**

Este documento es independiente del trabajo técnico: no habla de migraciones, ramas ni importaciones. Describe a quién se puede contactar y con qué prioridad.

Ninguna de estas empresas ha sido contactada.

---

## Resumen

**209 tiendas de ciclismo independientes con al menos un canal de contacto**, en Madrid y Barcelona.

Independientes significa que se han excluido las cadenas y las tiendas de marca (Decathlon, Sprinter, Trek, Specialized, Canyon, Orbea, Giant, BH, Mammoth, Calmera). Son negocios locales, con dueño que decide el precio, que es la condición para cerrar una oferta a un grupo de ciclistas.

| | Nº |
|---|---|
| Tiendas de bicicletas | 202 |
| Talleres | 5 |
| Clubes ciclistas | 2 |
| **Total contactable** | **209** |

| Canal | Nº |
|---|---|
| Teléfono | 156 |
| Web | 149 |
| **Email** | **61** |

El email es el canal escaso y el único que permite una primera aproximación sin llamar.

---

## Prioridad comercial

La prioridad **solo usa datos disponibles**. No hay estimaciones de facturación, tamaño ni encaje: no tenemos esos datos y no se han inventado. Cada fila del listado lleva escrito su motivo.

| Prioridad | Nº | Criterio |
|---|---|---|
| **Alta** | **60** | Email directo y al menos dos canales de contacto |
| Media-alta | 50 | Dos canales de contacto |
| Media | 97 | Un solo canal |
| Media-baja | 2 | Un solo canal y sin señal de venta |

### Las 60 de prioridad alta

| Comunidad | Nº |
|---|---|
| Cataluña | 38 |
| Comunidad de Madrid | 22 |

Concentración: Barcelona 15, Madrid 10, Vic 5, Vilanova i la Geltrú 5, l'Hospitalet 5, Parla 3.

**Vic y Vilanova i la Geltrú merecen una mirada aparte.** Son ciudades pequeñas con 5 tiendas de prioridad alta cada una: una densidad muy superior a la de las capitales en proporción a su tamaño. Son zonas de ciclismo fuerte, y una comunidad local allí tiene más probabilidades de agrupar demanda real que una en Barcelona ciudad, donde la oferta está dispersa.

---

## Qué ofrece cada tienda

Sale **únicamente de las etiquetas de OpenStreetMap**. 207 de las 209 declaran algo; 2 salen con el campo vacío porque OSM no lo dice, y así se han dejado.

| Oferta | Nº |
|---|---|
| Solo venta | 101 |
| Venta y taller | 50 |
| Venta, taller y autoreparación | 14 |
| Venta, taller y segunda mano | 11 |
| Venta y alquiler | 8 |
| Otras combinaciones | 25 |

Las que tienen **taller** (unas 90) son mejores candidatas de lo que parece: un taller implica trato recurrente con ciclistas locales, que es exactamente el público que GROPO agrupa.

---

## El listado

`tiendas-independientes-contactables.csv`, ordenado por prioridad y luego por comunidad y municipio.

Columnas: Prioridad · Motivo · Comunidad · Provincia · Municipio · Nombre · Tipo · Oferta · Teléfono · Email · Web · Dirección · ID de OpenStreetMap

Muestra de prioridad alta:

| Municipio | Tienda | Oferta | Teléfono | Email |
|---|---|---|---|---|
| Barcelona | Cicles Biela | venta, taller, segunda mano, autoreparación | +34 932 388 979 | info@ciclesbiela.com |
| Barcelona | Bicis Maria | venta, taller, segunda mano | +34 637 771 675 | hola@bicismaria.com |
| Barcelona | Espaibici | venta, taller | +34 935 323 143 | botiga@espaibici.com |
| Barcelona | Bicicletes Castells | venta, taller | +34 932 316 058 | info@castellsbicicletes.com |
| Barcelona | My Beautiful Parking | venta, taller, alquiler | +34 935 108 724 | peloton@mbp-bcn.com |
| Madrid | Bicis Torrejón | venta, taller | +34 911 720 903 | bicistorrejon@gmail.com |
| Madrid | ¡Viva Bicicletas! | venta | +34 910 248 957 | hola@vivabicicletas.com |

---

## Qué NO dice este informe

Conviene tenerlo claro antes de usarlo para planificar:

- **No sabemos si venden al tipo de público de GROPO.** Sabemos que son tiendas de bicicletas independientes; no si trabajan ciclismo de carretera, montaña o urbano.
- **No sabemos su tamaño ni su capacidad de descuento.** Ninguna fuente pública lo dice.
- **Los datos vienen de OpenStreetMap**, que es colaborativo: un teléfono puede estar desactualizado y una tienda puede haber cerrado. La propia base marca como cerradas las que OSM señala, pero eso depende de que alguien lo haya actualizado.
- **No están todas.** Son las que OSM tiene mapeadas y clasificadas como ciclismo. Habrá tiendas reales que no aparezcan.

Lo que sí es sólido: los nombres, las direcciones y los canales de contacto de 209 negocios reales, con su procedencia trazable hasta el elemento concreto de OpenStreetMap.

---

## Dos avisos antes de usar la lista

**No está cargada en Market Intelligence todavía.** Este listado sale de una previsualización, no de una importación. Hasta que se autorice la carga, la plataforma sigue con sus 102 comercios.

**Unas 26 entradas podrían ser duplicados.** El mismo negocio aparece a veces dos veces en OpenStreetMap, y el sistema las marcará para revisión manual al importar. Si se trabaja la lista antes de esa revisión, puede darse el caso de contactar dos veces al mismo sitio. Las parejas concretas están identificadas en `duplicados-a-revisar.csv`.
