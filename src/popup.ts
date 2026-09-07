import { SEPARATOR_TEXT, loadSettings } from "./settings.ts";

import { stripMarkdown } from "./markdown-strip.ts";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  order: number;
}

const copyButton = document.getElementById("copy") as HTMLButtonElement;

const exportButton = document.getElementById("export") as HTMLButtonElement;

const exportMenu = document.getElementById("export-menu") as HTMLDivElement;

const exportMdButton = document.getElementById(
  "export-md",
) as HTMLButtonElement;

const exportTxtButton = document.getElementById(
  "export-txt",
) as HTMLButtonElement;

const githubToggleButton = document.getElementById(
  "github-toggle",
) as HTMLButtonElement;

const githubPanel = document.getElementById("github-panel") as HTMLDivElement;

const githubPanelMessage = document.getElementById(
  "github-panel-message",
) as HTMLParagraphElement;

const githubRepoSelect = document.getElementById(
  "github-repo-select",
) as HTMLSelectElement;

const githubPanelSaveButton = document.getElementById(
  "github-panel-save",
) as HTMLButtonElement;

const optionsLink = document.getElementById(
  "options-link",
) as HTMLAnchorElement;

const allButtons = [
  copyButton,
  exportButton,
  exportMdButton,
  exportTxtButton,
  githubToggleButton,
  githubPanelSaveButton,
];

optionsLink.addEventListener("click", (event) => {
  event.preventDefault();
  chrome.runtime.openOptionsPage();
});

/*
 * ---------------------------------------------------------
 * EXPORT MENU TOGGLE
 * ---------------------------------------------------------
 */
exportButton.addEventListener("click", () => {
  closeGithubPanel();
  exportMenu.classList.toggle("open");
});

document.addEventListener("click", (event) => {
  const target = event.target as Node;

  if (!exportButton.contains(target) && !exportMenu.contains(target)) {
    exportMenu.classList.remove("open");
  }
});

function closeExportMenu(): void {
  exportMenu.classList.remove("open");
}

/*
 * ---------------------------------------------------------
 * BUSY STATE
 * ---------------------------------------------------------
 */
function setBusy(button: HTMLButtonElement, text: string): void {
  for (const button of allButtons) {
    button.disabled = true;
  }

  button.textContent = text;
}

function resetButtons(): void {
  for (const button of allButtons) {
    button.disabled = false;
  }

  copyButton.textContent = "Copy Conversation";
  exportButton.textContent = "Export ▾";
  exportMdButton.textContent = "Export as .md";
  exportTxtButton.textContent = "Export as .txt";
  githubPanelSaveButton.textContent = "Save to exports/";
}

function showResult(button: HTMLButtonElement, text: string, ms: number): void {
  button.textContent = text;

  setTimeout(resetButtons, ms);
}

/*
 * ---------------------------------------------------------
 * LIVE PROGRESS
 * ---------------------------------------------------------
 *
 * The content script sends EXPORT_PROGRESS messages while
 * it scrolls through the conversation. Reflect that on
 * whichever button triggered the export, so long
 * conversations don't look frozen.
 */
let activeButton: HTMLButtonElement | null = null;

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "EXPORT_PROGRESS") {
    return;
  }

  if (!activeButton) {
    return;
  }

  activeButton.textContent = `Loading... (${message.collected})`;
});

/*
 * ---------------------------------------------------------
 * FILENAME
 * ---------------------------------------------------------
 *
 * Builds a filesystem-safe filename from the tab title and
 * today's date, e.g. "chatgpt-export-easypay-transfer-help-2026-08-30.md".
 */
