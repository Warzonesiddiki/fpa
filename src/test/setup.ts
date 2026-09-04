import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import "@/i18n"; // initialize i18next for all component tests (single-UI locale en, A2)

afterEach(() => cleanup());

const storageMap = new Map<string, string>();

Storage.prototype.getItem = function (key: string): string | null {
  return storageMap.has(key) ? storageMap.get(key)! : null;
};
Storage.prototype.setItem = function (key: string, value: string): void {
  storageMap.set(key, String(value));
};
Storage.prototype.removeItem = function (key: string): void {
  storageMap.delete(key);
};
Storage.prototype.clear = function (): void {
  storageMap.clear();
};
Storage.prototype.key = function (index: number): string | null {
  return Array.from(storageMap.keys())[index] ?? null;
};
Object.defineProperty(Storage.prototype, "length", {
  get() {
    return storageMap.size;
  },
  configurable: true,
});

const storageInstance = Object.create(Storage.prototype) as Storage;

if (typeof window !== "undefined") {
  Object.defineProperty(window, "localStorage", {
    value: storageInstance,
    configurable: true,
    writable: true,
  });
}
Object.defineProperty(globalThis, "localStorage", {
  value: storageInstance,
  configurable: true,
  writable: true,
});
beforeEach(() => {
  // Mock the browser precognition API jsdom lacks (used by some styling libs).
  window.matchMedia =
    window.matchMedia ??
    ((query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) as unknown as MediaQueryList);
});
