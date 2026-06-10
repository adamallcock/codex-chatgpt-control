/**
 * Centralized, locale-sensitive ChatGPT UI strings — barrel re-export.
 *
 * Every entry is an ORDERED list of candidate strings. English is canonical and MUST
 * stay first: it is also the public API contract for mode/tool selection (callers pass
 * `effort: "Thinking"`, `tool: "web_search"`, etc.). Matchers iterate the whole list,
 * so localizing the SDK is just appending verified strings to these arrays — no selector
 * or command code needs to change.
 *
 * RULES
 * - Do NOT add unverified translations. A locale string is only valid once it has been
 *   observed in a real localized ChatGPT session. Guesses are worse than nothing because
 *   they mask the `selector_drift` blocker that is the designed recovery path.
 * - Keys are stable logical ids. The localized display text goes in the array; the key
 *   never changes.
 * - These are the visible/accessible-name surfaces only. Structural anchors (roles,
 *   element ids like `#composer-plus-btn`, `a[href^='/c/']`, `data-message-author-role`)
 *   are language-agnostic and live in the selectors directly.
 *
 * Structural-only blocker patterns stay literal in `safety/blockers.ts` on purpose:
 * numeric/HTTP codes (`404`), our own bridge error fragments (`fileChooser.setFiles`,
 * `permission denied`), and the modal heuristic are not ChatGPT-localized UI text.
 *
 * To add a new language, see `src/dom/locale/index.ts`.
 */
export { localeLabels, anyLabelPattern, escapeRegExp } from "./locale/index.js";
