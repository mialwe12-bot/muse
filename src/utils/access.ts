import {Client, Guild} from 'discord.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {DATA_DIR} from '../services/config.js';

/*
 * Zugriffsregeln für diesen Bot:
 * - Er funktioniert nur auf Servern, auf denen der Bot-Besitzer Mitglied ist.
 *   Ist der Besitzer dort nicht (mehr), verlässt der Bot den Server.
 * - Nutzer auf der Blacklist dürfen den Bot nicht bedienen.
 *
 * Der Besitzer kommt aus OWNER_ID oder, falls leer, aus der Discord-Application.
 */

let ownerId: string | undefined;

export const resolveOwnerId = async (client: Client): Promise<string> => {
  if (ownerId) {
    return ownerId;
  }

  const fromEnv = process.env.OWNER_ID?.trim();
  if (fromEnv) {
    ownerId = fromEnv;
    return ownerId;
  }

  const application = await client.application!.fetch();
  const {owner} = application;
  const id = owner && 'ownerId' in owner ? owner.ownerId : owner?.id;
  if (!id) {
    throw new Error('Bot-Besitzer konnte nicht ermittelt werden (OWNER_ID setzen).');
  }

  ownerId = id;
  return ownerId;
};

export const getOwnerId = (): string | undefined => ownerId;

export const isOwner = (userId: string): boolean => ownerId !== undefined && userId === ownerId;

// Without the privileged GuildMembers intent there is no leave event for the
// owner, so membership is checked on use and periodically, with a short cache.
const MEMBERSHIP_CACHE_MS = 60_000;
const membershipCache = new Map<string, {present: boolean; checkedAt: number}>();

export const isOwnerInGuild = async (guild: Guild, force = false): Promise<boolean> => {
  const id = await resolveOwnerId(guild.client);
  const cached = membershipCache.get(guild.id);
  if (!force && cached && Date.now() - cached.checkedAt < MEMBERSHIP_CACHE_MS) {
    return cached.present;
  }

  let present: boolean;
  try {
    await guild.members.fetch({user: id, force: true});
    present = true;
  } catch (error: unknown) {
    // 10007 = Unknown Member, 10013 = Unknown User. Anything else (outage,
    // rate limit) must not make the bot leave a server by mistake.
    const code = (error as {code?: number}).code;
    if (code !== 10_007 && code !== 10_013) {
      console.warn(`Besitzer-Check für Server ${guild.id} fehlgeschlagen: ${String((error as Error).message ?? error)}`);
      return cached?.present ?? true;
    }

    present = false;
  }

  membershipCache.set(guild.id, {present, checkedAt: Date.now()});
  return present;
};

/** Leaves the guild if the owner is not a member. Returns true if the bot left. */
export const forgetGuildMembership = (guildId: string): void => {
  membershipCache.delete(guildId);
};

// ---------------------------------------------------------------------------
// Blacklist (data/blacklist.json)

export type BlacklistEntry = {userId: string; reason: string; addedAt: string};

const BLACKLIST_FILE = path.join(DATA_DIR, 'blacklist.json');
let blacklist: Map<string, BlacklistEntry> | undefined;
let writeQueue: Promise<void> = Promise.resolve();

const loadBlacklist = async (): Promise<Map<string, BlacklistEntry>> => {
  if (blacklist) {
    return blacklist;
  }

  try {
    const entries = JSON.parse(await fs.readFile(BLACKLIST_FILE, 'utf8')) as BlacklistEntry[];
    blacklist = new Map(entries.map(entry => [entry.userId, entry]));
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }

    blacklist = new Map();
  }

  return blacklist;
};

const saveBlacklist = async (): Promise<void> => {
  const entries = [...(await loadBlacklist()).values()];
  writeQueue = writeQueue.catch(() => undefined).then(async () => {
    const temporary = `${BLACKLIST_FILE}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(entries, null, 2));
    await fs.rename(temporary, BLACKLIST_FILE);
  });
  await writeQueue;
};

export const isBlacklisted = async (userId: string): Promise<boolean> => !isOwner(userId) && (await loadBlacklist()).has(userId);

export const getBlacklist = async (): Promise<BlacklistEntry[]> => [...(await loadBlacklist()).values()];

/** Returns false if the user was already on the list. */
export const addToBlacklist = async (userId: string, reason: string): Promise<boolean> => {
  const list = await loadBlacklist();
  if (list.has(userId)) {
    return false;
  }

  list.set(userId, {userId, reason, addedAt: new Date().toISOString()});
  await saveBlacklist();
  return true;
};

/** Returns false if the user was not on the list. */
export const removeFromBlacklist = async (userId: string): Promise<boolean> => {
  const list = await loadBlacklist();
  if (!list.delete(userId)) {
    return false;
  }

  await saveBlacklist();
  return true;
};