function buildFilename(
  tabTitle: string | undefined,
  extension: "md" | "txt",
): string {
  const date = new Date();

  const datePart =
    date.getFullYear() +
    "-" +
    String(date.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(date.getDate()).padStart(2, "0");

  const rawTitle = (tabTitle ?? "conversation")
    /*
     * ChatGPT tab titles are usually just the
     * conversation title with no suffix, but
     * strip a trailing "ChatGPT" / separator
     * defensively in case that ever changes.
     */
    .replace(/\s*[-|]\s*ChatGPT\s*$/i, "")
    .trim();

  const safeTitle = rawTitle
    .toLowerCase()
    .replace(/[^a-z0-9\u0400-\u04FF]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

  const titlePart = safeTitle || "conversation";

  return `chatgpt-export-${titlePart}-${datePart}.${extension}`;
}

/*
 * ---------------------------------------------------------
 * FETCH + BUILD MARKDOWN
 * ---------------------------------------------------------
 *
 * Shared by the copy and export flows.
 */
async function fetchConversationMarkdown(
  button: HTMLButtonElement,
): Promise<{ markdown: string; tabTitle: string | undefined }> {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  if (!tab.id) {
    throw new Error("No active tab");
  }

  if (!tab.url?.startsWith("https://chatgpt.com/")) {
    throw new Error("Open a chatgpt.com conversation first");
  }

  console.log("GPTChatDownloader: requesting conversation");

  activeButton = button;

  let response;

  try {
    response = await chrome.tabs.sendMessage(tab.id, {
      type: "LOAD_CONVERSATION",
    });
  } catch (sendError) {
    /*
     * "Could not establish connection" means the
     * content script isn't running in this tab -
     * usually because the extension was reloaded
     * after the tab was already open. Reload the
     * tab and retry once.
     */
    console.warn(
      "GPTChatDownloader: no content script, reloading tab and retrying",
      sendError,
    );

    await chrome.tabs.reload(tab.id);

    await new Promise((resolve) => setTimeout(resolve, 2000));

    response = await chrome.tabs.sendMessage(tab.id, {
      type: "LOAD_CONVERSATION",
    });
  }

  if (!response?.success) {
    throw new Error(response?.error ?? "Failed to load conversation");
  }

  const messages = response.data as Message[];

  console.log(`GPTChatDownloader: received ${messages.length} messages`);

  if (messages.length === 0) {
    throw new Error("No messages found in this conversation");
  }

  const settings = await loadSettings();

  const timestamp = settings.includeTimestamp
    ? `_Exported ${new Date().toLocaleString()}_\n\n`
    : "";

  const markdown =
    timestamp +
    messages
      .sort((a, b) => a.order - b.order)
      .map((message) => {
        const roleLabel = message.role === "user" ? "User" : "Assistant";

        let heading: string;

        switch (settings.headingStyle) {
          case "bold":
            heading = `**${roleLabel}:**`;
            break;
          case "none":
            heading = "";
            break;
          case "h2":
          default:
            heading = `## ${roleLabel}`;
            break;
        }

        return heading ? `${heading}\n\n${message.content}` : message.content;
      })
      .join(SEPARATOR_TEXT[settings.messageSeparator]);

  console.log("GPTChatDownloader: generated markdown");

  return { markdown, tabTitle: tab.title };
}

/*
 * ---------------------------------------------------------
 * COPY TO CLIPBOARD
 * ---------------------------------------------------------
 */
copyButton.addEventListener("click", async () => {
  console.log("GPTChatDownloader: copy clicked");

  closeExportMenu();
  setBusy(copyButton, "Loading...");

  try {
    const { markdown } = await fetchConversationMarkdown(copyButton);

    const copyResponse = await chrome.runtime.sendMessage({
      type: "COPY_TO_CLIPBOARD",
      data: markdown,
    });

    console.log("GPTChatDownloader: clipboard response", copyResponse);

    if (!copyResponse?.success) {
      throw new Error(copyResponse?.error ?? "Failed to copy markdown");
    }

    showResult(copyButton, "Copied!", 1500);
  } catch (error) {
    console.error("GPTChatDownloader: copy failed", error);

    const message = error instanceof Error ? error.message : String(error);

    showResult(copyButton, message.length < 40 ? message : "Error", 2500);
  } finally {
    activeButton = null;
  }
});

/*
 * ---------------------------------------------------------
 * DOWNLOAD (shared by .md / .txt)
 * ---------------------------------------------------------
 */
async function downloadAs(
  button: HTMLButtonElement,
  format: "md" | "txt",
): Promise<void> {
  closeExportMenu();
  setBusy(button, "Loading...");

  let objectUrl: string | undefined;

  try {
    const { markdown, tabTitle } = await fetchConversationMarkdown(button);

    const content = format === "txt" ? stripMarkdown(markdown) : markdown;

    const mimeType = format === "txt" ? "text/plain" : "text/markdown";

    const filename = buildFilename(tabTitle, format);

    const blob = new Blob([content], { type: mimeType });

    objectUrl = URL.createObjectURL(blob);

    const downloadId = await chrome.downloads.download({
      url: objectUrl,
      filename,
      saveAs: false,
    });

    console.log("GPTChatDownloader: download started", downloadId);

    showResult(button, "Downloaded!", 1500);
  } catch (error) {
    console.error("GPTChatDownloader: download failed", error);

    const message = error instanceof Error ? error.message : String(error);

    showResult(button, message.length < 40 ? message : "Error", 2500);
  } finally {
    activeButton = null;

    /*
     * Release the object URL once the download has
     * had time to start reading it. Chrome needs the
     * URL to remain valid slightly after the download
     * call returns.
     */
    if (objectUrl) {
      const url = objectUrl;
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
  }
}

exportMdButton.addEventListener("click", () => {
  console.log("GPTChatDownloader: export .md clicked");
  void downloadAs(exportMdButton, "md");
});

exportTxtButton.addEventListener("click", () => {
  console.log("GPTChatDownloader: export .txt clicked");
  void downloadAs(exportTxtButton, "txt");
});

/*
 * ---------------------------------------------------------
 * SAVE TO GITHUB
 * ---------------------------------------------------------
 *
 * "Save to GitHub" in the export menu opens a small inline
 * panel (there's no room in a 220px popup for a separate
 * picker page) with a repo <select> and a Save button. The
 * panel is populated lazily, only when opened, so a person
 * who never uses this feature never pays for a GITHUB_LIST_REPOS
 * round trip.
 */

interface GitHubRepoOption {
  full_name: string;
  name: string;
}

function closeGithubPanel(): void {
  githubPanel.classList.remove("open");
}

async function openGithubPanel(): Promise<void> {
  closeExportMenu();
  githubPanel.classList.add("open");

  githubPanelMessage.textContent = "Loading your repos...";
  githubRepoSelect.innerHTML = "";
  githubRepoSelect.disabled = true;
  githubPanelSaveButton.disabled = true;

  const statusResponse = await chrome.runtime.sendMessage({
    type: "GITHUB_GET_STATUS",
  });

  if (!statusResponse?.success || !statusResponse.data?.connected) {
    githubPanelMessage.innerHTML =
      'Not connected. Open <a href="#" id="github-panel-settings-link">Settings</a> to connect GitHub first.';

    const settingsLink = document.getElementById("github-panel-settings-link");

    settingsLink?.addEventListener("click", (event) => {
      event.preventDefault();
      chrome.runtime.openOptionsPage();
    });

    return;
  }

  const reposResponse = await chrome.runtime.sendMessage({
    type: "GITHUB_LIST_REPOS",
  });

  if (!reposResponse?.success) {
    githubPanelMessage.textContent =
      reposResponse?.error ?? "Failed to load repos.";

    return;
  }

  const repos = reposResponse.data as GitHubRepoOption[];

  if (repos.length === 0) {
    githubPanelMessage.textContent = "No repos found that you can push to.";

    return;
  }

  githubPanelMessage.textContent = "Choose a repo to save into.";

  for (const repo of repos) {
    const option = document.createElement("option");
    option.value = repo.full_name;
    option.textContent = repo.full_name;
    githubRepoSelect.appendChild(option);
  }

  githubRepoSelect.disabled = false;
  githubPanelSaveButton.disabled = false;
}

githubToggleButton.addEventListener("click", () => {
  console.log("GPTChatDownloader: GitHub toggle clicked");

  if (githubPanel.classList.contains("open")) {
    closeGithubPanel();

    return;
  }

  void openGithubPanel();
});

document.addEventListener("click", (event) => {
  const target = event.target as Node;

  if (!githubToggleButton.contains(target) && !githubPanel.contains(target)) {
    closeGithubPanel();
  }
});

githubPanelSaveButton.addEventListener("click", async () => {
  const fullName = githubRepoSelect.value;

  if (!fullName) {
    return;
  }

  setBusy(githubPanelSaveButton, "Saving...");

  try {
    const { markdown, tabTitle } = await fetchConversationMarkdown(
      githubPanelSaveButton,
    );

    const filename = buildFilename(tabTitle, "md");

    const saveResponse = await chrome.runtime.sendMessage({
      type: "GITHUB_SAVE_FILE",
      fullName,
      filename,
      content: markdown,
    });

    if (!saveResponse?.success) {
      throw new Error(saveResponse?.error ?? "Failed to save to GitHub");
    }

    console.log("GPTChatDownloader: saved to GitHub", saveResponse.data);

    closeGithubPanel();
    showResult(githubPanelSaveButton, "Saved!", 1500);
  } catch (error) {
    console.error("GPTChatDownloader: GitHub save failed", error);

    const message = error instanceof Error ? error.message : String(error);

    showResult(
      githubPanelSaveButton,
      message.length < 40 ? message : "Error",
      2500,
    );
  } finally {
    activeButton = null;
  }
});
