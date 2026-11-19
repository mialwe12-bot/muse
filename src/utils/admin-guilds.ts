import fs from 'node:fs/promises';
import path from 'node:path';
import {DATA_DIR} from '../services/config.js';

/*
 * Server, auf denen die Admin-Befehle (/license-admin, /blacklist,
 * /admin-servers) registriert werden. Standard: ByteBot und ByteBeta,
 * weitere fügt der Bot-Besitzer mit /admin-servers add hinzu.
 */

export type AdminGuild = {guildId: string; name: string; addedAt: string};

const DEFAULT_ADMIN_GUILDS: AdminGuild[] = [
  {guildId: '1469828353153302622', name: 'ByteBot', addedAt: '2026-11-19T00:00:00.000Z'},
  {guildId: '1535674931864543283', name: 'ByteBeta', addedAt: '2026-11-19T00:00:00.000Z'},
];

const FILE = path.join(DATA_DIR, 'admin-guilds.json');
let adminGuilds: Map<string, AdminGuild> | undefined;
let writeQueue: Promise<void> = Promise.resolve();

const load = async (): Promise<Map<string, AdminGuild>> => {
  if (adminGuilds) {
    return adminGuilds;
  }

  try {
    const entries = JSON.parse(await fs.readFile(FILE, 'utf8')) as AdminGuild[];
    adminGuilds = new Map(entries.map(entry => [entry.guildId, entry]));
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }

    adminGuilds = new Map(DEFAULT_ADMIN_GUILDS.map(entry => [entry.guildId, entry]));
  }

  return adminGuilds;
};

const save = async (): Promise<void> => {
  const data = JSON.stringify([...(await load()).values()], null, 2);
  writeQueue = writeQueue.catch(() => undefined).then(async () => {
    const temporary = `${FILE}.tmp`;
    await fs.writeFile(temporary, data);
    await fs.rename(temporary, FILE);
  });
  await writeQueue;
};

export const isAdminGuild = async (guildId: string): Promise<boolean> => (await load()).has(guildId);

export const listAdminGuilds = async (): Promise<AdminGuild[]> => [...(await load()).values()];

/** Returns false if the server was already on the list. */
export const addAdminGuild = async (guildId: string, name: string): Promise<boolean> => {
  const list = await load();
  if (list.has(guildId)) {
    return false;
  }

  list.set(guildId, {guildId, name, addedAt: new Date().toISOString()});
  await save();
  return true;
};

/** Returns false if the server was not on the list. */
export const removeAdminGuild = async (guildId: string): Promise<boolean> => {
  if (!(await load()).delete(guildId)) {
    return false;
  }

  await save();
  return true;
};
