# Localization & Language Detection — Operator Guide

ChatGPT renders most of its interactive controls with **localized text** (button
`aria-label`s, menu items, placeholders, and login/rate-limit copy). The browser-control
runtime matches several of those by their visible/accessible name, so a non-English
ChatGPT session can cause selectors to miss. This guide explains how the SDK isolates
that risk, how to add a new language, and how to keep it working as ChatGPT's UI changes.

This is an **operator/maintainer** document. You do not need to read any TypeScript to add
a language — you edit one data file.

## TL;DR

1. Every locale-sensitive string lives under
   [`src/dom/locale/`](../src/dom/locale/):
   - `en.ts` — the complete English (canonical) values.
   - `<bcp47>.ts` — one file per additional language (partial — only keys that differ).
   - `index.ts` — the combiner; register new locale files here.
   - `types.ts` — the `LocaleStrings` / `LocaleContribution` type definitions.
   - [`src/dom/locale-labels.ts`](../src/dom/locale-labels.ts) is a thin barrel that
     re-exports `localeLabels`, `anyLabelPattern`, and `escapeRegExp` — **consumer import
     paths do not change**.
2. Each entry is an **ordered candidate list**. English is canonical and stays first.
   Stage 2 verifies the registry shape with `doctor({ check: ["localization"] })`;
   selector consumers are still being wired to consume every localized candidate.
3. **Never add a string you have not observed in a real localized session.** The
   `selector_drift` blocker is the safety net *and* the discovery tool — it reports the
   localized labels it actually saw.
