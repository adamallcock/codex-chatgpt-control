/**
 * Browser-serialized, bounded reader for the text inserted into a composer.
 * Keep this self-contained: the Chrome bridge transfers the function, not its
 * module. Contenteditable paragraph boundaries are part of the prompt.
 */
export function inspectComposerText(element: Element): string | undefined {
  const maximum = 8 * 1024 * 1024;
  const candidate = element as HTMLElement & { value?: unknown };
  const tag = typeof candidate.tagName === "string" ? candidate.tagName.toLowerCase() : "";
  if (tag === "input" || tag === "textarea" || tag === "select") {
    const value = candidate.value;
    return typeof value === "string" && value.length <= maximum ? value : undefined;
  }
  const chunks: string[] = [];
  let total = 0;
  let visited = 0;
  let lastCharacter = "";
  const append = (text: string): void => {
    total += text.length;
    if (total > maximum) throw new Error("composer text limit exceeded");
    if (text.length > 0) {
      chunks.push(text);
      lastCharacter = text.slice(-1);
    }
  };
  const walk = (node: Node, depth: number): void => {
    visited += 1;
    if (visited > 4096 || depth > 128) throw new Error("composer node limit exceeded");
    if (node.nodeType === 3) {
      append(node.nodeValue ?? "");
      return;
    }
    const current = node as Element;
    const currentTag = typeof current.tagName === "string" ? current.tagName.toUpperCase() : "";
    if (currentTag === "BR") {
      const classes = (current.getAttribute("class") ?? "").split(/\s+/u);
      // ProseMirror adds a caret placeholder after a real trailing hard break.
      const soleChild = node.parentNode?.firstChild === node && node.nextSibling === null;
      if (!classes.includes("ProseMirror-trailingBreak") && !soleChild) append("\n");
      return;
    }
    let previousBlock = false;
    let previousEmptyBlock = false;
    let hasPrevious = false;
    let child: Node | null = node.firstChild;
    while (child !== null) {
      const childTag = child.nodeType === 1 ? (child as Element).tagName.toUpperCase() : "";
      const block = childTag === "P" || childTag === "DIV" || childTag === "LI";
      const boundary = hasPrevious && (block || previousBlock)
        && (lastCharacter !== "\n" || previousEmptyBlock);
      // Reserve a position before walking the child. Empty inline nodes have
      // no rendered text and must not create a paragraph boundary.
      const boundaryIndex = chunks.length;
      if (boundary) chunks.push("");
      const before = total;
      walk(child, depth + 1);
      const emitted = total > before;
      if (emitted || block) {
        if (boundary) {
          chunks[boundaryIndex] = "\n";
          total += 1;
          if (total > maximum) throw new Error("composer text limit exceeded");
          if (!emitted) lastCharacter = "\n";
        }
        hasPrevious = true;
        previousBlock = block;
        previousEmptyBlock = block && !emitted;
      }
      child = child.nextSibling;
    }
  };
  try {
    walk(candidate, 0);
    return chunks.join("");
  } catch {
    return undefined;
  }
}
