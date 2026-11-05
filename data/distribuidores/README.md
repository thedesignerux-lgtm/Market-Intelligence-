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

Las empresas sin web conocida quedan con una clave `sin-web:<nombre normalizado>` y hay que resolverlas a mano antes de incorporarlas.

## Cómo se regenera

```
python3 scripts/analisis/construir-dataset-distribuidores.py
```

El script lleva los datos dentro. No descarga nada: las fuentes se consultaron una vez y se transcribieron, para que el fichero sea reproducible y revisable en un diff.

## Estado

Ninguna de estas empresas se ha cargado en la base de datos todavía. Falta decidir por qué vía se incorporan (ver el informe de la Fase 1).
