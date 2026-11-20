import fs from 'node:fs';
import path from 'node:path';
import {ChannelType, type Client, type GuildTextBasedChannel} from 'discord.js';
import {DATA_DIR} from './config.js';
import type Player from './player.js';
import {STATUS, type QueuedSong} from './player-types.js';
import type PlayerManager from '../managers/player.js';
import type SessionPlayer from './session-player.js';
import {getSizeWithoutBots} from '../utils/channels.js';
import {getGuildExtras} from '../utils/guild-extras.js';
import {notice} from '../utils/embeds.js';

/*
 * Warteschlange über Neustarts retten: Für jeden Server mit laufender
 * Wiedergabe werden Sprachkanal, aktueller Song samt Position und die
 * restliche Warteschlange in data/player-state.json gespeichert (bei jeder
 * Änderung und alle 10 Sekunden). Nach dem Start geht es dort weiter.
 */

const FILE = path.join(DATA_DIR, 'player-state.json');
const MAX_SAVED_SONGS = 500;
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

type SavedPlayer = {
  voiceChannelId: string;
  textChannelId?: string;
  songs: QueuedSong[];
  lastPlayed?: QueuedSong;
  position: number;
  paused: boolean;
  volume: number;
  loopSong: boolean;
  loopQueue: boolean;
  savedAt: string;
};

type SavedState = Record<string, SavedPlayer>;

export default class QueuePersistence {
  private dirty = false;
  private restoring = new Set<string>();
  private timer?: NodeJS.Timeout;

  constructor(private readonly playerManager: PlayerManager, private readonly sessionPlayer: SessionPlayer) {}

  /** Player-Änderungen beobachten und regelmäßig speichern. */
  start(): void {
    // Bis zur Wiederherstellung den gespeicherten Stand nicht überschreiben.
    for (const guildId of Object.keys(this.read())) {
      this.restoring.add(guildId);
    }

    this.playerManager.onCreate = player => {
      player.onStateChange = () => {
        this.dirty = true;
      };
    };

    for (const player of this.playerManager.all()) {
      player.onStateChange = () => {
        this.dirty = true;
      };
    }

    this.timer = setInterval(() => {
      // Läuft etwas, ändert sich die Position ständig: dann immer speichern.
      if (this.dirty || this.playerManager.all().some(player => player.status === STATUS.PLAYING)) {
        this.saveNow();
      }
    }, 10_000);
    this.timer.unref();

    const onExit = () => {
      this.saveNow();
      process.exit(0);
    };

    process.once('SIGTERM', onExit);
    process.once('SIGINT', onExit);
  }

  snapshot(): SavedState {
    const state: SavedState = {};
    if (this.restoring.size > 0) {
      const previous = this.read();
      for (const guildId of this.restoring) {
        if (previous[guildId]) {
          state[guildId] = previous[guildId];
        }
      }
    }

    for (const player of this.playerManager.all()) {
      if (this.restoring.has(player.guildId)) {
        // Noch nicht fertig wiederhergestellt: alten Stand behalten (siehe oben).
        continue;
      }

      const current = player.getCurrent();
      const voiceChannelId = player.getVoiceChannelId();
      if (!current || !voiceChannelId || player.status === STATUS.IDLE) {
        continue;
      }

      state[player.guildId] = {
        voiceChannelId,
        textChannelId: player.listeningSession?.snapshot()?.channelId ?? current.addedInChannelId,
        songs: [current, ...player.getQueue()].slice(0, MAX_SAVED_SONGS),
        lastPlayed: player.getHistory().at(-1),
        position: current.isLive ? 0 : player.getPosition(),
        paused: player.status === STATUS.PAUSED,
        volume: player.getVolume(),
        loopSong: player.loopCurrentSong,
        loopQueue: player.loopCurrentQueue,
        savedAt: new Date().toISOString(),
      };
    }

    return state;
  }

  saveNow(): void {
    try {
      const data = JSON.stringify(this.snapshot());
      const temporary = `${FILE}.tmp`;
      fs.writeFileSync(temporary, data);
      fs.renameSync(temporary, FILE);
      this.dirty = false;
    } catch (error: unknown) {
      console.warn(`Warteschlange konnte nicht gespeichert werden: ${String((error as Error).message ?? error)}`);
    }
  }

  private read(): SavedState {
    try {
      return JSON.parse(fs.readFileSync(FILE, 'utf8')) as SavedState;
    } catch {
      return {};
    }
  }

  /** Nach dem Start: gespeicherte Wiedergaben fortsetzen. */
  async restore(client: Client): Promise<void> {
    const saved = this.read();
    const entries = Object.entries(saved).filter(([guildId]) => this.restoring.has(guildId));

    await Promise.all(entries.map(async ([guildId, entry]) => {
      try {
        await this.restoreGuild(client, guildId, entry);
      } catch (error: unknown) {
        console.warn(`Warteschlange für ${guildId} nicht wiederhergestellt: ${String((error as Error).message ?? error)}`);
      } finally {
        this.restoring.delete(guildId);
      }
    }));
    this.saveNow();
  }

  private async restoreGuild(client: Client, guildId: string, entry: SavedPlayer): Promise<void> {
    if (Date.now() - new Date(entry.savedAt).getTime() > MAX_AGE_MS || entry.songs.length === 0) {
      return;
    }

    const guild = client.guilds.cache.get(guildId);
    const channel = guild?.channels.cache.get(entry.voiceChannelId);
    if (!guild || channel?.type !== ChannelType.GuildVoice || !channel.joinable) {
      return;
    }

    // Nur zurückkommen, wenn noch jemand zuhört (oder es der Radio-Kanal ist).
    const {radioChannelId} = await getGuildExtras(guildId);
    if (getSizeWithoutBots(channel) === 0 && radioChannelId !== channel.id) {
      return;
    }

    const player = this.playerManager.get(guildId);
    if (player.voiceConnection || player.getCurrent()) {
      return;
    }

    await player.connect(channel);
    if (entry.lastPlayed) {
      // Als „schon gespielt“ für Autoplay und den Zurück-Button.
      player.add(entry.lastPlayed);
      player.manualForward(1);
    }

    for (const song of entry.songs) {
      player.add(song);
    }

    player.setVolume(entry.volume);
    player.loopCurrentSong = entry.loopSong;
    player.loopCurrentQueue = entry.loopQueue;
    await player.play();
    const current = player.getCurrent();
    if (current && !current.isLive && entry.position > 5 && entry.position < current.length - 5) {
      await player.seek(entry.position);
    }

    if (entry.paused) {
      player.pause();
    }

    const textChannel = entry.textChannelId ? guild.channels.cache.get(entry.textChannelId) : undefined;
    if (textChannel?.isTextBased()) {
      await textChannel.send({embeds: [notice('music', '🔄 Nach einem Neustart geht es weiter', `Die Warteschlange (${entry.songs.length} Songs) läuft wieder in <#${channel.id}>.`)], allowedMentions: {parse: []}}).catch(() => undefined);
      await this.sessionPlayer.ensureMessage(player, textChannel as GuildTextBasedChannel).catch(() => undefined);
    }

    console.log(`Warteschlange für ${guildId} wiederhergestellt (${entry.songs.length} Songs).`);
  }
}
