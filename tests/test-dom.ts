import type { DOMWindow } from "jsdom";

export interface TestElement extends HTMLElement {
  value: string;
  disabled: boolean;
  readonly labels: NodeListOf<HTMLLabelElement>;
  readonly options: HTMLOptionsCollection;
  readonly href: string;
  open: boolean;
  selectionStart: number | null;
  selectionEnd: number | null;
  readonly firstChild: ChildNode;
  click(): void;
  focus(options?: FocusOptions): void;
  select(): void;
  setSelectionRange(start: number | null, end: number | null, direction?: "forward" | "backward" | "none"): void;
  closest(selectors: string): TestElement;
  querySelector(selectors: string): TestElement;
  querySelectorAll(selectors: string): NodeListOf<TestElement>;
}

export function q(selector: string, parent: ParentNode = document): TestElement {
  return parent.querySelector(selector) as TestElement;
}

export function qa(selector: string, parent: ParentNode = document): NodeListOf<TestElement> {
  return parent.querySelectorAll(selector) as NodeListOf<TestElement>;
}

export function installDomWindow(window: DOMWindow): void {
  globalThis.window = window as unknown as Window & typeof globalThis;
  globalThis.document = window.document;
  globalThis.CSS = window.CSS;
}
