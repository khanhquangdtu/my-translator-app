/**
 * Language table for the picker.
 *
 * Codes are the ISO-639-1 values Soniox accepts in `language_hints` and
 * `translation.target_language`. Native names matter here: the picker is a
 * 70-row full-screen list, and a reader scanning for their own language finds
 * "Tiếng Việt" far faster than "Vietnamese".
 */

export type Language = {
  code: string;
  name: string;
  native: string;
};

/** Pinned to the top of the source picker; not valid as a target. */
export const AUTO_DETECT: Language = {
  code: 'auto',
  name: 'Auto-detect',
  native: 'less accurate',
};

export const LANGUAGES: Language[] = [
  { code: 'af', name: 'Afrikaans', native: 'Afrikaans' },
  { code: 'ar', name: 'Arabic', native: 'العربية' },
  { code: 'az', name: 'Azerbaijani', native: 'Azərbaycan' },
  { code: 'be', name: 'Belarusian', native: 'Беларуская' },
  { code: 'bg', name: 'Bulgarian', native: 'Български' },
  { code: 'bn', name: 'Bengali', native: 'বাংলা' },
  { code: 'bs', name: 'Bosnian', native: 'Bosanski' },
  { code: 'ca', name: 'Catalan', native: 'Català' },
  { code: 'cs', name: 'Czech', native: 'Čeština' },
  { code: 'cy', name: 'Welsh', native: 'Cymraeg' },
  { code: 'da', name: 'Danish', native: 'Dansk' },
  { code: 'de', name: 'German', native: 'Deutsch' },
  { code: 'el', name: 'Greek', native: 'Ελληνικά' },
  { code: 'en', name: 'English', native: 'English' },
  { code: 'es', name: 'Spanish', native: 'Español' },
  { code: 'et', name: 'Estonian', native: 'Eesti' },
  { code: 'eu', name: 'Basque', native: 'Euskara' },
  { code: 'fa', name: 'Persian', native: 'فارسی' },
  { code: 'fi', name: 'Finnish', native: 'Suomi' },
  { code: 'fr', name: 'French', native: 'Français' },
  { code: 'gl', name: 'Galician', native: 'Galego' },
  { code: 'he', name: 'Hebrew', native: 'עברית' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी' },
  { code: 'hr', name: 'Croatian', native: 'Hrvatski' },
  { code: 'hu', name: 'Hungarian', native: 'Magyar' },
  { code: 'hy', name: 'Armenian', native: 'Հայերեն' },
  { code: 'id', name: 'Indonesian', native: 'Indonesia' },
  { code: 'is', name: 'Icelandic', native: 'Íslenska' },
  { code: 'it', name: 'Italian', native: 'Italiano' },
  { code: 'ja', name: 'Japanese', native: '日本語' },
  { code: 'kk', name: 'Kazakh', native: 'Қазақша' },
  { code: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ' },
  { code: 'ko', name: 'Korean', native: '한국어' },
  { code: 'lt', name: 'Lithuanian', native: 'Lietuvių' },
  { code: 'lv', name: 'Latvian', native: 'Latviešu' },
  { code: 'mk', name: 'Macedonian', native: 'Македонски' },
  { code: 'ml', name: 'Malayalam', native: 'മലയാളം' },
  { code: 'mr', name: 'Marathi', native: 'मराठी' },
  { code: 'ms', name: 'Malay', native: 'Bahasa Melayu' },
  { code: 'ne', name: 'Nepali', native: 'नेपाली' },
  { code: 'nl', name: 'Dutch', native: 'Nederlands' },
  { code: 'no', name: 'Norwegian', native: 'Norsk' },
  { code: 'pa', name: 'Punjabi', native: 'ਪੰਜਾਬੀ' },
  { code: 'pl', name: 'Polish', native: 'Polski' },
  { code: 'pt', name: 'Portuguese', native: 'Português' },
  { code: 'ro', name: 'Romanian', native: 'Română' },
  { code: 'ru', name: 'Russian', native: 'Русский' },
  { code: 'sk', name: 'Slovak', native: 'Slovenčina' },
  { code: 'sl', name: 'Slovenian', native: 'Slovenščina' },
  { code: 'sq', name: 'Albanian', native: 'Shqip' },
  { code: 'sr', name: 'Serbian', native: 'Српски' },
  { code: 'sv', name: 'Swedish', native: 'Svenska' },
  { code: 'sw', name: 'Swahili', native: 'Kiswahili' },
  { code: 'ta', name: 'Tamil', native: 'தமிழ்' },
  { code: 'te', name: 'Telugu', native: 'తెలుగు' },
  { code: 'th', name: 'Thai', native: 'ไทย' },
  { code: 'tl', name: 'Tagalog', native: 'Tagalog' },
  { code: 'tr', name: 'Turkish', native: 'Türkçe' },
  { code: 'uk', name: 'Ukrainian', native: 'Українська' },
  { code: 'ur', name: 'Urdu', native: 'اردو' },
  { code: 'vi', name: 'Vietnamese', native: 'Tiếng Việt' },
  { code: 'zh', name: 'Chinese', native: '中文' },
];

const BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]));

export function findLanguage(code: string): Language | undefined {
  return code === 'auto' ? AUTO_DETECT : BY_CODE.get(code);
}

/** Short uppercase label for the language pill, e.g. "JA → EN". */
export function shortCode(code: string): string {
  return code === 'auto' ? 'AUTO' : code.toUpperCase();
}

export function languageName(code: string): string {
  return findLanguage(code)?.name ?? code;
}
