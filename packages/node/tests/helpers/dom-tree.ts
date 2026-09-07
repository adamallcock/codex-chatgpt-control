/** Small linked DOM used to execute browser callbacks without mocked results. */
export class DomNode {
  readonly nodeType: number;
  readonly tagName: string;
  readonly nodeValue: string | null;
  readonly attributes: Record<string, string>;
  parentNode: DomNode | null = null;
  firstChild: DomNode | null = null;
  nextSibling: DomNode | null = null;
  style = { display: "block", visibility: "visible", opacity: "1" };
  value: unknown;
  files: unknown;
  disabled = false;
  rect = { width: 100, height: 20 };

  constructor(tag: string, attributes: Record<string, string> = {}, children: readonly (DomNode | string)[] = []) {
    this.nodeType = tag === "#text" ? 3 : tag === "#document" ? 9 : 1;
    this.tagName = this.nodeType === 1 ? tag.toUpperCase() : "";
    this.nodeValue = tag === "#text" ? attributes.text ?? "" : null;
    this.attributes = this.nodeType === 1 ? attributes : {};
    this.append(...children);
  }

  append(...children: readonly (DomNode | string)[]): this {
    let previous = this.firstChild;
    while (previous?.nextSibling) previous = previous.nextSibling;
    for (const child of children) {
      const node = typeof child === "string" ? new DomNode("#text", { text: child }) : child;
      node.parentNode = this;
      if (previous === null) this.firstChild = node;
      else previous.nextSibling = node;
      previous = node;
    }
    return this;
  }

  getAttribute(name: string): string | null { return this.attributes[name] ?? null; }
  hasAttribute(name: string): boolean { return this.getAttribute(name) !== null; }
  getBoundingClientRect(): { width: number; height: number } { return this.rect; }
  get id(): string { return this.getAttribute("id") ?? ""; }

  /** Tests can provide exact scoped selector results; callback traversal stays real. */
  querySelectorAll: (selector: string) => DomNode[] = () => {
    throw new Error("This fixture does not allow an unconfigured selector query");
  };
}

export function element(tag: string, attributes: Record<string, string> = {}, ...children: readonly (DomNode | string)[]): DomNode {
  return new DomNode(tag, attributes, children);
}
