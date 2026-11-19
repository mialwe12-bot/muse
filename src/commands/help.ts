import {ChatInputCommandInteraction} from 'discord.js';
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
    const commandList = this.commands
      .map(c => `**/${c.slashCommand.name ?? ''}** — ${c.slashCommand.description ?? ''}`)
      .join('\n');

    const usage = [
      '**Hör-Sessions**',
      'Füge Musik mit `/play` hinzu. Die Bestätigung siehst nur du; die gemeinsame Player-Karte zeigt Wiedergabe und Steuerung.',
      'Wenn die Warteschlange zu Ende ist, zeigt die Karte die gespielten Songs. Den kompletten Verlauf gibt es unter **Ganzen Verlauf anzeigen**.',
      '',
      '**Favoriten**',
      'Ein Favorit speichert einen Suchbegriff oder Song-/Playlist-Link für diesen Server, nicht die Audiodatei oder die Warteschlange.',
      'Erstellen mit `/favorites create name:lofi query:lofi hip hop`, abspielen mit `/favorites use name:lofi`.',
      'Mit `/favorites list` siehst du alle Favoriten dieses Servers.',
      '',
      '**Verlassen, wenn die Warteschlange leer ist**',
      '`/config set-wait-after-queue-empties delay:60` wartet 60 Sekunden, bevor der Bot den Sprachkanal verlässt.',
      'Mit `delay:0` bleibt er auch bei leerer Warteschlange. `/config set-leave-if-no-listeners` ist eine eigene Einstellung.',
    ].join('\n');

    await interaction.reply({content: `${commandList}\n\n${usage}`, ephemeral: true});
  }
}
