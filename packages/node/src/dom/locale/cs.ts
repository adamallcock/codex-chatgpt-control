import type { LocaleContribution } from "./types.js";

/**
 * Czech (cs-CZ). Captured 2026-06-09 against a live chatgpt.com session
 * (html lang=cs-CZ, Google Translate confirmed off).
 *
 * Some non-Intelligence surfaces may still fall back to English + `selector_drift`.
 *
 * Intelligence picker labels updated 2026-06-10, stop-control labels updated 2026-06-15, Chat/Work surface labels updated 2026-07-17, and Power/Advanced selector labels updated 2026-08-08 from visible ChatGPT sessions.
 *
 * Simplified Power/Advanced selector labels refreshed 2026-09-20 from a visible 64-locale ChatGPT sweep.
 */
export const cs = {
  configurationAxes: {
    power: ["Výkon"],
    model: ["Vyberte model"],
    effort: ["Úsilí", "Míra úsilí", "Výkon"],
    speed: ["Rychlost"],
    advanced: ["Pokročilé"],
  },
  configurationOptions: {
    instant: ["Okamžitá", "Instantní"],
    light: ["Nízká"],
    medium: ["Střední"],
    high: ["Vysoká"],
    extraHigh: ["Velmi vysoká"],
    max: ["Maximální"],
    standard: ["Standardní"],
    fast: ["Rychlé"],
  },
  composerTextbox: ["Chatovat s ChatGPT"],
  sendButton: ["Odeslat výzvu"],
  searchChatsButton: ["Hledat chaty"],
  searchChatsPlaceholder: ["Hledat chaty…"],
  newChat: ["Nový chat"],
  addFilesButton: ["Přidávání souborů a další"],
  addFilesOpenerCandidates: ["Přidávání souborů a další"],
  addPhotosFilesMenuItem: ["Přidat fotografie a soubory"],
  copyResponse: ["Zkopírovat odpověď"],
  modeLabels: ["Okamžitá", "Střední", "Vysoká", "Velmi vysoká", "Instantní"],
  modeOptions: {
    instant: ["Okamžitá", "Instantní"],
    medium: ["Střední"],
    high: ["Vysoká"],
    extraHigh: ["Velmi vysoká"],
  },
  modeOpenerExtra: ["Konfigurovat…"],
  tools: {
    web_search: ["Vyhledávání na webu"],
    deep_research: ["Hloubkový výzkum"],
    create_image: ["Vytvoř obrázek"],
  },
  signedInMarkers: ["Nový chat", "Hledat chaty", "Nedávné", "Historie chatu", "Projekty", "Chatovat s ChatGPT"],
  responseActions: ["Zkopírovat odpověď"],
  stopControl: ["Zastavit odpovídání"],
} satisfies LocaleContribution;
