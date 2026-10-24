// Small settings remembered between visits, in localStorage. Storage can be
// unavailable (private mode, blocked site data), so a setting that can't be
// read comes back as null and one that can't be saved just isn't remembered.

export function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: the setting just won't be remembered.
  }
}

// A saved choice, if it's still one of `choices`.
export function readChoice<T extends string>(key: string, choices: readonly T[]): T | undefined {
  const value = readPref(key);
  return choices.find((choice) => choice === value);
}
