# Market Intelligence

Plataforma interna de inteligencia comercial y territorial: descubre, importa, organiza y gestiona comercios, clubes y asociaciones reales en España. Empieza por Galicia (piloto: **Santiago de Compostela**, vertical **ciclismo**).

## Estado

Fase 1 en curso.

| Componente | Estado |
|---|---|
| Esquema de base de datos (10 migraciones): entidades, procedencia por campo, deduplicación, importaciones, CRM mínimo, auditoría, RLS | ✅ Probado en local |
| Importador del Rexistro de Entidades Deportivas de Galicia (clubes) con geocodificación CartoCiudad | ✅ Probado con datos reales |
| Importador de OpenStreetMap (tiendas y talleres de bicicletas) desde extractos provinciales | ✅ Probado con datos reales |
| Worker con cola persistente, reintentos y recuperación | ✅ |
| Búsqueda, mapa con agrupación y control de importaciones (funciones SQL) | ✅ Probado en local |
| Proyecto Supabase: 10 migraciones aplicadas, asesor de seguridad revisado | ✅ (sin datos todavía) |
| Aplicación web (listado, ficha, mapa, CRM) | ⏳ Siguiente paso |

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
