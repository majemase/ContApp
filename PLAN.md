# ContApp — Plan de desarrollo

App web personal para controlar la contabilidad doméstica de forma manual: qué entra, qué está
comprometido, qué hay que apartar, qué se puede ahorrar y qué se puede gastar.

## Principios

- **Manual**: sin conexión con bancos. Todo se apunta a mano (más adelante, importar CSV).
- **Ingresos variables**: se presupuesta con un *ingreso de referencia* conservador; lo que entra
  por encima es *extra* y se reparte con reglas.
- **Ámbitos separados**: Personal y SL nunca se mezclan. Los movimientos entre ellos son explícitos.
- **Dinero en céntimos**: todos los importes se guardan como enteros (céntimos). Nunca `float`.
- **Fechas** como texto ISO: días `YYYY-MM-DD`, meses `YYYY-MM`.

## Lógica central

```
  Ingresos del mes
− Gastos fijos mensuales        (casa 500 €, cuota autónomo, suscripciones…)
− Provisiones                   (gastos anuales/semestrales prorrateados: seguro coche…)
− Variables estimados           (gasolina, súper… presupuesto mensual)
− Ahorro                        (mínimo fijo + reparto del extra)
= Disponible para gastar        (y "puedes gastar X €/día" el resto del mes)
```

### Estrategia para ingresos variables

- **Ingreso de referencia** (p. ej. 1.000 €): financia el presupuesto normal del mes.
- **Extra** (lo cobrado por encima) se reparte por reglas configurables, p. ej.:
  40 % colchón de verano · 40 % ahorro/objetivos · 20 % libre.
- **Ingresos puntuales** (atrasos, devoluciones) tienen su propia regla (p. ej. 70 % ahorro · 30 % libre).
- **Ahorro mensual**: importe fijo, % del ingreso presupuestado, o lo mayor de los dos (el fijo hace de
  suelo en los meses malos). El grueso del ahorro sale del **extra** (dietas, atrasos, pagas).
- Prioridad de huchas: 1) fondo de emergencia (3 meses de fijos) · 2) colchón de verano · 3) objetivos.

### Tipos de gasto recurrente

| Tipo | Ejemplo | Efecto mensual |
|---|---|---|
| `fixed` (fijo mensual) | Casa 500 €, cuota autónomo | El importe, cada mes |
| `provision` (provisión) | Seguro coche 600 €/año | Importe ÷ meses del periodo, se aparta cada mes |
| `variable` (variable estimado) | Gasolina ~120 € | Presupuesto mensual, se compara con lo gastado |

Los importes tienen **historial con fecha de vigencia** (tarifa plana del autónomo que sube a los
12 meses, subida del seguro…). Cada recurrente tiene fecha de inicio y fin opcional.

## Stack

| Capa | Tecnología |
|---|---|
| Monorepo | pnpm workspaces: `apps/web`, `apps/api`, `packages/shared` |
| Frontend | React + Vite + TypeScript, Tailwind CSS, React Router, TanStack Query |
| Backend | Node + Hono |
| BD | SQLite (libSQL) + Drizzle ORM, migraciones con drizzle-kit |
| Validación | Zod (esquemas compartidos front/back en `packages/shared`) |
| Tests | Vitest (sobre todo la lógica de cálculo de `shared`) |
| Despliegue | Docker (la API sirve también el front compilado). Acceso por Tailscale (plan aparte) |

## Modelo de datos

| Tabla | Campos clave | Fase |
|---|---|---|
| `ledgers` | nombre, tipo (`personal` / `business`) | 1 |
| `categories` | ámbito, nombre, icono, color, archivada | 1 |
| `recurring_expenses` | ámbito, categoría, nombre, tipo, frecuencia (meses), mes/día de cargo, inicio, fin | 1 |
| `recurring_expense_amounts` | recurrente, importe, válido desde | 1 |
| `expenses` | ámbito, categoría, fecha, importe, nota, impulsivo, recurrente (opcional) | 1 |
| `incomes` | ámbito, fecha, importe, tipo (nómina / dietas / paga extra / atrasos / devolución / otro) | 2 |
| `ledger_settings` | referencia, ahorro (modo, %, mínimo, hucha), reglas del extra, objetivo de reparto, umbral salud | 2–3 |
| `buckets` (huchas) | ámbito, nombre, icono, tipo (ahorro / emergencia / colchón / objetivo / provisión), meta, recurrente | 3 |
| `bucket_movements` | hucha, importe ±, fecha, mes, tipo (inicial / manual / traspaso / cierre…), afecta al mes | 3 |
| `month_closes` | mes cerrado + foto del medidor (ingresos, necesidades, deseos, ahorro) | 3 |
| `ledger_transfers` | ámbito origen, destino, importe, tipo (capital / sueldo / préstamo socio) | 4 |

---

## Fases

### Fase 1 — La base
Objetivo: poder apuntar gastos y definir todo lo que pago de forma recurrente.

