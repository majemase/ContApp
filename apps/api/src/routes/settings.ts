import { and, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { DEFAULT_SETTINGS, type ExtraRule, type Settings, extraRuleSchema, settingsSchema } from '@contapp/shared';
import { db } from '../db/client.ts';
import { buckets, ledgerSettings } from '../db/schema.ts';
import { HttpError, type LedgerEnv, parseJson } from '../http.ts';

function parseRules(json: string): ExtraRule[] {
  const parsed = extraRuleSchema.array().safeParse(JSON.parse(json));
  return parsed.success ? parsed.data : [];
}

export async function loadSettings(ledgerId: number): Promise<Settings> {
  const [row] = await db.select().from(ledgerSettings).where(eq(ledgerSettings.ledgerId, ledgerId));
  if (!row) return DEFAULT_SETTINGS;
  const { ledgerId: _, extraRules, ...rest } = row;
  return { ...rest, extraRules: parseRules(extraRules) };
}

export async function saveSettings(ledgerId: number, settings: Settings) {
  const values = { ...settings, extraRules: JSON.stringify(settings.extraRules) };
  await db
    .insert(ledgerSettings)
    .values({ ...values, ledgerId })
    .onConflictDoUpdate({ target: ledgerSettings.ledgerId, set: values });
}

/** Las huchas que se mencionan en los ajustes deben existir en el ámbito y no estar archivadas. */
async function assertBuckets(ledgerId: number, settings: Settings) {
  const ids = [settings.savingsBucketId, ...settings.extraRules.map((r) => r.bucketId)].filter(
    (id): id is number => id !== null,
  );
  if (ids.length === 0) return;
  const found = await db
    .select({ id: buckets.id })
    .from(buckets)
    .where(and(eq(buckets.ledgerId, ledgerId), eq(buckets.archived, false), inArray(buckets.id, ids)));
  if (new Set(found.map((b) => b.id)).size !== new Set(ids).size) {
    throw new HttpError(400, 'Alguna de las huchas elegidas no existe');
  }
}

export const settingsRoutes = new Hono<LedgerEnv>()
  .get('/', async (c) => c.json(await loadSettings(c.get('ledgerId'))))

  .put('/', async (c) => {
    const ledgerId = c.get('ledgerId');
    const input = await parseJson(c, settingsSchema);
    await assertBuckets(ledgerId, input);
    await saveSettings(ledgerId, input);
    return c.json(await loadSettings(ledgerId));
  });