4. After editing, rebuild + test + bundle + sync (see [Verification](#verification)).

## Design

```
ChatGPT DOM (localized) ─▶ matcher being localized ─▶ locale/index.ts candidates
                                                │
                                       no candidate matches
                                                ▼
                                       selector_drift blocker
                                       (returns the labels it DID see)
```

The registry is designed for three match styles. Some runtime consumers still hard-code
English labels; until those consumers are rewired, the localization doctor check is a
registry-readiness diagnostic rather than proof that a localized session will pass every
workflow selector.

| Style | Where | How a candidate is matched |
|---|---|---|
| Accessible-name RegExp | Playwright `getByRole`/`getByPlaceholder` | `anyLabelPattern()` builds a case-insensitive substring alternation |
| CSS attribute clause | download controls | one `aria-label*=`/`=` clause generated per candidate |
| Browser-context / Node text | streaming + blocker heuristics | candidates passed in and matched with whole-word or substring regex |

Two rules that never change regardless of language:

- **API keys stay English.** Callers pass `experience: "work"`,
  `model: "GPT-5.6 Sol"`, `intelligence: "Pro"`, `effort: "High"`,
  `speed: "Standard"`, or `tool: "web_search"`. Only the *matched DOM text* is localized. You add the
  German label to the registry array; the caller-facing key is untouched.
- **Structural anchors are language-agnostic and are not in this file.** Element ids
  (`#composer-plus-btn`, `#upload-files`), `data-message-author-role`,
  `data-testid^='conversation-turn'`, `a[href^='/c/']`, `a[download]`, and
  `href*='/backend-api/files/'` work in every locale and stay in the selectors directly.

## What is localized (and what is deliberately not)

Localized — lives in `src/dom/locale/en.ts` (English) and per-locale files, safe to extend:

| Registry key | Surface | Capture from |
|---|---|---|
| `composerTextbox` | composer textbox | `aria-label` |
| `workComposerTextbox` | Work composer textbox | `aria-label` / placeholder |
| `newWork` | start-another-Work-task control | visible button or link text |
| `experienceOptions.chat` / `.work` | Chat/Work switch controls | visible button, tab, link, or menu text |
| `configurationAxes.*` | model/intelligence/effort/speed/advanced rows | visible row text |
| `configurationOptions.*` | Chat and Work configuration values | visible menu text |
| `sendButton` | send button | `aria-label` |
| `searchChatsButton` | search-chats button | `aria-label` |
| `searchChatsPlaceholder` | search input | `placeholder` (mind the ellipsis — see caveats) |
| `newChat` | new-chat button | `aria-label` |
| `addFilesButton` / `addFilesOpenerCandidates` | add-files opener | `aria-label` |
| `addPhotosFilesMenuItem` | "Add photos & files" menu item | visible menu text |
| `projectSourcesTab` / `projectSourcesAddSource` / `projectSourcesUploadFiles` | Project Sources tab and append-add flow | visible tab/button/menu text |
| `copyResponse` | copy-response button | `aria-label` |
| `download` / `downloadImage` / `imageContainerHint` | download affordances | `aria-label` / container hint |
| `modeLabels` / `modeOpenerExtra` | model/effort switcher recognition and openers | visible button + menu text |
| `modeOptions.<semantic-id>` | selectable model/intelligence mode options | visible picker rows, keyed by stable ids such as `high`, `extraHigh`, and `pro` |
| `tools.web_search` / `tools.deep_research` / `tools.create_image` | tool menu items | visible menu text |
| `signedInMarkers` | signed-in detection | sidebar/shell words |
| `transientAssistant` | streaming placeholder filter | assistant streaming text ("Thinking", etc.) |
| `stopControl` | "still generating" detection | stop-button text |
| `stoppedAssistant` | interrupted-response detection | stopped assistant text ("Stopped thinking", etc.) |
| `responseActions` | response-complete fallback | action-bar text |
| `loginBlocker` / `captchaBlocker` / `rateLimitBlocker` | blocker classification | wall/challenge/limit copy |

**Do NOT localize these** — they are not ChatGPT-localized UI text:

- Structural anchors listed above (ids, `data-*`, hrefs).
- Blocker patterns that are HTTP/numeric codes (`404`), our own bridge-error fragments
  (`fileChooser.setFiles`, `permission denied`, `upload failed`), or the modal heuristic —
  these stay literal in [`src/safety/blockers.ts`](../src/safety/blockers.ts).
- The image-status regex variants in `isTransientAssistantText`
  (`analyzing/processing/reading images`) are still English-inline; only the exact-match
  `transientAssistant` phrases are registry-driven. Localize these only if a real session
  shows a localized equivalent.

The type definitions for `LocaleStrings` (complete) and `LocaleContribution` (partial, for
non-English files) live in [`src/dom/locale/types.ts`](../src/dom/locale/types.ts).

The first Chat/Work profile fixtures are English evidence. The nested locale
combiner lets existing locale files omit the new groups without breaking
compilation, but that is not proof that Work configuration is localized in
those languages. Add observed labels and a sanitized surface-profile fixture
before claiming support for a new locale/profile combination.

Create a read-only draft from an already-open authorized ChatGPT tab:

```bash
npm run capture:surface-profile -- \
  --id work-basic-de \
  --locale de-DE
```

The command defaults region, plan, account, and workspace metadata to
`not-recorded`, defaults support state to `unverified`, strips conversation
identifiers, and excludes prompt/response/sidebar text. Review the draft under
`outputs/surface-profiles/`, add only verified localized labels to the registry,
then move a sanitized fixture into `contracts/v1/fixtures/` and update the
manifest/parity matrix.

## Adding a new language

### Step 1 — put a real ChatGPT session into the target language

Set the account language (ChatGPT **Settings → General → Language**) or the locale ChatGPT
honors for your environment, and reload. Confirm the visible UI actually changed — some
surfaces remain English even when the account language is switched.

### Step 2 — discover the strings (preferred: let the SDK tell you)

Run the affected browser-control command against the localized session. When a text
matcher emits a structured `selector_drift` blocker, its `candidates` array contains the
**localized labels the SDK actually saw** — that is your source of truth, captured live:

```jsonc
{
  "ok": false,
  "status": "unsupported",
  "blocker": {
    "kind": "selector_drift",
    "code": "visible_candidate_not_found",
    "candidates": [{ "label": "<localized label to copy>" }, ...]
  }
}
```

Fallback for surfaces that don't emit candidates: open DevTools, inspect the control, and
read its `aria-label` (buttons) or visible text (menu items, mode labels). Copy the exact
characters.

### Step 3 — create the locale file and register it

Create a new file `src/dom/locale/<bcp47>.ts` (e.g. `de.ts` for German). It only needs to
include keys whose text differs from English — it `satisfies Partial<LocaleStrings>` (i.e.
`LocaleContribution`):

```ts
import type { LocaleContribution } from "./types.js";

export const de = {
  sendButton: ["Nachricht senden"],
  modeLabels: ["Sofort", "Mittel", "Hoch", "Extra hoch"],
  modeOptions: {
    instant: ["Sofort"],
    medium: ["Mittel"],
    high: ["Hoch"],
    extraHigh: ["Extra hoch"],
  },
  tools: {
    web_search: ["Websuche"],
  },
  // ... only the keys that are localized in a real German session
} satisfies LocaleContribution;
```

Leave the canonical English first (it comes from `en.ts`), and leave the API keys
(`web_search`, `modeOptions.pro`, `modeOptions.high`, and the other semantic ids)
unchanged.

Newer ChatGPT rollouts may expose `Medium`, `High`, `Extra High`, and `Pro`
under an `Intelligence` picker. Add localized equivalents only after observing
those exact labels in the target locale. Put broad picker/opening labels in
`modeLabels`, but put selectable labels under `modeOptions.<semantic-id>` so
short labels such as `Pro` cannot match unrelated rows like `Move to project`.

Then open [`src/dom/locale/index.ts`](../src/dom/locale/index.ts) and register the new
locale:

```ts
import { de } from "./de.js";
// ...
const locales: readonly (LocaleStrings | LocaleContribution)[] = [en, de] as const;
```

The combiner flattens all locales per key, English-first, deduplicating strings.

### Step 4 — rebuild, test, ship

See [Verification](#verification).

### Caveats when capturing strings

- **Punctuation is literal.** `searchChatsPlaceholder` is `"Search chats..."` with three
  ASCII dots; a localized build may use a real ellipsis `…` (U+2026). The matcher is
  case-insensitive but does **not** treat `...` and `…` as equal. Copy the exact glyphs.
- **Accents / non-ASCII are fine.** Regex special characters are escaped automatically.
- **Some controls won't localize.** If a label is still English in the localized session,
  the existing English entry already covers it — do not invent a translation.
- **One string can appear in several keys.** "Search chats" is both a button label and a
  signed-in marker; add the translation to each relevant array.
- **Project Sources labels are English-only until verified.** Do not translate the Sources
  tab, Add source button, or upload-files menu item from general language knowledge. Capture
  the actual localized Project UI first, then add only observed strings.

## Maintaining detection when ChatGPT changes its UI

Symptom: commands that used to work start returning `selector_drift` (text matchers) or a
wrong/empty read, on a locale that previously worked — usually because ChatGPT renamed a
control.

1. Reproduce against the affected session and read the `selector_drift` `candidates` (or
   inspect the control in DevTools).
2. Add the new string to the relevant array in `src/dom/locale/en.ts` (for English UI
   changes) or the appropriate `<bcp47>.ts` file (for a localized surface). Keep the old
   string — it may still be live for some users/builds.
3. Rebuild, test, ship.

Prune a string only when you are confident no current ChatGPT build still renders it;
extra candidates are cheap and harmless.

## Verification

Run from `packages/node`:

```bash
npm run build
npm test
npm run contract:validate
npm run parity:fixtures
```

To make the change live for Codex agents that load the installed skill bundle, also bundle
and sync (per `AGENTS.md`):

```bash
npm run bundle
npm run bundle:backend
npm run bundle:live-smoke
rsync -a --delete \
  --exclude node_modules \
  --exclude reports \
  --exclude .git \
  packages/node/ \
  ~/.codex/skills/codex-chatgpt-control/

# Confirm workspace and installed bundles match:
shasum -a 256 \
  dist/codex-chatgpt-control.bundle.mjs \
  ~/.codex/skills/codex-chatgpt-control/dist/codex-chatgpt-control.bundle.mjs
```

Notes:

- This is **TypeScript-internal** (DOM authority). Adding a locale needs no Python, wire,
  fixture, or protocol change, because API keys and wire shapes are unchanged.
- All consumer import paths (`from "../dom/locale-labels.js"`) are unchanged — the barrel
  `locale-labels.ts` re-exports everything from `locale/index.ts`.
- `doctor({ check: ["localization"] })` verifies that the registry is populated and
  canonical English values are present. It also reports running-state localization coverage
  separately from the flattened selector list, because `stopControl` and
  `stoppedAssistant` require a live mid-generation capture. It does not yet prove full
  localized selector coverage; treat localized workflow failures as selector-wiring work
  unless the registry is missing the observed labels.
- The public-export plugin bundles under `plugins/codex-chatgpt-control/runtime/node/` are
  produced by a separate pipeline (`tools/public-export/export-public.mjs`) and are not
  updated by the sync above.
