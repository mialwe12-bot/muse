import {Client, Guild} from 'discord.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {DATA_DIR} from '../services/config.js';
import {dmEmbed, toneOf} from './embeds.js';

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
// Benachrichtigungen an den Bot-Besitzer (Direktnachricht)

export const notifyOwner = async (client: Client, text: string): Promise<void> => {
  try {
    const id = await resolveOwnerId(client);
    const user = await client.users.fetch(id);
    await user.send({embeds: [dmEmbed(toneOf(text), text)], allowedMentions: {parse: []}});
  } catch (error: unknown) {
    console.warn(`Konnte dem Bot-Besitzer keine Nachricht schicken: ${String((error as Error).message ?? error)}`);
  }
};

// ---------------------------------------------------------------------------
// Blacklist (data/blacklist.json): Nutzer und ganze Server

export type BlacklistEntry = {userId: string; reason: string; addedAt: string};
export type GuildBlacklistEntry = {guildId: string; name: string; reason: string; addedAt: string};

const BLACKLIST_FILE = path.join(DATA_DIR, 'blacklist.json');
let blacklist: {users: Map<string, BlacklistEntry>; guilds: Map<string, GuildBlacklistEntry>} | undefined;
let writeQueue: Promise<void> = Promise.resolve();

const loadBlacklist = async () => {
  if (blacklist) {
    return blacklist;
  }

  try {
    const raw = JSON.parse(await fs.readFile(BLACKLIST_FILE, 'utf8')) as BlacklistEntry[] | {users?: BlacklistEntry[]; guilds?: GuildBlacklistEntry[]};
    // Altes Format: nur ein Array mit Nutzern.
    const users = Array.isArray(raw) ? raw : raw.users ?? [];
    const guilds = Array.isArray(raw) ? [] : raw.guilds ?? [];
    blacklist = {
      users: new Map(users.map(entry => [entry.userId, entry])),
      guilds: new Map(guilds.map(entry => [entry.guildId, entry])),
    };
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }

    blacklist = {users: new Map(), guilds: new Map()};
  }

  return blacklist;
};

const saveBlacklist = async (): Promise<void> => {
  const list = await loadBlacklist();
  const data = JSON.stringify({users: [...list.users.values()], guilds: [...list.guilds.values()]}, null, 2);
  writeQueue = writeQueue.catch(() => undefined).then(async () => {
    const temporary = `${BLACKLIST_FILE}.tmp`;
    await fs.writeFile(temporary, data);
    await fs.rename(temporary, BLACKLIST_FILE);
  });
  await writeQueue;
};

export const isBlacklisted = async (userId: string): Promise<boolean> => !isOwner(userId) && (await loadBlacklist()).users.has(userId);

export const getBlacklist = async (): Promise<BlacklistEntry[]> => [...(await loadBlacklist()).users.values()];

/** Returns false if the user was already on the list. */
export const addToBlacklist = async (userId: string, reason: string): Promise<boolean> => {
  const {users} = await loadBlacklist();
  if (users.has(userId)) {
    return false;
  }

  users.set(userId, {userId, reason, addedAt: new Date().toISOString()});
  await saveBlacklist();
  return true;
};

/** Returns false if the user was not on the list. */
export const removeFromBlacklist = async (userId: string): Promise<boolean> => {
  if (!(await loadBlacklist()).users.delete(userId)) {
    return false;
  }

  await saveBlacklist();
  return true;
};

export const getGuildBlacklistEntry = async (guildId: string): Promise<GuildBlacklistEntry | undefined> => (await loadBlacklist()).guilds.get(guildId);

export const getGuildBlacklist = async (): Promise<GuildBlacklistEntry[]> => [...(await loadBlacklist()).guilds.values()];

/** Returns false if the server was already on the list. */
export const addGuildToBlacklist = async (guildId: string, name: string, reason: string): Promise<boolean> => {
  const {guilds} = await loadBlacklist();
  if (guilds.has(guildId)) {
    return false;
  }

  guilds.set(guildId, {guildId, name, reason, addedAt: new Date().toISOString()});
  await saveBlacklist();
  return true;
};

/** Returns false if the server was not on the list. */
export const removeGuildFromBlacklist = async (guildId: string): Promise<boolean> => {
  if (!(await loadBlacklist()).guilds.delete(guildId)) {
    return false;
  }

  await saveBlacklist();
  return true;
};
