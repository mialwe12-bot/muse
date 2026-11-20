import {VoiceChannel, VoiceState} from 'discord.js';
import {VoiceConnectionStatus} from '@discordjs/voice';
import container from '../inversify.config.js';
import {TYPES} from '../types.js';
import PlayerManager from '../managers/player.js';
import {getSizeWithoutBots} from '../utils/channels.js';
import {getGuildSettings} from '../utils/get-guild-settings.js';
import {switchToRadio} from '../services/autoplay.js';
import {getGuildExtras} from '../utils/guild-extras.js';

export default async (oldState: VoiceState, newState: VoiceState): Promise<void> => {
  const playerManager = container.get<PlayerManager>(TYPES.Managers.Player);

  const player = playerManager.get(oldState.guild.id);

  const {voiceConnection} = player;
  if (!voiceConnection || voiceConnection.state.status !== VoiceConnectionStatus.Ready) {
    return;
  }

  const {channelId} = voiceConnection.joinConfig;
  if (!channelId || (oldState.channelId !== channelId && newState.channelId !== channelId)) {
    return;
  }

  const {leaveIfNoListeners} = await getGuildSettings(player.guildId);
  // A settings lookup can outlive a move, reconnect, or disconnect.
  if (player.voiceConnection !== voiceConnection
    || voiceConnection.state.status !== VoiceConnectionStatus.Ready
    || voiceConnection.joinConfig.channelId !== channelId) {
    return;
  }

  const voiceChannel = newState.guild.channels.cache.get(channelId) as VoiceChannel | undefined;
  if (voiceChannel && getSizeWithoutBots(voiceChannel) > 0) {
    return;
  }

  // Radio: statt zu gehen in den Radio-Kanal wechseln und dort weiterspielen.
  // Im Radio-Kanal selbst bleibt der Bot auch ohne Zuhörer.
  const {radioChannelId} = await getGuildExtras(player.guildId);
  if (radioChannelId && player.voiceConnection === voiceConnection) {
    if (radioChannelId === channelId) {
      return;
    }

    try {
      if (await switchToRadio(player, newState.guild)) {
        return;
      }
    } catch (error: unknown) {
      console.warn(`Wechsel in den Radio-Kanal fehlgeschlagen (${player.guildId}): ${String((error as Error).message ?? error)}`);
    }
  }

  if (player.voiceConnection === voiceConnection && (!voiceChannel || leaveIfNoListeners)) {
    player.disconnect();
  }
};
