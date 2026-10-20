# Market Intelligence

Plataforma interna de inteligencia comercial y territorial: descubre, importa, organiza y gestiona comercios, clubes y asociaciones reales en España. Cobertura actual: **toda Galicia** (313 municipios), vertical **ciclismo**. El piloto empezó en Santiago de Compostela.

## Estado

Fase 1 en curso.

| Componente | Estado |
|---|---|
| Esquema de base de datos (13 migraciones): entidades, procedencia por campo, deduplicación, importaciones, CRM mínimo, auditoría, RLS | ✅ Probado en local |
| Importador del Rexistro de Entidades Deportivas de Galicia (clubes) con geocodificación CartoCiudad | ✅ Probado con datos reales |
| Importador de OpenStreetMap (tiendas y talleres de bicicletas) desde extractos provinciales | ✅ Probado con datos reales |
| Worker con cola persistente, reintentos y recuperación | ✅ |
| Búsqueda, mapa con agrupación y control de importaciones (funciones SQL) | ✅ Probado en local |
| Proyecto Supabase: 13 migraciones aplicadas, asesor de seguridad revisado | ✅ |
| Datos reales de toda Galicia: 728 entidades (622 clubes RED, 105 comercios OSM), 494 con ubicación | ✅ |
| Aplicación web: resumen, directorio, ficha con procedencia, mapa, CRM mínimo, duplicados, importaciones | ✅ Probada de extremo a extremo (18/18) |
| Dashboard comercial: 4 indicadores, roles comprador/vendedor, participación en GROPO con prueba, próxima acción y pantalla Seguimiento | ✅ Probado de extremo a extremo (27/27) y con pruebas SQL (30/30) |
| Aplicación web desplegada en Vercel | ✅ |
| Importador en GitHub Actions (cada noche y bajo demanda desde la web) | ✅ Verificado en producción |

## Estructura

```
supabase/migrations/   Esquema de la base de datos (fuente de verdad)
src/lib/domain/        Lógica pura: normalización, deduplicación, categorías
worker/                Importadores, geocodificación, cola y CLI
tests/unit/            Pruebas unitarias
tests/integration/     Pruebas de la ingesta contra PostgreSQL (datos de prueba marcados)
tests/sql/             Pruebas de seguridad (RLS) y funciones SQL
scripts/test-db.sh     Prueba completa de extremo a extremo con datos reales
docs/decisiones.md     Decisiones de arquitectura y licencias
docs/despliegue.md     Guía de puesta en marcha (cuentas, Vercel, importador)
src/app/               Aplicación web (Next.js)
```

## Requisitos

- Node.js 20 o superior
- PostgreSQL 15 o superior con PostGIS, para pruebas locales (en producción, Supabase)
- `osmium-tool`, para procesar extractos de OpenStreetMap

## Uso del worker

```bash
cp .env.example .env    # y rellena DATABASE_URL y CONTACT
npm install
npm run import -- red_galicia 15078   # clubes del RED en Santiago
npm run import -- osm 15078           # comercios de OSM en Santiago
npm run import -- red_galicia 36      # todos los municipios de una provincia
npm run import -- osm galicia         # los 313 municipios de Galicia
npm run worker                         # proceso continuo que atiende la cola
```

## Pruebas

```bash
npm test                 # unitarias (+ integración si TEST_DATABASE_URL está definida)
npm run typecheck
PGHOST=... PGPORT=... PGUSER=... CONTACT=... npm run test:db   # extremo a extremo
```

## Atribución de datos

© Colaboradores de OpenStreetMap (ODbL) · Xunta de Galicia, Rexistro de Entidades Deportivas (CC BY-SA 4.0) · CartoCiudad © Instituto Geográfico Nacional (CC BY 4.0).
