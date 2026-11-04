import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { DEFAULT_SETTINGS, type Settings, settingsSchema } from '@contapp/shared';
import { db } from '../db/client.ts';
import { ledgerSettings } from '../db/schema.ts';
import { type LedgerEnv, parseJson } from '../http.ts';

async function loadSettings(ledgerId: number): Promise<Settings> {
  const [row] = await db.select().from(ledgerSettings).where(eq(ledgerSettings.ledgerId, ledgerId));
  if (!row) return DEFAULT_SETTINGS;
  const { ledgerId: _, ...settings } = row;
  return settings;
}

export const settingsRoutes = new Hono<LedgerEnv>()
  .get('/', async (c) => c.json(await loadSettings(c.get('ledgerId'))))

  .put('/', async (c) => {
    const ledgerId = c.get('ledgerId');
    const input = await parseJson(c, settingsSchema);
    await db
      .insert(ledgerSettings)
      .values({ ...input, ledgerId })
      .onConflictDoUpdate({ target: ledgerSettings.ledgerId, set: input });
    return c.json(await loadSettings(ledgerId));
  });
