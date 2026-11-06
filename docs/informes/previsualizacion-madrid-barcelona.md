# Previsualización de Madrid y Barcelona

**6 de noviembre de 2026** · rama `fase-1-vendedores-distribuidores` · [PR #3](https://github.com/thedesignerux-lgtm/Market-Intelligence-/pull/3)

**Ninguna escritura en Supabase.** Ni `INSERT`, ni `UPDATE`, ni `DELETE`, ni migraciones, ni cargador. Las únicas consultas lanzadas contra la base han sido `SELECT`.

---

## Primero: no he podido ejecutar el comando, y hay una razón de seguridad

### Bloqueo 1 · No tengo la cadena de conexión

`npm run previsualizar` necesita `DATABASE_URL`, una conexión directa a PostgreSQL. Es un secreto de GitHub Actions. Aquí solo tengo el conector MCP de Supabase.

Como pediste, **no he buscado secretos ni he tocado la configuración**. Lo digo y paro.

### Bloqueo 2 · El comando, tal y como está, no sería de solo lectura

Este es el importante, y es un fallo de mi propio diseño que encontré al preparar la ejecución.

`construirRegistrosOsm()` llama a `ensureMunicipality()`, que si no encuentra los límites de un municipio **los descarga de OSM y los inserta en `admin_areas`**.

Comprobé el estado real de la base:

| Provincia | Municipios con límite cargado |
|---|---|
| A Coruña (15) | 93 |
| Lugo (27) | 67 |
| Ourense (32) | 92 |
| Pontevedra (36) | 61 |
| **Madrid (28)** | **0** |
| **Barcelona (08)** | **0** |

Previsualizar Madrid y Barcelona exigiría cargar antes unos **2.100 límites municipales**, y eso son miles de filas nuevas en `admin_areas`. Una escritura.

La CLI ya se detenía por una comprobación que puse, pero con un mensaje que no explicaba por qué. **Lo he corregido en la rama** para que diga exactamente esto: que cargar los límites es una escritura, que esta orden es de solo lectura, y que hace falta tu autorización.

Dicho de otro modo: **la orden que autorizaste no se puede cumplir tal cual sin romper la propia condición de solo lectura.** Prefiero decírtelo a ejecutarla y que se cuele una escritura de 2.100 filas.

### Lo que sí he hecho

Un banco de pruebas **sin conexión a la base**, que usa el código real de importación:

- `osmFeatureToRecord()` — la misma función que construye los registros en la importación real, con las reglas de categorías leídas de la base (solo `SELECT`).
- `scoreMatch()` — el mismo emparejador.
- Los extractos de OSM de Madrid y Barcelona ya descargados.

Lo único que no se puede reproducir sin escribir es la asignación de municipio. Más abajo explico por qué, en este caso concreto, no cambia el resultado.

---

## 1 · La previsualización usa las mismas reglas que la importación

No es una afirmación de diseño: son literalmente las mismas funciones.

| Qué | Importación real | Previsualización |
|---|---|---|
| Construir registros | `construirRegistrosOsm()` (`handlers.ts:373`) | `construirRegistrosOsm()` (`previsualizar.ts:61`) |
| Buscar candidatos | `findCandidates()` (`pipeline.ts:267`) | `findCandidates()` (`preview.ts:133`) |
| Puntuar | `scoreMatch()` (`pipeline.ts:269`) | `scoreMatch()` (`preview.ts:135`) |
| «Misma fuente nunca se une sola» | `pipeline.ts:284` | `preview.ts:153` |

No hay una segunda implementación de la deduplicación. Si las dos difirieran, sería un error, no un criterio distinto.

Además, una prueba automática recorre todo el SQL que ejecuta la previsualización y **falla si aparece cualquier `insert`, `update`, `delete`, `truncate`, `alter` o `drop`**.

---

## 2 · Resultado

De los dos extractos salen **1.493 elementos** examinados.

| Clase | Registros | |
|---|---|---|
| **Nuevas entidades** | **371** | Se crearían |
| **Ya existentes** | **0** | Ninguna coincide con la base actual |
| **Posibles duplicados** | **49** | En 30 parejas; se crearían y quedarían marcados para revisión |
| **Descartadas** | **1.073** | No llegan a registro |

371 + 49 = 420 candidatos. El resto son descartes.

### Por qué «existentes» es cero, y por qué es fiable

El emparejador solo mira entidades que cumplan una de estas cuatro condiciones: a menos de 1 km, mismo municipio con nombre parecido, mismo NIF, o **mismo teléfono o misma web**.

- Las 782 entidades actuales están en Galicia; las candidatas, en Madrid y Barcelona. Las tres primeras vías quedan descartadas por geografía.
- La cuarta sí podía cruzar provincias, así que la comprobé: crucé los **170 teléfonos y 146 dominios** únicos de las candidatas contra `contact_points`. **Cero coincidencias.**

Por eso la falta de asignación municipal no altera el resultado: ninguna de las vías de emparejamiento habría encontrado nada.

### Descartadas, por motivo

| Motivo | Nº |
|---|---|
| Ninguna regla de categorías lo clasifica | 1.056 |
| Sin nombre en OpenStreetMap | 15 |
| **Cadena excluida de la captación** | **2** |

Los 1.056 sin categoría son lo que ya medimos: tiendas de deporte genéricas, clubes de otros deportes y mayoristas de otros sectores. No son tiendas de bici.

### Los 30 pares de duplicados: ninguno se fusionaría solo

De los 30 pares, 14 puntúan como `same` (hasta 1,00) y 16 como `review`. **Ninguno se uniría automáticamente**, porque ambos registros vienen de `osm` y la regla «dos registros de la misma fuente nunca se unen solos» los fuerza a revisión manual.

Ejemplos reales:

| Par | Decisión | Qué es |
|---|---|---|
| Rincón del Trece ↔ Rincón del Trece | same 1,00 | El mismo negocio mapeado dos veces |
| BiciHub ↔ BiciHub | same 1,00 | Ídem |
| Biking Point ↔ Biking Point | same 0,85 | Ídem |
| **Biciclot ↔ BiciHub** | review 0,77 | **Negocios distintos** con nombre parecido y cercanos |
| **Terra BikeTours ↔ Canyon Barcelona** | review 0,62 | **Negocios distintos**; coinciden por proximidad |

Los dos últimos son falsos positivos del heurístico. No es un fallo: para eso existe la cola de revisión. Pero conviene saber que de esas 30 parejas, **no todas son duplicados reales**, y revisarlas a mano es trabajo de media hora, no de un clic.

---

## 3 · Desglose de las 371 nuevas

### Por tipo de establecimiento

| Categoría | Nº |
|---|---|
| Tienda de bicicletas | 360 |
| Taller de bicicletas | 7 |
| Club ciclista | 4 |

No aparece ningún distribuidor: en OSM casi nadie etiqueta `shop=wholesale` + `wholesale=bicycle`. Confirma que **la vía para los distribuidores es la investigación, no OSM.**

### Por disponibilidad de contacto

| Canal | Nº | % |
|---|---|---|
| **Con algún canal** | **201** | **54 %** |
| Teléfono | 155 | 42 % |
| Web | 145 | 39 % |
| Email | 57 | 15 % |
| **Sin ningún canal** | **170** | **46 %** |

### Qué significa para GROPO

| | Hoy | Después |
|---|---|---|
| Comercios en la base | 102 | **473** |
| Comercios contactables | 33 | **234** |
| Con email | 17 | **74** |

**Multiplica por siete los vendedores a los que puedes escribir.**

Los 170 sin canal no son inútiles: tienen nombre y dirección, y se pueden enriquecer después. Pero no se pueden trabajar comercialmente tal cual.

---

## 4 · Tiendas independientes: 388 de 420

Filtrando cadenas y tiendas de marca (Trek, Specialized, Canyon, Orbea, Giant, BH, Mammoth, Calmera…), quedan **388 tiendas independientes**, de las cuales **202 tienen contacto** y 58 tienen email.

Son el núcleo comercial de GROPO: negocio local, dueño que decide el precio, y margen para una oferta cerrada a un grupo de ciclistas.

Una muestra de las que tienen contacto directo:

| Tienda | Teléfono | Web | Email |
|---|---|---|---|
| Bicis Torrejón | +34 911 720 903 | bicistorrejon.com | bicistorrejon@gmail.com |
| ¡Viva Bicicletas! | +34 910 248 957 | vivabicicletas.com | hola@vivabicicletas.com |
| Bicicletas Tándem | +34 918 587 407 | bicicletastandem.com | bicicletastandem@gmail.com |
| Urban Biking | +34 918 265 070 | avantumcompanystore.com.es | ventas@avantum.info |
| Ciclos Moratalaz | +34 913 283 564 | ciclosmoratalaz.com | — |
| Bicicletas Carpizo | +34 916 105 435 | bicicletascarpizo.com | — |
| Alcalá Bikes | +34 912 657 867 | alcalabikes.es | — |
| Bicicletas Tomás | +34 916 465 866 | bicicletastomas.com | — |

La lista completa de las 202 está en `/tmp/informe.json` del entorno de trabajo; se regenera con el banco de pruebas. **No se ha enviado ninguna comunicación comercial.**

---

## 5 · Decathlon y Sprinter

| Comprobación | Resultado |
|---|---|
| Establecimientos descartados por cadena excluida | **2**, ambos llamados «Decathlon», los dos en Barcelona |
| Cadenas excluidas que se colarían entre las 420 candidatas | **0** |
| Tiendas independientes con nombre parecido descartadas por error | **0** |

Los dos Decathlon descartados son los que llevan etiquetas de servicio de bicicleta en OSM y **sí pasaban las reglas de categorías**. La exclusión hace exactamente lo que decidiste: los aparta de la captación sin tocar las reglas generales.

El resto de Decathlon y Sprinter (unos 76 entre las dos provincias) ya caían antes por no estar clasificados como ciclismo, así que ni llegan a la lista.

Sobre los falsos positivos: el patrón exige palabra completa por los dos lados. Durante el desarrollo, una prueba detectó que «Bicicletas Sprinterman» quedaba excluida por contener «sprinter»; está corregido y hay prueba que lo vigila. En estas 420 candidatas **no hay ningún nombre parecido que se haya descartado por error**.

---

## 6 · Neomouv y Prowen Bikes

Siguen documentadas y siguen fuera de la carga, a propósito.

| Empresa | Localidad | Clave | Qué falta |
|---|---|---|---|
| Neomouv | Vitoria-Gasteiz (Álava) | `sin-web:neomouv` | Web oficial |
| Prowen Bikes (JL Wenti) | Lucena (Córdoba) | `sin-web:prowen bikes jl wenti` | Web oficial |

El cargador en seco las sigue listando como descartadas con el motivo «Sin web conocida: no hay clave estable para deduplicar».

**He ampliado la documentación** en `data/distribuidores/README.md`: antes la regla estaba explicada en general, ahora las dos empresas aparecen nombradas en una tabla de «Pendientes de resolución manual», con lo que falta de cada una y cómo incorporarlas.

---

## Qué autorizar para continuar

Por orden, y cada uno es una decisión separada:

1. **Cargar los límites municipales de Madrid y Barcelona** (~2.100 filas en `admin_areas`). Es la escritura que desbloquea la previsualización real. Sin esto no hay importación posible.
2. **Ejecutar la previsualización con conexión real**, que confirmará estos números contra la base.
3. Aplicar la migración 17.
4. Ejecutar el cargador con `--escribir`.
5. Fusionar el PR.

Para los pasos 1, 2 y 4 necesito además que la cadena de conexión llegue por una vía que autorices tú; no la voy a buscar.

Si prefieres no darme acceso de escritura en ningún caso, hay alternativa: ejecutas tú los comandos y me pasas la salida. La previsualización tiene `--json` justo para eso.

---

## Resumen de seguridad

| Restricción | Cumplida |
|---|---|
| No aplicar migraciones | ✅ ninguna |
| No ejecutar INSERT, UPDATE o DELETE | ✅ solo `SELECT` |
| No activar el cargador | ✅ solo lectura del fichero, sin base de datos |
| No fusionar el PR | ✅ abierto |
| No enviar comunicaciones comerciales | ✅ ninguna |
| No buscar secretos ni tocar configuración | ✅ bloqueo reportado, no sorteado |
