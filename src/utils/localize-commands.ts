import type {RESTPostAPIChatInputApplicationCommandsJSONBody} from 'discord-api-types/v10';

/*
 * Deutsche Befehlsnamen über Discords Übersetzungen (name_localizations).
 * Wer Discord auf Deutsch nutzt, sieht z. B. /abspielen statt /play. Intern
 * (interaction.commandName) bleibt immer der englische Name, deshalb muss im
 * Code nichts umbenannt werden.
 */

const COMMAND_NAMES: Record<string, string> = {
  play: 'abspielen',
  queue: 'warteschlange',
  skip: 'überspringen',
  next: 'nächster',
  unskip: 'zurück',
  stop: 'stopp',
  resume: 'fortsetzen',
  seek: 'springen',
  fseek: 'vorspulen',
  shuffle: 'mischen',
  loop: 'wiederholen',
  'loop-queue': 'warteschlange-wiederholen',
  clear: 'leeren',
  remove: 'entfernen',
  move: 'verschieben',
  volume: 'lautstärke',
  replay: 'von-vorn',
  disconnect: 'trennen',
  'now-playing': 'läuft-gerade',
  favorites: 'favoriten',
  config: 'einstellungen',
  help: 'hilfe',
  lyrics: 'liedtext',
  license: 'lizenz',
  'license-admin': 'lizenz-admin',
  blacklist: 'sperrliste',
  'admin-servers': 'admin-server',
};

/** Häufige Optionen; gilt auf allen Ebenen (auch in Unterbefehlen). */
const OPTION_NAMES: Record<string, string> = {
  query: 'suche',
  page: 'seite',
  'page-size': 'seitengröße',
  immediate: 'vorne',
  split: 'kapitel',
  channel: 'kanal',
  role: 'rolle',
  value: 'wert',
  percent: 'prozent',
  level: 'stufe',
  time: 'zeit',
};

type OptionJson = {name: string; name_localizations?: Record<string, string> | null; options?: OptionJson[]};

const localizeOptions = (options: OptionJson[] | undefined) => {
  for (const option of options ?? []) {
    const german = OPTION_NAMES[option.name];
    // Innerhalb einer Ebene müssen Namen eindeutig bleiben.
    if (german && !options!.some(other => other !== option && (other.name === german || other.name_localizations?.de === german))) {
      option.name_localizations = {...option.name_localizations, de: german};
    }

    localizeOptions(option.options);
  }
};

export const localizeCommand = (json: RESTPostAPIChatInputApplicationCommandsJSONBody): RESTPostAPIChatInputApplicationCommandsJSONBody => {
  const copy = JSON.parse(JSON.stringify(json)) as RESTPostAPIChatInputApplicationCommandsJSONBody;
  const german = COMMAND_NAMES[copy.name];
  if (german) {
    copy.name_localizations = {...copy.name_localizations, de: german};
  }

  localizeOptions(copy.options as OptionJson[] | undefined);
  return copy;
};
