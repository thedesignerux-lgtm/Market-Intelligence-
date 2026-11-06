# Investigación de distribuidores

`investigacion-2026-11.json` es una lista de distribuidores, mayoristas, fabricantes, marcas y centrales de compra del sector del ciclismo en España, con la procedencia de cada dato.

## Qué garantiza

Cada campo lleva `fuente`, `metodo` y `observado`. El método distingue el grado de verificación:

| Método | Significa |
|---|---|
| `verified` | Leído en la web de la propia empresa. |
| `found` | Leído en un directorio sectorial (AMBE). |
| `inferred` | Deducido por el directorio, sin confirmar en origen. El directorio bicicleta.es deduce la web de la captura de pantalla de la ficha, no de un enlace. |

**Un campo que no se ha podido verificar no aparece.** No se estima, no se rellena con un valor plausible y no se deja vacío con una etiqueta. Si falta `email`, es que nadie ha visto un email público de esa empresa.

## Fuentes

| Fuente | Qué aporta | Fiabilidad |
|---|---|---|
| [Asociados de AMBE](https://asociacionambe.com/asociados/) | 52 empresas con nombre y web. AMBE es la patronal del sector. | Alta: es la lista de socios de la propia asociación. |
| [Directorio de mayoristas de bicicleta.es](https://www.bicicleta.es/sitios/category/mayorista/) | 14 empresas con localidad. | Media: directorio de terceros, webs deducidas. |
| Webs de las propias empresas | Especialización, cobertura, contacto comercial, portal B2B. | Alta, pero solo para las fichas verificadas una a una. |

## Clave de deduplicación

Las empresas se identifican por **dominio web**, no por nombre: dos fuentes que citan la misma web son la misma empresa. Por eso «Gurpil» (AMBE) y «Gurpilan S.L.» (directorio) son un solo registro.

Las empresas sin web conocida quedan con una clave `sin-web:<nombre normalizado>`. El cargador **las descarta a propósito**: sin dominio no hay clave estable, y darlas de alta por nombre arriesga duplicarlas en cuanto aparezcan en otra fuente.

### Pendientes de resolución manual

| Empresa | Localidad | Qué falta |
|---|---|---|
| **Neomouv** | Vitoria-Gasteiz (Álava) | Web oficial. El directorio la lista como fabricante y mayorista, pero no enlaza su dominio. |
| **Prowen Bikes (JL Wenti)** | Lucena (Córdoba) | Web oficial. El directorio la lista como distribuidor, fabricante y mayorista. |

Para incorporarlas: confirma su dominio, añádelo como campo `web` con método `verified` y vuelve a generar el fichero. El cargador las recogerá en la siguiente pasada.

## Cómo se regenera

```
python3 scripts/analisis/construir-dataset-distribuidores.py
```

El script lleva los datos dentro. No descarga nada: las fuentes se consultaron una vez y se transcribieron, para que el fichero sea reproducible y revisable en un diff.

## Qué carga el cargador, y qué no

Por defecto solo entran las empresas con **tipo declarado y con fuente**: 13 de las 64.

| Entran | Nº |
|---|---|
| Mayoristas | 8 |
| Distribuidores | 3 |
| Central de compras | 1 |
| Marca | 1 |

Las demás se quedan fuera **con el motivo escrito**, no en silencio:

| Se quedan fuera | Nº | Por qué |
|---|---|---|
| Sin tipo verificado | 48 | Entrarían como «Distribuidor de bicicletas» genérico, y entre ellas están Trek, Shimano, Specialized, Canyon y Campagnolo, que son marcas. Un mayorista y una marca no se abordan igual: la etiqueta equivocada cambia el primer contacto, no solo la ficha. |
| Cadena excluida | 1 | Decathlon. Misma razón que en la ruta de OSM (ADR-0011): precios centralizados, sin capacidad de cerrar una oferta agrupada. |
| Sin web conocida | 2 | Neomouv y Prowen Bikes: sin dominio no hay clave estable para deduplicar. |

Para cargarlas todas como distribuidor genérico, de forma explícita:

```
npm run cargar -- data/distribuidores/investigacion-2026-11.json --generico --escribir
```

### Cómo clasificar las 48 pendientes

El directorio de AMBE **no publica categorías**: comprobado el 06-11-2026, solo da nombres y enlaces. La frase «empresas que producen, importan y distribuyen» es genérica y no asigna categoría a nadie.

La vía que sí da método `verified` es leer la web de cada empresa y recoger qué dice ser. Son 48 consultas. Añade a cada empresa un campo `tipo` con uno de estos valores y vuelve a generar el fichero:

`mayorista` · `fabricante` · `marca` · `central_de_compras` · `distribuidor`

## Estado

Ninguna de estas empresas se ha cargado en la base de datos todavía. Falta decidir por qué vía se incorporan (ver el informe de la Fase 1).
