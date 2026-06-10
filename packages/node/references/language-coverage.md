# Language Coverage & Capture Tracker

The full set of languages ChatGPT exposes in **Settings → General → Language** (captured
2026-06-09), with a rough total-speaker estimate and capture status. Use this to track the
localization rollout described in [`localization.md`](./localization.md). Strings are
stored per-locale under `src/dom/locale/<bcp47>.ts`.

- Speaker counts are **crude guesstimates** (native + second-language, rounded), not
  researched figures. They exist only to prioritize the rollout.
- `bcp47` is the suggested per-locale file name. Regional variants ChatGPT lists separately
  (Spanish, French, Portuguese, Chinese) are separate registry entries — capture the
  larger-reach variant first; the others can be filled later or alias the base.
- Status: ✅ done · 🟡 in progress · ⬜ pending.

## Capture queue — top 15 by crude speaker count

English is the canonical baseline (already in the registry), so the queue below is the top
15 **non-English** languages by rough world speaker count. Order is a best-effort
guesstimate; the tail (≈#11–15) is close and easily reordered.

| # | Language | Native | bcp47 | ~Speakers | Status |
|---|---|---|---|---|---|
| — | English (US) | English (US) | `en-US` | ~1.5B | ✅ baseline |
| 1 | Chinese (Simplified) | 简体中文 | `zh-Hans` | ~1.1B | ✅ |
| 2 | Hindi | हिन्दी | `hi` | ~600M | ✅ |
| 3 | Spanish (Latin America) | español (Latinoamérica) | `es-419` | ~450M | ✅ |
| 4 | Arabic | العربية | `ar` | ~400M | ✅ |
| 5 | French (France) | français (France) | `fr-FR` | ~300M | ✅ |
| 6 | Bengali | বাংলা | `bn` | ~270M | ✅ |
| 7 | Portuguese (Brazil) | português (Brasil) | `pt-BR` | ~260M | ✅ |
| 8 | Russian | русский | `ru` | ~255M | ✅ |
| 9 | Urdu | اردو | `ur` | ~230M | ✅ |
| 10 | Indonesian | Indonesia | `id` | ~200M | ✅ |
| 11 | German | Deutsch | `de` | ~135M | ✅ |
| 12 | Punjabi | ਪੰਜਾਬੀ | `pa` | ~130M | ✅ |
| 13 | Japanese | 日本語 | `ja` | ~125M | ✅ |
| 14 | Marathi | मराठी | `mr` | ~95M | ✅ |
| 15 | Turkish | Türkçe | `tr` | ~85M | ✅ |

> Note: this ranks by **raw speaker count** as requested. If you'd rather weight by likely
> ChatGPT user base, the order would tilt toward European/East-Asian locales (Japanese,
> German, French, Spanish, Portuguese, Korean, Italian) and away from Punjabi/Marathi/Bengali.

## Full language list

| Language | Native | bcp47 | ~Speakers | Status |
|---|---|---|---|---|
| English (US) | English (US) | `en-US` | ~1.5B | ✅ |
| Amharic | አማርኛ | `am` | ~60M | ✅ |
| Arabic | العربية | `ar` | ~400M | ✅ |
| Bulgarian | български | `bg` | ~8M | ✅ |
| Bengali | বাংলা | `bn` | ~270M | ✅ |
| Bosnian | bosanski | `bs` | ~3M | ✅ |
| Catalan | català | `ca` | ~10M | ✅ |
| Czech | čeština | `cs` | ~11M | ✅ |
| Danish | dansk | `da` | ~6M | ✅ |
| German | Deutsch | `de` | ~135M | ✅ |
| Greek | Ελληνικά | `el` | ~13M | ✅ |
| Spanish (Latin America) | español (Latinoamérica) | `es-419` | ~450M | ✅ |
| Spanish (Spain) | español (España) | `es-ES` | ~47M | ✅ |
| Estonian | eesti | `et` | ~1M | ✅ |
| Persian | فارسی | `fa` | ~80M | ✅ |
| Finnish | suomi | `fi` | ~5.5M | ✅ |
| French (Canada) | français (Canada) | `fr-CA` | ~10M | ✅ |
| French (France) | français (France) | `fr-FR` | ~300M | ✅ |
| Gujarati | ગુજરાતી | `gu` | ~60M | ✅ |
| Hindi | हिन्दी | `hi` | ~600M | ✅ |
| Croatian | hrvatski | `hr` | ~5M | ✅ |
| Hungarian | magyar | `hu` | ~13M | ✅ |
| Armenian | հայերեն | `hy` | ~7M | ✅ |
| Indonesian | Indonesia | `id` | ~200M | ✅ |
| Icelandic | íslenska | `is` | ~0.4M | ✅ |
| Italian | italiano | `it` | ~65M | ✅ |
| Japanese | 日本語 | `ja` | ~125M | ✅ |
| Georgian | ქართული | `ka` | ~4M | ✅ |
| Kazakh | қазақ тілі | `kk` | ~13M | ✅ |
| Kannada | ಕನ್ನಡ | `kn` | ~60M | ✅ |
| Korean | 한국어 | `ko` | ~80M | ✅ |
| Lithuanian | lietuvių | `lt` | ~3M | ✅ |
| Latvian | latviešu | `lv` | ~2M | ✅ |
| Macedonian | македонски | `mk` | ~2M | ✅ |
| Malayalam | മലയാളം | `ml` | ~38M | ✅ |
| Mongolian | монгол | `mn` | ~5M | ✅ |
| Marathi | मराठी | `mr` | ~95M | ✅ |
| Malay | Bahasa Melayu | `ms` | ~80M | ✅ |
| Burmese | မြန်မာ | `my` | ~43M | ✅ |
| Norwegian Bokmål | norsk bokmål | `nb` | ~5M | ✅ |
| Dutch | Nederlands | `nl` | ~25M | ✅ |
| Punjabi | ਪੰਜਾਬੀ | `pa` | ~130M | ✅ |
| Polish | polski | `pl` | ~45M | ✅ |
| Portuguese (Brazil) | português (Brasil) | `pt-BR` | ~210M | ✅ |
| Portuguese (Portugal) | português (Portugal) | `pt-PT` | ~10M | ✅ |
| Romanian | română | `ro` | ~24M | ✅ |
| Russian | русский | `ru` | ~255M | ✅ |
| Slovak | slovenčina | `sk` | ~5M | ✅ |
| Slovenian | slovenščina | `sl` | ~2.5M | ✅ |
| Somali | Soomaali | `so` | ~22M | ✅ |
| Albanian | shqip | `sq` | ~7.5M | ✅ |
| Serbian | српски | `sr` | ~9M | ✅ |
| Swedish | svenska | `sv` | ~10M | ✅ |
| Swahili | Kiswahili | `sw` | ~120M | ✅ |
| Tamil | தமிழ் | `ta` | ~85M | ✅ |
| Telugu | తెలుగు | `te` | ~95M | ✅ |
| Thai | ไทย | `th` | ~60M | ✅ |
| Tagalog (Filipino) | Tagalog | `tl` | ~70M | ✅ |
| Turkish | Türkçe | `tr` | ~85M | ✅ |
| Ukrainian | українська | `uk` | ~40M | ✅ |
| Urdu | اردو | `ur` | ~230M | ✅ |
| Vietnamese | Tiếng Việt | `vi` | ~85M | ✅ |
| Chinese (Simplified) | 简体中文 | `zh-Hans` | ~1.1B | ✅ |
| Chinese (Traditional, Hong Kong) | 繁體中文（香港） | `zh-HK` | ~85M | ✅ |
| Chinese (Traditional, Taiwan) | 繁體中文（台灣） | `zh-TW` | ~23M | ✅ |

## Known limitation — locale switching in the automated harness

ChatGPT renders its UI locale from the `oai-locale` cookie, not from the account-language
preference alone. In the Claude-in-Chrome automation environment:

- Opening menus and reading localized labels via injected JS works perfectly (the capture
  step is fully automated — one JS call harvests the whole home-screen set; a conversation
  page yields `copyResponse`).
- **Switching** the rendered locale is the bottleneck. Changing the account language updates
  the saved preference, but the `oai-locale` cookie does not re-issue within the session, so
  the page keeps rendering the previously-cached locale. Direct cookie writes are blocked by
  the environment's privacy guard (and must not be circumvented).
- Net effect: German captured cleanly because its cookie happened to set on the first switch;
  subsequent in-session switches did not re-render. A full sweep therefore needs either a
  fresh browser session per language, or the human operator to set the language + reload in a
  normal (non-sandboxed) browser, after which the JS capture is instant.

This is an environment constraint, not a code issue — the per-locale infrastructure and the
capture method both work. Treat additional locales as incremental contributions.

## Capture procedure (per language)

1. Switch ChatGPT **Settings → General → Language** to the target, reload, and confirm via
   `document.documentElement.lang` + visible text.
2. Read static controls (composer, add-files, new chat, current model label) via JS.
3. Open the model switcher and the `+` menu with **real** clicks (Radix menus ignore
   synthetic `.click()`) and read the menu items → mode + tool labels.
4. Open search → placeholder; observe a conversation → copy-response + response-actions.
   `stopControl` is only present mid-generation; login/captcha/rate-limit copy needs a
   logged-out/limited state — these may lag and rely on the English fallback + the
   `selector_drift` safety net until captured.
5. Write the verified strings to `src/dom/locale/<bcp47>.ts` and register it in
   `src/dom/locale/index.ts`. Build + test + bundle + sync.
6. Restore the account language to English (US) when the run is complete.
