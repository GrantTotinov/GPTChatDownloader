/*
 * ---------------------------------------------------------
 * SHARED SETTINGS TYPES
 * ---------------------------------------------------------
 *
 * Used by both popup.ts (reads settings when building the
 * export) and options.ts (reads/writes settings from the
 * options page). Keeping this in one file means the two
 * can't drift out of sync with different defaults or
 * option values.
 */
export interface Settings {
  includeTimestamp: boolean;
  headingStyle: "h2" | "bold" | "none";
  messageSeparator: "single" | "double" | "rule";
  /*
   * When true, chrome.downloads.download() is called with
   * saveAs: true, which opens the browser's native "Save As"
   * dialog on every export instead of silently dropping the
   * file into the default Downloads folder. This lets people
   * choose a different folder each time (e.g. a Dropbox/
   * OneDrive sync folder) - identical behavior in Chrome and
   * Firefox, since chrome.downloads.download's saveAs option
   * is part of the shared WebExtensions API surface both
   * browsers implement the same way.
   */
  askWhereToSave: boolean;
  theme: "system" | "light" | "dark";
}

export const DEFAULT_SETTINGS: Settings = {
  includeTimestamp: false,
  headingStyle: "h2",
  messageSeparator: "double",
  askWhereToSave: true,
  theme: "system",
};

export const SEPARATOR_TEXT: Record<Settings["messageSeparator"], string> = {
  single: "\n",
  double: "\n\n",
  rule: "\n\n---\n\n",
};

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.sync.get({
    ...DEFAULT_SETTINGS,
  } as Record<string, unknown>);

  return stored as unknown as Settings;
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.sync.set(settings);
}
