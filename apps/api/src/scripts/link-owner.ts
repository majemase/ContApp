// Enlaza los datos de local:owner con tu usuario real del IdP. Una sola vez, antes de tu primer login.
//
//   pnpm --filter @contapp/api link-owner <sub>
//
// El sub es el ID de tu usuario en Pocket ID (panel de administración → Users → tu usuario).
// Usa la BD de DB_PATH, o apps/api/data/contapp.db por defecto. Haz una copia antes.

import { initDb } from '../db/client.ts';
import { LOCAL_OWNER_SUB, linkLocalOwner } from '../users.ts';

const sub = process.argv[2];
if (!sub) {
  console.error('Uso: pnpm --filter @contapp/api link-owner <sub-de-tu-usuario-en-el-IdP>');
  process.exit(1);
}

try {
  await initDb();
  await linkLocalOwner(sub);
  console.log(`Hecho: los datos de ${LOCAL_OWNER_SUB} son ahora del usuario ${sub}. Ya puedes iniciar sesión.`);
} catch (err) {
  console.error(`No se ha enlazado: ${(err as Error).message}`);
  process.exit(1);
}
