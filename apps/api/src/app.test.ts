import { beforeAll, describe, expect, it } from 'vitest';
import { app } from './app.ts';
import { initDb } from './db/client.ts';

beforeAll(async () => {
  await initDb();
});

describe('API', () => {
  it('responde al health check', async () => {
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('devuelve 404 en JSON para rutas de API que no existen', async () => {
    const res = await app.request('/api/no-existe');
    expect(res.status).toBe(404);
  });
});
