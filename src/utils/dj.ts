import {ChannelType, PermissionFlagsBits, type Guild, type GuildMember} from 'discord.js';
import type Player from '../services/player.js';
import {getGuildExtras} from './guild-extras.js';
import {getSizeWithoutBots} from './channels.js';
import {isOwner} from './access.js';

/*
 * DJ-Rolle und Abstimmung zum Überspringen (per /config einstellbar).
 * - Ist eine DJ-Rolle gesetzt, dürfen nur DJs, Admins/Server-Verwalter und der
 *   Bot-Besitzer die Wiedergabe steuern. Wer allein mit dem Bot im Kanal ist,
 *   darf immer steuern. Songs hinzufügen (/play) dürfen weiterhin alle.
 * - Ist die Abstimmung an, zählt /skip (bzw. „Weiter“) von Nicht-DJs als Stimme.
 *   Den eigenen Song darf man immer überspringen.
 */

/** Befehle, die die laufende Wiedergabe verändern. */
export const CONTROL_COMMANDS = new Set([
  'skip', 'next', 'unskip', 'stop', 'clear', 'remove', 'move', 'shuffle', 'pause', 'resume',
  'seek', 'fseek', 'volume', 'loop', 'loop-queue', 'replay', 'disconnect',
]);
export const SKIP_COMMANDS = new Set(['skip', 'next']);

export type ControlDecision = {ok: true} | {ok: false; message: string; vote?: boolean};

const votes = new Map<string, {entryId: number | null; voters: Set<string>}>();

const isPrivileged = (member: GuildMember, djRoleId?: string) => isOwner(member.id)
  || member.permissions.has(PermissionFlagsBits.Administrator)
  || member.permissions.has(PermissionFlagsBits.ManageGuild)
  || Boolean(djRoleId && member.roles.cache.has(djRoleId));

const botChannelOf = (guild: Guild, player: Player) => {
  const id = player.getVoiceChannelId();
  const channel = id ? guild.channels.cache.get(id) : undefined;
  return channel?.type === ChannelType.GuildVoice ? channel : undefined;
};

export const decideControl = async (guild: Guild, member: GuildMember, player: Player, kind: 'skip' | 'control'): Promise<ControlDecision> => {
  const extras = await getGuildExtras(guild.id);
  if (!extras.djRoleId && !(kind === 'skip' && extras.voteSkip)) {
    return {ok: true};
  }

  if (isPrivileged(member, extras.djRoleId)) {
    return {ok: true};
  }

  const channel = botChannelOf(guild, player);
  const listeners = channel ? getSizeWithoutBots(channel) : 0;
  const memberInBotChannel = Boolean(channel && channel.members.has(member.id));
  if (memberInBotChannel && listeners <= 1) {
    return {ok: true};
  }

  if (kind === 'skip') {
    if (player.getCurrent()?.requestedBy === member.id) {
      return {ok: true};
    }

    if (extras.voteSkip) {
      if (!channel || !memberInBotChannel) {
        return {ok: false, message: 'zum Abstimmen musst du im Sprachkanal des Bots sein'};
      }

      const entryId = player.getCurrentQueueEntryId();
      let vote = votes.get(guild.id);
      if (!vote || vote.entryId !== entryId) {
        vote = {entryId, voters: new Set()};
        votes.set(guild.id, vote);
      }

      vote.voters.add(member.id);
      // Nur Stimmen von Leuten zählen, die noch im Kanal sind.
      const counted = [...vote.voters].filter(id => channel.members.has(id)).length;
      const needed = Math.max(1, Math.ceil(listeners * extras.voteSkipPercent / 100));
      if (counted >= needed) {
        votes.delete(guild.id);
        return {ok: true};
      }

      return {ok: false, vote: true, message: `🗳️ Stimme gezählt: ${counted}/${needed} zum Überspringen.`};
    }
  }

  return {
    ok: false,
    message: extras.djRoleId
      ? `das dürfen nur <@&${extras.djRoleId}> und Admins`
      : 'das darfst du hier nicht',
  };
};

/** Nach einem erfolgreichen Überspringen offene Stimmen verwerfen. */
export const resetVotes = (guildId: string) => {
  votes.delete(guildId);
};
