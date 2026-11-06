import { beforeAll, describe, expect, it } from 'vitest';
import type { Bucket, BucketMovement, InvestmentAsset, InvestmentOperation, InvestmentsData, Ledger } from '@contapp/shared';
import { as, asJson } from '../../test/helpers.ts';
import { initDb } from '../db/client.ts';

const ME = 'inversor';
let base: string;
let savings: Bucket;

async function data() {
  return asJson<InvestmentsData>(ME, `${base}/investments`);
}

async function createAsset(name = 'Fondo S&P 500'): Promise<InvestmentAsset> {
  const account = await asJson(ME, `${base}/investments/accounts`, { method: 'POST', body: { name: `Bróker ${name}` } });
  return asJson(ME, `${base}/investments/assets`, {
    method: 'POST',
    body: { accountId: account.id, name, type: 'index_fund', assetClass: 'equity', region: 'us' },
  });
}

function operation(assetId: number, body: Record<string, unknown>) {
  return as(ME, `${base}/investments/operations`, {
    method: 'POST',
    body: { assetId, date: '2026-03-10', kind: 'contribution', amountCents: 100_00, source: 'month', ...body },
  });
}

async function balanceOf(bucketId: number) {
  const buckets = await asJson<Bucket[]>(ME, `${base}/buckets`);
  return buckets.find((b) => b.id === bucketId)!.balanceCents;
}

beforeAll(async () => {
  await initDb();
  const [ledger] = await asJson<Ledger[]>(ME, '/ledgers');
  base = `/ledgers/${ledger!.id}`;
  const buckets = await asJson<Bucket[]>(ME, `${base}/buckets`);
  savings = buckets.find((b) => b.type === 'savings')!;
  await asJson(ME, `${base}/movements`, {
    method: 'POST',
    body: { bucketId: savings.id, amountCents: 500_00, date: '2026-01-01', kind: 'initial' },
  });
});

describe('cuentas y activos', () => {
  it('crea una cuenta y un activo', async () => {
    const asset = await createAsset();
    expect(asset).toMatchObject({ name: 'Fondo S&P 500', type: 'index_fund', assetClass: 'equity', region: 'us', archived: false });
    const d = await data();
    expect(d.assets.map((a) => a.id)).toContain(asset.id);
  });

  it('no deja crear un activo en una cuenta de otro ámbito', async () => {
    const [other] = await asJson<Ledger[]>('otro', '/ledgers');
    const account = await asJson('otro', `/ledgers/${other!.id}/investments/accounts`, { method: 'POST', body: { name: 'Ajena' } });
    const res = await as(ME, `${base}/investments/assets`, {
      method: 'POST',
      body: { accountId: account.id, name: 'X', type: 'etf', assetClass: 'equity', region: 'global' },
    });
    expect(res.status).toBe(404);
  });

  it('un activo sin historial se borra; con historial se archiva', async () => {
    const empty = await createAsset('Vacío');
    expect(await asJson(ME, `${base}/investments/assets/${empty.id}`, { method: 'DELETE' })).toEqual({ archived: false });

    const used = await createAsset('Usado');
    expect((await operation(used.id, {})).status).toBe(201);
    expect(await asJson(ME, `${base}/investments/assets/${used.id}`, { method: 'DELETE' })).toEqual({ archived: true });
    const res = await operation(used.id, {});
    expect(res.status).toBe(400);
  });
});

describe('operaciones', () => {
  it('una aportación desde una hucha saca el dinero de la hucha, y al borrarla vuelve', async () => {
    const asset = await createAsset('Desde hucha');
    const before = await balanceOf(savings.id);

    const res = await operation(asset.id, { source: 'bucket', bucketId: savings.id, amountCents: 200_00 });
    expect(res.status).toBe(201);
    const op = (await res.json()) as InvestmentOperation;
    expect(op).toMatchObject({ source: 'bucket', bucketId: savings.id, amountCents: 200_00 });
    expect(await balanceOf(savings.id)).toBe(before - 200_00);

    const movements = await asJson<BucketMovement[]>(ME, `${base}/buckets/${savings.id}/movements`);
    const movement = movements.find((m) => m.kind === 'investment')!;
    expect(movement.amountCents).toBe(-200_00);
    // El movimiento no se puede borrar desde la hucha, solo desde la inversión.
    expect((await as(ME, `${base}/movements/${movement.id}`, { method: 'DELETE' })).status).toBe(400);

    expect((await as(ME, `${base}/investments/operations/${op.id}`, { method: 'DELETE' })).status).toBe(204);
    expect(await balanceOf(savings.id)).toBe(before);
  });

  it('una retirada a una hucha mete el dinero en ella', async () => {
    const asset = await createAsset('Retirada');
    await operation(asset.id, { source: 'none', amountCents: 1000_00 });
    const before = await balanceOf(savings.id);
    const res = await operation(asset.id, { kind: 'withdrawal', source: 'bucket', bucketId: savings.id, amountCents: 300_00 });
    expect(res.status).toBe(201);
    expect(await balanceOf(savings.id)).toBe(before + 300_00);
  });

  it('no deja aportar desde una hucha más de lo que tiene', async () => {
    const asset = await createAsset('Sin saldo');
    const res = await operation(asset.id, { source: 'bucket', bucketId: savings.id, amountCents: 999_999_00 });
    expect(res.status).toBe(400);
  });

  it('valida la hucha y las participaciones', async () => {
    const asset = await createAsset('Validación');
    expect((await operation(asset.id, { source: 'bucket' })).status).toBe(400);
    expect((await operation(asset.id, { source: 'month', bucketId: savings.id })).status).toBe(400);
    expect((await operation(asset.id, { kind: 'dividend', units: 100 })).status).toBe(400);
    expect((await operation(asset.id, { units: 12_5000_0000 })).status).toBe(201);
  });
});

describe('valoraciones', () => {
  it('una por activo y día: la segunda sustituye a la primera', async () => {
    const asset = await createAsset('Valorado');
    const body = { assetId: asset.id, date: '2026-03-31', valueCents: 1000_00 };
    await asJson(ME, `${base}/investments/valuations`, { method: 'POST', body });
    const second = await asJson(ME, `${base}/investments/valuations`, { method: 'POST', body: { ...body, valueCents: 1050_00 } });
    const mine = (await data()).valuations.filter((v) => v.assetId === asset.id);
    expect(mine).toEqual([{ id: second.id, assetId: asset.id, date: '2026-03-31', valueCents: 1050_00 }]);

    expect((await as(ME, `${base}/investments/valuations/${second.id}`, { method: 'DELETE' })).status).toBe(204);
  });
});

describe('permisos', () => {
  it('otro usuario no ve ni toca tus inversiones', async () => {
    expect((await as('curioso', `${base}/investments`)).status).toBe(404);
    const asset = (await data()).assets[0]!;
    const res = await as('curioso', `${base}/investments/operations`, {
      method: 'POST',
      body: { assetId: asset.id, date: '2026-03-10', kind: 'contribution', amountCents: 1, source: 'none' },
    });
    expect(res.status).toBe(404);
  });
});
