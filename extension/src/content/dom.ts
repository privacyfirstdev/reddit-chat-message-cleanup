import { isStopped } from "./state";

export type QueryRoot = Document | ShadowRoot | Element;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls fn until it returns a truthy value, the timeout passes, or a stop is requested. */
export async function waitFor<T>(
  fn: () => T | null | undefined | false,
  timeoutMs: number,
  intervalMs = 100,
): Promise<T | null> {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    if (isStopped()) {
      return null;
    }

    try {
      const value = fn();

      if (value) {
        return value;
      }
    } catch {
      // Keep polling.
    }

    await sleep(intervalMs);
  }

  return null;
}

/** Walks the root and every open shadow root beneath it. */
export function* deepNodes(
  root: QueryRoot | null = document,
): Generator<QueryRoot> {
  if (!root) {
    return;
  }

  yield root;

  if (root instanceof Element && root.shadowRoot) {
    yield* deepNodes(root.shadowRoot);
  }

  const scope = root as ParentNode;

  for (const element of scope.querySelectorAll("*")) {
    if (element.shadowRoot) {
      yield* deepNodes(element.shadowRoot);
    }
  }
}

export function deepQueryAll<T extends Element = Element>(
  selector: string,
  root: QueryRoot = document,
): T[] {
  const found: T[] = [];

  for (const node of deepNodes(root)) {
    try {
      found.push(
        ...(Array.from(
          (node as ParentNode).querySelectorAll(selector),
        ) as T[]),
      );
    } catch {
      // Unsupported selector for this root. Skip it.
    }
  }

  return [...new Set(found)];
}

export function localQuery<T extends Element = Element>(
  root: Element | null,
  selector: string,
): T | null {
  if (!root) {
    return null;
  }

  for (const node of deepNodes(root)) {
    try {
      const found = (node as ParentNode).querySelector<T>(selector);

      if (found) {
        return found;
      }
    } catch {
      // Unsupported selector for this root. Skip it.
    }
  }

  return null;
}

export function isVisible(element: Element | null): boolean {
  if (!element || !element.isConnected) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);

  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    style.opacity !== "0"
  );
}

/** Parent that also crosses out of a shadow root to its host. */
export function parentAcrossShadow(node: Node | null): Element | null {
  if (!node) {
    return null;
  }

  const parent = node.parentNode;

  if (parent instanceof ShadowRoot) {
    return parent.host;
  }

  return node.parentElement;
}

export function hasAncestorTag(
  element: Element | null,
  tagName: string,
): boolean {
  const target = tagName.toUpperCase();
  let current: Element | null = element;

  while (current) {
    if (current.tagName === target) {
      return true;
    }

    current = parentAcrossShadow(current);
  }

  return false;
}

export function deepText(element: Element | null): string {
  if (!element) {
    return "";
  }

  const htmlText = (element as HTMLElement).innerText ?? "";

  return [
    element.getAttribute("aria-label") || "",
    element.getAttribute("title") || "",
    element.getAttribute("icon") || "",
    element.getAttribute("data-testid") || "",
    htmlText,
    element.textContent || "",
    element.shadowRoot?.textContent || "",
  ]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Nearest scrollable ancestor, starting at container. Falls back to the container itself. */
export function getScrollable(container: Element | null): Element | null {
  let current: Element | null = container;

  for (let i = 0; i < 18 && current; i += 1) {
    if (
      current.isConnected &&
      /(auto|scroll)/.test(getComputedStyle(current).overflowY) &&
      current.scrollHeight > current.clientHeight + 2
    ) {
      return current;
    }

    current = parentAcrossShadow(current);
  }

  return container ?? document.scrollingElement;
}

/** The scrollable element with the most scroll range inside a message container. */
export function getMessageScrollable(
  container: Element | null,
): Element | null {
  if (!container) {
    return null;
  }

  const candidates = [
    container,
    ...deepQueryAll("*", container),
  ].filter((element) => {
    if (!isVisible(element)) {
      return false;
    }

    return (
      element.scrollHeight > element.clientHeight + 2 &&
      /(auto|scroll)/.test(getComputedStyle(element).overflowY)
    );
  });

  candidates.sort(
    (a, b) =>
      b.scrollHeight - b.clientHeight - (a.scrollHeight - a.clientHeight),
  );

  return candidates[0] || getScrollable(container);
}
