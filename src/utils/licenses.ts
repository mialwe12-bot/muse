import {Client, Guild} from 'discord.js';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {DATA_DIR} from '../services/config.js';
import {forgetGuildMembership, isOwner, isOwnerInGuild} from './access.js';

/*
 * Lizenzsystem
 * - Eine Lizenz gehört einem Discord-Nutzer und erlaubt `maxServers` Server,
 *   optional bis `expiresAt`. Ein Nutzer kann mehrere Lizenzen haben.
 * - Lizenzen vergibt der Bot-Besitzer direkt (/license give) oder als
 *   Schlüssel (/license key), den jemand mit /license redeem einlöst.
 * - Ein Server ist erlaubt, wenn der Bot-Besitzer dort Mitglied ist oder er
 *   mit einer gültigen Lizenz aktiviert wurde. Neue, nicht lizenzierte Server
 *   bekommen GRACE_MS Zeit zum Aktivieren, danach verlässt der Bot sie.
 */

export const GRACE_MS = 15 * 60 * 1000;

export type License = {
  id: string;
  userId: string;
  maxServers: number;
  expiresAt: string | null;
  note: string;
  createdAt: string;
  source: 'give' | 'key';
};

export type LicenseKey = {
  key: string;
  maxServers: number;
  days: number | null;
  note: string;
  createdAt: string;
};

export type Activation = {guildId: string; guildName: string; licenseId: string; userId: string; activatedAt: string};

type Store = {
  licenses: License[];
  keys: LicenseKey[];
  activations: Activation[];
  pending: Record<string, string>; // GuildId -> Ende der Frist (ISO)
};

const FILE = path.join(DATA_DIR, 'licenses.json');
let store: Store | undefined;
let writeQueue: Promise<void> = Promise.resolve();

const load = async (): Promise<Store> => {
  if (store) {
    return store;
  }

  try {
    store = {licenses: [], keys: [], activations: [], pending: {}, ...JSON.parse(await fs.readFile(FILE, 'utf8')) as Partial<Store>};
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }

    store = {licenses: [], keys: [], activations: [], pending: {}};
  }

  return store;
};

const save = async (): Promise<void> => {
  const data = JSON.stringify(await load(), null, 2);
  writeQueue = writeQueue.catch(() => undefined).then(async () => {
    const temporary = `${FILE}.tmp`;
    await fs.writeFile(temporary, data);
    await fs.rename(temporary, FILE);
  });
  await writeQueue;
};

const randomId = (length: number) => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.randomBytes(length), byte => alphabet[byte % alphabet.length]).join('');
};

export const isExpired = (license: License, now = Date.now()): boolean =>
  license.expiresAt !== null && new Date(license.expiresAt).getTime() <= now;

const addDays = (days: number | null) => days === null ? null : new Date(Date.now() + (days * 24 * 60 * 60 * 1000)).toISOString();

/** Removes activations whose license is gone or expired. */
const pruneActivations = (data: Store): boolean => {
  const valid = new Set(data.licenses.filter(license => !isExpired(license)).map(license => license.id));
  const before = data.activations.length;
  data.activations = data.activations.filter(activation => valid.has(activation.licenseId));
  return data.activations.length !== before;
};

// ---------------------------------------------------------------------------
// Verwaltung (Bot-Besitzer)

export const giveLicense = async (userId: string, maxServers: number, days: number | null, note: string, source: License['source'] = 'give'): Promise<License> => {
  const data = await load();
  const license: License = {
    id: `L-${randomId(6)}`,
    userId,
    maxServers,
    expiresAt: addDays(days),
    note,
    createdAt: new Date().toISOString(),
    source,
  };
  data.licenses.push(license);
  await save();
  return license;
};

export const createKey = async (maxServers: number, days: number | null, note: string): Promise<LicenseKey> => {
  const data = await load();
  const key: LicenseKey = {
    key: `BYTE-${randomId(4)}-${randomId(4)}-${randomId(4)}`,
    maxServers,
    days,
    note,
    createdAt: new Date().toISOString(),
  };
  data.keys.push(key);
  await save();
  return key;
};

export const deleteKey = async (key: string): Promise<boolean> => {
  const data = await load();
  const before = data.keys.length;
  data.keys = data.keys.filter(entry => entry.key !== key.trim().toUpperCase());
  if (data.keys.length === before) {
    return false;
  }

  await save();
  return true;
};

/** Revokes one license by ID or all licenses of a user. Returns the revoked licenses. */
export const revokeLicenses = async ({licenseId, userId}: {licenseId?: string; userId?: string}): Promise<License[]> => {
  const data = await load();
  const revoked = data.licenses.filter(license => (licenseId && license.id === licenseId.trim().toUpperCase()) || (userId && license.userId === userId));
  if (revoked.length > 0) {
    const ids = new Set(revoked.map(license => license.id));
    data.licenses = data.licenses.filter(license => !ids.has(license.id));
    data.activations = data.activations.filter(activation => !ids.has(activation.licenseId));
    await save();
  }

  return revoked;
};

export const listLicenses = async (): Promise<Array<License & {used: Activation[]}>> => {
  const data = await load();
  return data.licenses.map(license => ({...license, used: data.activations.filter(activation => activation.licenseId === license.id)}));
};

export const listKeys = async (): Promise<LicenseKey[]> => [...(await load()).keys];

