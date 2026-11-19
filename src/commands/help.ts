import {ChatInputCommandInteraction, EmbedBuilder} from 'discord.js';
import {isOwner} from '../utils/access.js';
import {truncate} from '../utils/string.js';
import {injectable} from 'inversify';
import Command from './index.js';
import {SlashCommandBuilder} from '@discordjs/builders';

@injectable()
export default class implements Command {
  public readonly slashCommand = new SlashCommandBuilder()
    .setName('help')
    .setDescription('zeigt alle Befehle an');

  private commands: Command[] = [];

  public setCommands(commands: Command[]) {
    this.commands = commands;
  }

  public async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    // Admin-Befehle nur dem Bot-Besitzer zeigen.
    const commandList = this.commands
      .filter(c => isOwner(interaction.user.id) || !c.ownerOnly)
      .map(c => `**/${c.slashCommand.name ?? ''}** — ${c.slashCommand.description ?? ''}`)
      .join('\n');

    const usage = [
      '**Hör-Sessions**',
      'Füge Musik mit `/play` hinzu. Die Bestätigung siehst nur du; die gemeinsame Player-Karte zeigt Wiedergabe und Steuerung.',
      'Wenn die Warteschlange zu Ende ist, zeigt die Karte die gespielten Songs.',
      '',
      '**Favoriten**',
      'Ein Favorit speichert einen Suchbegriff oder Song-/Playlist-Link für diesen Server, nicht die Audiodatei oder die Warteschlange.',
      'Erstellen mit `/favorites create name:lofi query:lofi hip hop`, abspielen mit `/favorites use name:lofi`.',
      'Mit `/favorites list` siehst du alle Favoriten dieses Servers.',
      '',
      '**Verlassen, wenn die Warteschlange leer ist**',
      '`/config set-wait-after-queue-empties delay:60` wartet 60 Sekunden, bevor der Bot den Sprachkanal verlässt.',
      'Mit `delay:0` bleibt er auch bei leerer Warteschlange. `/config set-leave-if-no-listeners` ist eine eigene Einstellung.',
      '',
      '**Lizenzen**',
      'ByteMusic läuft auf Servern seines Besitzers und auf lizenzierten Servern. Mit einer Lizenz schaltest du einen Server mit `/license activate` frei, einen Schlüssel (`BYTE-…`) löst du mit `/license redeem` ein. `/license status` zeigt, was du hast.',
    ].join('\n');

    await interaction.reply({
      embeds: [
        new EmbedBuilder().setTitle('🎵 ByteMusic – Befehle').setColor('Blurple').setDescription(truncate(commandList, 4096)),
        new EmbedBuilder().setTitle('Tipps').setColor('Blurple').setDescription(usage),
      ],
      ephemeral: true,
    });
  }
}
