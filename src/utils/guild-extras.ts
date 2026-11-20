import fs from 'node:fs/promises';
import path from 'node:path';
import {DATA_DIR} from '../services/config.js';

/*
 * Zusätzliche Server-Einstellungen von ByteMusic (Autoplay, Radio-Kanal,
 * DJ-Rolle, Abstimmung zum Überspringen, Liedtexte). Liegen in
 * data/guild-extras.json statt in der Datenbank, damit kein Prisma-Schema
 * geändert werden muss.
 */

export type GuildExtras = {
  /** Wenn die Warteschlange leer ist, ähnliche Songs weiterspielen. */
  autoplay: boolean;
  /** Sprachkanal, in den der Bot wechselt, wenn alle Zuhörer gegangen sind. */
  radioChannelId?: string;
  /** Suchbegriff oder Link als Startpunkt, falls noch nichts gespielt wurde. */
  radioSeed?: string;
  /** Wenn gesetzt, dürfen nur diese Rolle (und Admins) die Wiedergabe steuern. */
  djRoleId?: string;
  /** Wer kein DJ ist, kann per Abstimmung überspringen. */
  voteSkip: boolean;
  /** Anteil der Zuhörer (in Prozent), der zum Überspringen nötig ist. */
  voteSkipPercent: number;
  /** /lyrics auf diesem Server erlauben. */
  lyrics: boolean;
};

export const DEFAULT_EXTRAS: GuildExtras = {
  autoplay: false,
  voteSkip: false,
  voteSkipPercent: 50,
  lyrics: true,
};

const FILE = path.join(DATA_DIR, 'guild-extras.json');
let cache: Record<string, Partial<GuildExtras>> | undefined;
let writeQueue: Promise<void> = Promise.resolve();

const load = async (): Promise<Record<string, Partial<GuildExtras>>> => {
  if (cache) {
    return cache;
  }

  try {
    cache = JSON.parse(await fs.readFile(FILE, 'utf8')) as Record<string, Partial<GuildExtras>>;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }

    cache = {};
  }

  return cache;
};

const save = async (): Promise<void> => {
  const data = JSON.stringify(await load(), null, 2);
  writeQueue = writeQueue.catch(() => undefined).then(async () => {
    await fs.mkdir(DATA_DIR, {recursive: true});
    const temporary = `${FILE}.tmp`;
    await fs.writeFile(temporary, data);
    await fs.rename(temporary, FILE);
  });
  await writeQueue;
};

export const getGuildExtras = async (guildId: string): Promise<GuildExtras> => ({
  ...DEFAULT_EXTRAS,
  ...(await load())[guildId],
});

/** Felder mit `undefined` werden entfernt (z. B. Radio-Kanal ausschalten). */
export const updateGuildExtras = async (guildId: string, patch: Partial<GuildExtras>): Promise<GuildExtras> => {
  const all = await load();
  const next: Partial<GuildExtras> = {...all[guildId]};
  for (const [key, value] of Object.entries(patch) as Array<[keyof GuildExtras, unknown]>) {
    if (value === undefined) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete next[key];
    } else {
      (next as Record<string, unknown>)[key] = value;
    }
  }

  all[guildId] = next;
  await save();
  return getGuildExtras(guildId);
};

export const listGuildExtras = async (): Promise<Record<string, GuildExtras>> => {
  const all = await load();
  return Object.fromEntries(Object.keys(all).map(id => [id, {...DEFAULT_EXTRAS, ...all[id]}]));
};