- [x] Monorepo (workspaces), TypeScript, scripts `dev` / `build` / `test`
- [x] `packages/shared`: utilidades de dinero (parsear "1,50" → 150, formatear "1,50 €"), fechas/meses, esquemas Zod
- [x] `packages/shared`: cálculo del compromiso mensual de los recurrentes (+ tests)
- [x] API Hono + SQLite/Drizzle, migraciones automáticas al arrancar, seed inicial (ámbito Personal + categorías)
- [x] API: CRUD de categorías, recurrentes (con historial de importes) y gastos
- [x] Web: layout pensado para móvil (navegación inferior)
- [x] Web: pantalla **Gastos** — alta rápida (importe, categoría, nota, impulsivo) + listado del mes
- [x] Web: pantalla **Recurrentes** — alta/edición, cambio de importe con fecha, total comprometido al mes
- [x] Web: pantalla **Categorías**

**Hecho cuando**: puedo dar de alta casa, seguro del coche, gasolina y cuota de autónomo, apuntar un
café en menos de 5 segundos y ver los gastos del mes.

### Fase 2 — El mes
Objetivo: saber en todo momento cuánto puedo gastar.

- [x] Ingresos con tipo/desglose (nómina, dietas, paga extra, atrasos, otro)
- [x] Ajustes: ingreso de referencia, ahorro mínimo, umbral de salud
- [x] Presupuestos por categoría → son los recurrentes **variables**: todo lo gastado en su categoría
      cuenta contra su presupuesto y solo el exceso resta del disponible
- [x] Resumen del mes: ingresos · fijos · provisiones · variables · ahorro · **disponible** · queda
- [x] "Puedes gastar X €/día" durante el resto del mes, aviso si vas por encima del ritmo
- [x] **Salud del presupuesto**: aviso si lo comprometido supera el X % del ingreso de referencia
- [x] Pagos del mes (fijos y provisiones que tocan) → botón "Pagar" que genera el gasto vinculado
- [x] Lo cobrado por encima de la referencia se muestra como **extra** (se reparte en la fase 3)
- [x] Cálculo en `packages/shared/src/budget.ts` con tests
- [x] Ahorro como importe fijo, % o lo mayor de los dos, con vista previa en Ajustes

### Fase 3 — Las huchas
Objetivo: que el dinero que sobra tenga un destino.

- [x] Huchas: fondo de emergencia, colchón de verano, ahorro y objetivos con meta (se crean las tres
      primeras por defecto). El fondo de emergencia sugiere como meta 3 meses de gastos comprometidos
- [x] Cada provisión tiene su hucha automática: lo prorrateado entra al cerrar el mes; al pagar el
      recibo, sale de ahí
- [x] Reglas de reparto del extra (por defecto 40 % emergencia · 30 % colchón · 20 % ahorro · 10 % libre).
      La parte libre se suma a lo que puedes gastar ese mismo mes
- [x] Reparto propio para ingresos puntuales (atrasos, devoluciones). Si no se configura, usan el del extra
- [x] Meter / sacar dinero de una hucha en cualquier momento (desde o hacia el dinero del mes),
      traspasos entre huchas y saldo inicial
- [x] Usar el colchón cuando un mes cobras menos que la referencia (sugerencia en el resumen)
- [x] **Cierre de mes**: propuesta de movimientos (ahorro, provisiones, extra, sobrante o cubrir el
      exceso), avisos de pagos sin marcar, y se puede reabrir. Aviso si el mes anterior está sin cerrar
- [x] Hucha "Regularización autónomo" (plantilla al crear una hucha)
- [x] **Medidor de reparto** (necesidades · deseos · ahorro) frente a un objetivo configurable, en vivo
      durante el mes y guardado al cerrar
- [x] Evolución del medidor mes a mes (en Huchas): reparto de cada mes cerrado y ahorro medio
- [x] Invariante con tests: todo lo cobrado acaba gastado o en una hucha (`closing.test.ts`)

### Fase 4 — La SL
Objetivo: controlar el dinero de la SL sin mezclarlo con el personal.

- [ ] Selector de ámbito (Personal / SL)
- [ ] Ingresos y gastos de la SL con IVA (base + cuota)
- [ ] Provisiones de impuestos: IVA trimestral, estimación de Impuesto de Sociedades
- [ ] Movimientos entre ámbitos: aportación de capital, sueldo, préstamo de socio / devolución
- [ ] Decidir quién paga la cuota de autónomo (Personal o SL)

> No es contabilidad oficial: libros y modelos de Hacienda los lleva la gestoría.

### Fase 5 — Comodidad y despliegue
- [ ] PWA instalable en el móvil
- [ ] Histórico y gráficas (ahorro, gasto por categoría, impulsivos)
- [ ] Exportar / importar datos (JSON) y copia de seguridad de la BD
- [ ] Dockerfile + guía de despliegue en el servidor

### Más adelante
- Importar CSV del banco
- Estadísticas de gasto impulsivo
- Proyección anual (meses con/sin dietas, pagas extra)
- Login simple si alguna vez se accede fuera de Tailscale
