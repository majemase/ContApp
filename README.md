# ContApp

Contabilidad personal manual: ingresos, gastos recurrentes, provisiones, ahorro y lo que puedes gastar.
El plan completo y el estado de cada fase están en [PLAN.md](PLAN.md).

## Requisitos

- Node.js 24+
- pnpm 11 (la versión exacta está fijada en `packageManager` de package.json)

## Puesta en marcha

```bash
pnpm install
pnpm dev
```

- Web: http://localhost:5173 (también accesible desde el móvil en la misma red)
- API: http://localhost:3001/api

La base de datos SQLite se crea sola en `apps/api/data/contapp.db` la primera vez, con el ámbito
Personal y unas categorías por defecto. Para copia de seguridad basta con copiar ese archivo.

## Comandos

| Comando | Qué hace |
|---|---|
| `pnpm dev` | API + web en modo desarrollo |
| `pnpm test` | Tests (lógica de cálculo compartida) |
| `pnpm typecheck` | Comprobación de tipos de todo el proyecto |
| `pnpm build` | Compila la web en `apps/web/dist` |
| `pnpm db:generate` | Genera una migración tras cambiar `apps/api/src/db/schema.ts` |

En producción: `pnpm build` y luego `NODE_ENV=production pnpm start`. La API sirve
también la web compilada en el puerto 3001.

## Estructura

```
apps/api         API (Hono + SQLite/Drizzle)
apps/web         Web (React + Vite + Tailwind)
packages/shared  Lógica y tipos compartidos: dinero, fechas, cálculo de recurrentes, validación (Zod)
```

Los importes se guardan siempre en céntimos (enteros).
