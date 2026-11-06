# ContApp — Plan de desarrollo

App web personal para controlar la contabilidad doméstica de forma manual: qué entra, qué está
comprometido, qué hay que apartar, qué se puede ahorrar y qué se puede gastar.

## Principios

- **Manual**: sin conexión con bancos. Todo se apunta a mano (más adelante, importar CSV).
- **Ingresos variables**: se presupuesta con un *ingreso de referencia* conservador; lo que entra
  por encima es *extra* y se reparte con reglas.
- **Ámbitos separados**: cada ámbito (Personal, uno compartido…) tiene sus propios datos y miembros.
  La contabilidad de empresa (SL) queda fuera de ContApp: tiene sus propias reglas y la lleva la gestoría.
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
| `ledgers` | nombre, tipo (`personal`; `business` existe en el esquema pero no se usa) | 1 |
| `categories` | ámbito, nombre, icono, color, archivada | 1 |
| `recurring_expenses` | ámbito, categoría, nombre, tipo, frecuencia (meses), mes/día de cargo, inicio, fin | 1 |
| `recurring_expense_amounts` | recurrente, importe, válido desde | 1 |
| `expenses` | ámbito, categoría, fecha, importe, nota, impulsivo, recurrente (opcional) | 1 |
| `incomes` | ámbito, fecha, importe, tipo (nómina / dietas / paga extra / atrasos / devolución / otro) | 2 |
| `ledger_settings` | referencia, ahorro (modo, %, mínimo, hucha), reglas del extra, objetivo de reparto, umbral salud | 2–3 |
| `buckets` (huchas) | ámbito, nombre, icono, tipo (ahorro / emergencia / colchón / objetivo / provisión), meta, recurrente | 3 |
| `bucket_movements` | hucha, importe ±, fecha, mes, tipo (inicial / manual / traspaso / cierre…), afecta al mes | 3 |
| `month_closes` | mes cerrado + foto del medidor (ingresos, necesidades, deseos, ahorro) | 3 |
| `users` | `sub` del IdP (único), email, nombre, activo | M |
| `ledger_members` | usuario, ámbito, rol (`owner` / `editor` / `viewer`) | M |
| `investment_accounts` | ámbito, nombre (bróker o plataforma), archivada | 4 |
| `investment_assets` | cuenta, nombre, ISIN/ticker, tipo, clase de activo, región, archivado | 4 |
| `investment_operations` | activo, fecha, tipo (aportación / retirada / dividendo / comisión), importe, participaciones (opcional), origen o destino del dinero (mes / hucha / fuera), movimiento de hucha, recurrente | 4 |
| `investment_valuations` | activo, fecha, valor total (una por activo y día) | 4 |

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

### Fase 4 — Inversiones
Objetivo: saber cuánto he puesto, cuánto he sacado, cuánto he ganado o perdido y cómo está
repartida mi cartera (fondos indexados, ETF, acciones, cripto…).

**Conceptos**
- **Cuenta**: dónde está el dinero invertido (un bróker, una gestora, un exchange).
- **Activo**: lo que tengo dentro de una cuenta (p. ej. un fondo indexado al S&P 500), con su tipo
  (fondo, ETF, acción, cripto, plan de pensiones…), su clase (renta variable / renta fija /
  monetario / cripto / otros) y su región (EE. UU., global, Europa, emergentes…).
- **Operaciones**: aportación (compra), retirada (venta), dividendo y comisión, con importe y
  participaciones.
- **Valoración**: el valor total de cada activo en una fecha, apuntado a mano (el que muestra el
  bróker). Entre valoraciones, el valor se estima: última valoración + aportado − retirado desde
  entonces. Si hay participaciones, el formulario permite calcular el valor desde el precio.

**Cuentas**
```
Aportado           Σ aportaciones
Retirado           Σ retiradas
Aportado neto      aportado − retirado
Valor actual       última valoración + aportado − retirado desde esa fecha
Ganancia/pérdida   valor actual + retirado + dividendos cobrados − aportado − comisiones pagadas aparte
```

