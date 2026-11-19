import {EmbedBuilder} from 'discord.js';
import {truncate} from './string.js';

/*
 * Einheitliche Embeds für alle Bot-Antworten: Farbe nach Art der Meldung,
 * kurze Bestätigungen als Titel, längere Texte (mit Markdown/Links) als Beschreibung.
 */

export type Tone = 'success' | 'info' | 'warn' | 'error' | 'music';

export const COLORS: Record<Tone, number> = {
  success: 0x57_F2_87,
  info: 0x58_65_F2,
  warn: 0xFE_E7_5C,
  error: 0xED_42_45,
  music: 0x9B_59_B6,
};

const FOOTER = 'ByteMusic';

/** Embed mit Titel (kein Markdown) und optionaler Beschreibung (mit Markdown). */
export const notice = (tone: Tone, title: string, description?: string): EmbedBuilder => {
  const embed = new EmbedBuilder().setColor(COLORS[tone]).setTitle(truncate(title, 256));
  if (description) {
    embed.setDescription(truncate(description, 4096));
  }

  return embed;
};

/** Embed nur mit Beschreibung, für Texte mit Markdown, Links oder Erwähnungen. */
export const textEmbed = (tone: Tone, description: string, title?: string): EmbedBuilder => {
  const embed = new EmbedBuilder().setColor(COLORS[tone]).setDescription(truncate(description, 4096));
  if (title) {
    embed.setTitle(truncate(title, 256));
  }

  return embed;
};

/** Art der Meldung am ersten Zeichen erkennen (für bestehende Texte mit Emoji am Anfang). */
export const toneOf = (text: string): Tone => {
  if (/^(🚫|❌)/u.test(text)) {
    return 'error';
  }

  if (/^(⛔|⚠️|⏳|⌛)/u.test(text)) {
    return 'warn';
  }

  if (/^(✅|👍|🎉|➕|🔑|🔓)/u.test(text)) {
    return 'success';
  }

  return 'info';
};

/** Beliebigen Text als Embed, Farbe nach führendem Emoji. */
export const embedOf = (text: string, title?: string): EmbedBuilder => textEmbed(toneOf(text), text, title);

/** Fehler-Embed: „🚫 Fehler“ als Titel, Meldung (erster Buchstabe groß) als Beschreibung. */
export const errorEmbed = (error?: string | Error): EmbedBuilder => {
  const raw = typeof error === 'string' ? error : error?.message;
  const text = raw?.trim() ? raw.trim() : 'unbekannter Fehler';
  return notice('error', '🚫 Fehler', text.charAt(0).toUpperCase() + text.slice(1));
};

/** Embed für Direktnachrichten, mit Fußzeile. */
export const dmEmbed = (tone: Tone, description: string, title?: string): EmbedBuilder =>
  textEmbed(tone, description, title).setFooter({text: FOOTER}).setTimestamp();
