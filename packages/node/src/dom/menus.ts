import type { PageLike } from "../types.js";
import { normalizeLabel, normalizeWhitespace } from "./visible-text.js";

export type MenuItem = {
  label: string;
  normalized: string;
  role?: string;
  checked?: boolean;
  expanded?: boolean;
  hasPopup?: boolean;
  testId?: string;
  ariaLabel?: string;
};

export function extractMenuItemsFromText(text: string): MenuItem[] {
  return text
    .split(/\n| {2,}| • /)
    .map(label => normalizeWhitespace(label))
    .filter(Boolean)
    .map(label => ({ label, normalized: normalizeLabel(label) }));
}

export async function enumerateVisibleMenuItems(page: PageLike): Promise<MenuItem[]> {
  if (typeof page.evaluate === "function") {
    const labels = await page.evaluate(() => {
      const toItem = (node: Element) => {
        const element = node as HTMLElement;
        const label = (element.innerText ?? element.textContent ?? "").replace(/\s+/g, " ").trim();
        const item: {
          label: string;
          role?: string;
          checked?: boolean;
          expanded?: boolean;
          hasPopup?: boolean;
          testId?: string;
          ariaLabel?: string;
        } = { label };
        const role = element.getAttribute("role");
        if (role !== null) item.role = role;
        const checked = element.getAttribute("aria-checked");
        if (checked === "true") item.checked = true;
        if (checked === "false") item.checked = false;
        const expanded = element.getAttribute("aria-expanded");
        if (expanded === "true") item.expanded = true;
        if (expanded === "false") item.expanded = false;
        if (element.getAttribute("aria-haspopup") === "menu") item.hasPopup = true;
        const testId = element.getAttribute("data-testid");
        if (testId !== null) item.testId = testId;
        const ariaLabel = element.getAttribute("aria-label");
        if (ariaLabel !== null) item.ariaLabel = ariaLabel;
        return item;
      };
      const roleItems = Array.from(document.querySelectorAll("[role='menuitem'], [role='menuitemradio'], [role='option']"))
        .map(toItem)
        .filter(item => item.label.length > 0);

      if (roleItems.length > 0) {
        return { items: roleItems, labels: [], split: false };
      }

      const menus = Array.from(document.querySelectorAll("[role='menu'], [role='listbox'], [data-radix-popper-content-wrapper]"))
        .map(node => (node as HTMLElement).innerText ?? node.textContent ?? "")
        .filter(Boolean);

      return { items: [], labels: menus, split: true };
    });

    return labels.split
      ? labels.labels.flatMap(label => extractMenuItemsFromText(label))
      : labels.items
        .map(item => ({ ...item, label: normalizeWhitespace(item.label), normalized: normalizeLabel(item.label) }))
        .filter(item => item.label.length > 0);
  }

  return [];
}

export function findUniqueMenuItem(items: MenuItem[], wanted: string): MenuItem | undefined {
  const normalized = normalizeLabel(wanted);
  const exact = items.filter(item => item.normalized === normalized);
  if (exact.length === 1) {
    return exact[0];
  }

  const fuzzy = items.filter(item => visibleLabelMatches(item.normalized, normalized));
  return fuzzy.length === 1 ? fuzzy[0] : undefined;
}

export function visibleLabelMatches(label: string, wanted: string): boolean {
  if (wanted.length <= 3) {
    return new RegExp(`(^|[^a-z0-9])${escapeRegExp(wanted)}([^a-z0-9]|$)`, "i").test(label);
  }
  return label.includes(wanted);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
