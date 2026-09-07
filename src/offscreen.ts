const devLog = (...args: unknown[]): void => {
  if (import.meta.env.DEV) {
    console.log(...args);
  }
};

const devError = (...args: unknown[]): void => {
  if (import.meta.env.DEV) {
    console.error(...args);
  }
};

function copyUsingExecCommand(text: string): boolean {
  const textarea = document.getElementById(
    "clipboard-helper",
  ) as HTMLTextAreaElement | null;

  if (!textarea) {
    devError("GPTChatDownloader: clipboard-helper textarea missing");

    return false;
  }

  textarea.value = text;
  textarea.focus();
  textarea.select();

  const success = document.execCommand("copy");

  textarea.value = "";

  return success;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "OFFSCREEN_COPY") {
    return false;
  }

  try {
    const text = String(message.data ?? "");

    const success = copyUsingExecCommand(text);

    if (!success) {
      throw new Error("execCommand('copy') returned false");
    }

    devLog("GPTChatDownloader: offscreen clipboard write successful");

    sendResponse({
      success: true,
    });
  } catch (error) {
    devError("GPTChatDownloader: offscreen clipboard failed", error);

    sendResponse({
      success: false,
      error: String(error),
    });
  }

  return true;
});