**Relación con el presupuesto**
- **Aportación periódica** (p. ej. 100 €/mes al fondo): un recurrente de tipo inversión. Se paga
  desde "Pagos del mes" como los demás, y al pagarlo se crea la aportación.
- **Aportación esporádica**: desde Inversiones, eligiendo de dónde sale el dinero: del mes
  (resta del disponible) o de una hucha (p. ej. Ahorro).
- **Retirada**: el dinero va al mes (como ingreso) o a una hucha.
- Las aportaciones cuentan como **ahorro** en el medidor de reparto.

**Tareas**
- [x] Modelo de datos y cálculo en `packages/shared` (aportado, valor, ganancia, reparto) con tests
- [x] API: cuentas, activos, operaciones y valoraciones, con los mismos permisos por ámbito
- [x] Pantalla **Inversiones**: total de la cartera, ganancia/pérdida (€ y %) y lista por cuenta y activo
- [x] Alta rápida de aportación, retirada, dividendo, comisión y valoración
- [ ] Recurrente de tipo inversión para las aportaciones periódicas
- [x] Aportaciones y retiradas conectadas con el mes y con las huchas
- [x] Aportaciones dentro del medidor de reparto (ahorro): no son necesidades ni deseos, así que cuentan solas como ahorro
- [x] **Reparto de la cartera** por clase de activo, región, cuenta y activo
- [ ] Evolución mes a mes: aportado frente a valor
- [ ] Aviso al cerrar el mes si hay valoraciones sin actualizar

**Decidido al implementarlo**
- Participaciones como entero × 10⁸ (8 decimales, suficiente para cripto), igual que el dinero va en
  céntimos, para no usar `float`. Son opcionales.
- Se valora por valor total (sirve para cualquier producto, también depósitos).
- Dividendos reinvertidos y comisiones descontadas dentro de la inversión ya están en el valor:
  se apuntan solo como información, no cambian la ganancia.

**Por decidir**
- Si el reparto del extra puede enviar dinero directamente a una inversión.

> No es contabilidad fiscal: las plusvalías (FIFO), los traspasos entre fondos y la declaración
> quedan fuera, al menos por ahora.

### Multiusuario (M)
Objetivo: que otras personas usen la app, cada una con sus datos. Rama `feature/multiusuario`.
Detalle del login y del despliegue en el repo `homelab`.

- [x] Tablas `users` y `ledger_members` con roles (`owner` / `editor` / `viewer`)
- [x] Mis datos existentes asignados a un usuario provisional (`local:owner`)
- [x] Usuario actual en cada petición (de momento el de desarrollo, `DEV_USER_SUB`); en producción
      la API no arranca sin login real
- [x] Alta automática en el primer acceso, con su ámbito Personal, categorías y huchas
- [x] Permisos: ámbito ajeno → 404, `viewer` escribiendo → 403; `/ledgers` solo devuelve los tuyos
- [x] Tests de permisos y de escrituras concurrentes
- [ ] Login real con el IdP (OIDC), sesiones y botón de cerrar sesión
- [ ] Enlazar `local:owner` con mi usuario real del IdP
- [ ] Selector de ámbito en la web (para ámbitos compartidos)
- [ ] La web oculta los botones de editar a un `viewer`

### Fase 5 — Comodidad y despliegue
- [ ] PWA instalable en el móvil
- [ ] Histórico y gráficas (ahorro, gasto por categoría, impulsivos)
- [ ] Exportar / importar datos (JSON) y copia de seguridad de la BD
- [ ] Dockerfile + guía de despliegue en el servidor

### Más adelante
- Importar CSV del banco
- Inversiones: precios automáticos (API de cotizaciones), rentabilidad anualizada (TIR) y
  plusvalías con criterio FIFO para la declaración
- Estadísticas de gasto impulsivo
- Proyección anual (meses con/sin dietas, pagas extra)
