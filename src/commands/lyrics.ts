import {ChatInputCommandInteraction, EmbedBuilder} from 'discord.js';
import {SlashCommandBuilder} from '@discordjs/builders';
import {inject, injectable} from 'inversify';
import {TYPES} from '../types.js';
import PlayerManager from '../managers/player.js';
import Command from './index.js';
import {COLORS} from '../utils/embeds.js';
import {getGuildExtras} from '../utils/guild-extras.js';
import {truncate} from '../utils/string.js';

/*
 * Liedtexte über LRCLIB (https://lrclib.net, kostenlos, ohne API-Key).
 */

type LrclibTrack = {
  trackName: string;
  artistName: string;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
};

const USER_AGENT = 'ByteMusic Discord bot';

/** YouTube-Titel säubern: „(Official Video)“, „[HD]“, „ft. …“ usw. entfernen. */
export const cleanTitle = (title: string): string => title
  .replace(/\s*[([][^)\]]*(official|video|audio|lyrics?|lyric video|visuali[sz]er|hd|4k|remaster(ed)?|mv|clip)[^)\]]*[)\]]/gi, '')
  .replace(/\s+(ft\.?|feat\.?|featuring)\s+.*$/i, '')
  .replace(/\s*\|.*$/, '')
  .replace(/["“”]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const search = async (params: Record<string, string>): Promise<LrclibTrack[]> => {
  const url = `https://lrclib.net/api/search?${new URLSearchParams(params).toString()}`;
  const response = await fetch(url, {headers: {'User-Agent': USER_AGENT}, signal: AbortSignal.timeout(10_000)});
  if (!response.ok) {
    throw new Error(`Liedtext-Dienst antwortet nicht (HTTP ${response.status})`);
  }

  return await response.json() as LrclibTrack[];
};

export const findLyrics = async (title: string, artist: string, length?: number): Promise<LrclibTrack | null> => {
  const cleaned = cleanTitle(title);
  const queries: Array<Record<string, string>> = [];
  const dash = cleaned.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (dash) {
    queries.push({artist_name: dash[1], track_name: dash[2]});
  }

  if (artist && !/youtube|topic|vevo/i.test(artist)) {
    queries.push({artist_name: artist.replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, ''), track_name: dash ? dash[2] : cleaned});
  }

  queries.push({q: cleaned});

  for (const params of queries) {
    // eslint-disable-next-line no-await-in-loop
    const results = (await search(params)).filter(track => track.plainLyrics && !track.instrumental);
    if (results.length === 0) {
      continue;
    }

    if (length && length > 0) {
      const close = results.find(track => Math.abs(track.duration - length) <= 8);
      if (close) {
        return close;
      }
    }

    return results[0];
  }

  return null;
};

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('lyrics')
    .setDescription('Liedtext zum aktuellen Song (oder zu einer Suche) anzeigen')
    .addStringOption(option => option
      .setName('query')
      .setDescription('Song suchen, z. B. „Interpret - Titel“ [Standard: aktueller Song]')
      .setMaxLength(200)
      .setRequired(false));

  constructor(@inject(TYPES.Managers.Player) private readonly playerManager: PlayerManager) {}

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const {lyrics} = await getGuildExtras(interaction.guild!.id);
    if (!lyrics) {
      throw new Error('Liedtexte sind auf diesem Server abgeschaltet (/config set-lyrics)');
    }

    const query = interaction.options.getString('query')?.trim();
    const current = this.playerManager.getExisting(interaction.guild!.id)?.getCurrent();
    if (!query && !current) {
      throw new Error('gerade läuft nichts. Gib einen Song an, z. B. `/lyrics query: Interpret - Titel`');
    }

    await interaction.deferReply();
    const track = query
      ? await findLyrics(query, '')
      : await findLyrics(current!.title, current!.artist, current!.length);

    if (!track?.plainLyrics) {
      throw new Error(`keinen Liedtext gefunden für „${truncate(query ?? cleanTitle(current!.title), 100)}“`);
    }

    // Bis zu drei Embeds à 4000 Zeichen, an Leerzeilen getrennt.
    const parts: string[] = [];
    let rest = track.plainLyrics.trim();
    while (rest.length > 0 && parts.length < 3) {
      if (rest.length <= 4000) {
        parts.push(rest);
        break;
      }

      let cut = rest.lastIndexOf('\n\n', 4000);
      if (cut < 1000) {
        cut = rest.lastIndexOf('\n', 4000);
      }

      if (cut < 1000) {
        cut = 4000;
      }

      parts.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }

    if (rest.length > 0 && parts.length === 3 && !parts[2].endsWith('…')) {
      parts[2] = `${truncate(parts[2], 3990)}\n…`;
    }

    const embeds = parts.map((text, index) => {
      const embed = new EmbedBuilder().setColor(COLORS.music).setDescription(text);
      if (index === 0) {
        embed.setTitle(truncate(`📝 ${track.artistName} – ${track.trackName}`, 256));
      }

      if (index === parts.length - 1) {
        embed.setFooter({text: 'Liedtext: lrclib.net'});
      }

      return embed;
    });

    // Discord erlaubt höchstens 6000 Zeichen Embed-Text pro Nachricht.
    const [first, ...more] = embeds;
    await interaction.editReply({embeds: [first]});
    for (const embed of more) {
      // eslint-disable-next-line no-await-in-loop
      await interaction.followUp({embeds: [embed]});
    }
  }
}
