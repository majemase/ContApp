import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { as } from '../test/helpers.ts';
import { app, PUBLIC_API_PATHS } from './app.ts';
import { initDb } from './db/client.ts';

beforeAll(async () => {
  await initDb();
});

afterEach(() => {
  delete process.env.DEV_USER_SUB;
});

/** Todas las rutas registradas en la API (sin los middlewares), con los parámetros rellenos. */
function apiRoutes() {
  const seen = new Set<string>();
  return app.routes
    .filter((r) => r.method !== 'ALL' && r.path.startsWith('/api/'))
    .map((r) => ({ method: r.method, path: r.path.replace(/:\w+(\{[^}]*\})?/g, '1') }))
    .filter((r) => {
      const key = `${r.method} ${r.path}`;
      return seen.has(key) ? false : (seen.add(key), true);
    });
}

describe('API', () => {
  it('responde al health check', async () => {
    const res = await as(null, '/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('devuelve 404 en JSON para rutas de API que no existen', async () => {
    const res = await as('juan', '/no-existe');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Ruta no encontrada' });
  });

  it('sin sesión, una ruta que no existe responde 401 y no 404', async () => {
    expect((await as(null, '/no-existe')).status).toBe(401);
  });
});

describe('toda la API exige sesión salvo la lista de rutas públicas', () => {
  const routes = apiRoutes();

  it('encuentra las rutas (si no, el test de abajo no comprobaría nada)', () => {
    expect(routes.length).toBeGreaterThan(20);
  });

  it('las rutas públicas son exactamente las esperadas', () => {
    // Si este test falla porque has añadido una ruta pública, asegúrate de que debe serlo.
    expect([...PUBLIC_API_PATHS]).toEqual(['/api/health']);
  });

  it.each(routes.filter((r) => !PUBLIC_API_PATHS.has(r.path)))('$method $path → 401 sin sesión', async ({ method, path }) => {
    delete process.env.DEV_USER_SUB;
    const res = await app.request(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: method === 'GET' || method === 'HEAD' ? undefined : '{}',
    });
    expect(res.status).toBe(401);
  });
});
