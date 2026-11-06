import { app } from '../src/app.ts';

/** Hace una petición a la API como el usuario con ese sub (null = sin sesión). */
export async function as(sub: string | null, path: string, init?: { method?: string; body?: unknown }) {
  if (sub === null) delete process.env.DEV_USER_SUB;
  else process.env.DEV_USER_SUB = sub;
  return app.request(`/api${path}`, {
    method: init?.method ?? 'GET',
    headers: init?.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

/** Como `as`, pero espera un código concreto y devuelve el JSON. */
export async function asJson<T = any>(
  sub: string,
  path: string,
  init?: { method?: string; body?: unknown },
  status = init?.method && init.method !== 'GET' ? [200, 201] : [200],
): Promise<T> {
  const res = await as(sub, path, init);
  const body = res.status === 204 ? undefined : await res.json();
  if (!status.includes(res.status)) {
    throw new Error(`${init?.method ?? 'GET'} ${path} → ${res.status}: ${JSON.stringify(body)}`);
  }
  return body as T;
}