// ---------------------------------------------------------------------------
// Nutzer

export const licensesOf = async (userId: string): Promise<Array<License & {used: Activation[]}>> =>
  (await listLicenses()).filter(license => license.userId === userId);

/** Redeems a key: creates a license for the user and invalidates the key. */
export const redeemKey = async (key: string, userId: string): Promise<License | null> => {
  const data = await load();
  const normalized = key.trim().toUpperCase();
  const entry = data.keys.find(candidate => candidate.key === normalized);
  if (!entry) {
    return null;
  }

  data.keys = data.keys.filter(candidate => candidate !== entry);
  return giveLicense(userId, entry.maxServers, entry.days, entry.note, 'key');
};

export const getActivation = async (guildId: string): Promise<Activation | undefined> => {
  const data = await load();
  if (pruneActivations(data)) {
    await save();
  }

  return data.activations.find(activation => activation.guildId === guildId);
};

/**
 * Activates the guild with a free slot of one of the user's licenses
 * (unlimited licenses first, then the one that runs longest).
 */
export const activateGuild = async (guild: Guild, userId: string): Promise<{ok: true; license: License} | {ok: false; reason: string}> => {
  const data = await load();
  pruneActivations(data);

  const existing = data.activations.find(activation => activation.guildId === guild.id);
  if (existing) {
    return {ok: false, reason: existing.userId === userId ? 'dieser Server ist schon mit deiner Lizenz aktiviert' : 'dieser Server ist schon mit einer anderen Lizenz aktiviert'};
  }

  const candidates = data.licenses
    .filter(license => license.userId === userId && !isExpired(license))
    .filter(license => data.activations.filter(activation => activation.licenseId === license.id).length < license.maxServers)
    .sort((a, b) => {
      const end = (license: License) => license.expiresAt === null ? Number.MAX_SAFE_INTEGER : new Date(license.expiresAt).getTime();
      return end(b) - end(a);
    });

  const license = candidates[0];
  if (!license) {
    const hasAny = data.licenses.some(candidate => candidate.userId === userId && !isExpired(candidate));
    return {ok: false, reason: hasAny ? 'alle Server-Plätze deiner Lizenz sind belegt (mit /license deactivate auf einem anderen Server einen Platz freimachen)' : 'du hast keine gültige Lizenz'};
  }

  data.activations.push({guildId: guild.id, guildName: guild.name, licenseId: license.id, userId, activatedAt: new Date().toISOString()});
  delete data.pending[guild.id];
  await save();
  return {ok: true, license};
};

export const deactivateGuild = async (guildId: string): Promise<Activation | undefined> => {
  const data = await load();
  const activation = data.activations.find(candidate => candidate.guildId === guildId);
  if (activation) {
    data.activations = data.activations.filter(candidate => candidate !== activation);
    await save();
  }

  return activation;
};

// ---------------------------------------------------------------------------
// Server-Zugang

export type GuildState = {kind: 'owner'} | {kind: 'licensed'; activation: Activation} | {kind: 'grace'; until: Date} | {kind: 'denied'};

export const getGuildState = async (guild: Guild, force = false): Promise<GuildState> => {
  if (await isOwnerInGuild(guild, force)) {
    return {kind: 'owner'};
  }

  const activation = await getActivation(guild.id);
  if (activation) {
    return {kind: 'licensed', activation};
  }

  const until = (await load()).pending[guild.id];
  if (until && new Date(until).getTime() > Date.now()) {
    return {kind: 'grace', until: new Date(until)};
  }

  return {kind: 'denied'};
};

export const startGrace = async (guildId: string): Promise<Date> => {
  const data = await load();
  const until = new Date(Date.now() + GRACE_MS);
  data.pending[guildId] = until.toISOString();
  await save();
  return until;
};

export const leaveGuild = async (guild: Guild, reason: string): Promise<void> => {
  console.warn(`Verlasse Server ${guild.name} (${guild.id}): ${reason}`);
  const data = await load();
  delete data.pending[guild.id];
  await save();
  forgetGuildMembership(guild.id);
  await guild.leave();
};

/** Leaves the guild if it is neither the owner's, licensed, nor in its grace period. */
export const leaveIfNotAllowed = async (guild: Guild, force = false): Promise<boolean> => {
  const state = await getGuildState(guild, force);
  if (state.kind !== 'denied') {
    return false;
  }

  await leaveGuild(guild, 'weder Bot-Besitzer noch gültige Lizenz');
  return true;
};

export const checkAllGuilds = async (client: Client): Promise<void> => {
  for (const guild of client.guilds.cache.values()) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await leaveIfNotAllowed(guild, true);
    } catch (error: unknown) {
      console.error(`Lizenz-Check für Server ${guild.id} fehlgeschlagen:`, error);
    }
  }
};

/**
 * For a newly joined guild: allowed as is, auto-activated via the server
 * owner's license, or given a grace period. Returns the resulting state.
 */
export const admitNewGuild = async (guild: Guild): Promise<GuildState> => {
  const state = await getGuildState(guild, true);
  if (state.kind !== 'denied') {
    return state;
  }

  if (!isOwner(guild.ownerId)) {
    const result = await activateGuild(guild, guild.ownerId);
    if (result.ok) {
      return getGuildState(guild);
    }
  }

  return {kind: 'grace', until: await startGrace(guild.id)};
};
