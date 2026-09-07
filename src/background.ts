import {
  startDeviceFlow,
  pollForAccessToken,
  getStoredToken,
  getCurrentUser,
  disconnectGitHub,
  listRepos,
  saveFileToRepo,
} from "./github.ts";

async function setupOffscreenDocument(): Promise<void> {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });

  if (existingContexts.length > 0) {
    return;
  }

  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["CLIPBOARD"],
    justification: "Copy exported ChatGPT conversation to clipboard.",
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "COPY_TO_CLIPBOARD") {
    return false;
  }

  (async () => {
    try {
      await setupOffscreenDocument();

      const response = await chrome.runtime.sendMessage({
        type: "OFFSCREEN_COPY",
        data: message.data,
      });

      sendResponse(response);
    } catch (error) {
      console.error("GPTChatDownloader: background clipboard failed", error);

      sendResponse({
        success: false,
        error: String(error),
      });
    }
  })();

  /*
   * MUST return true synchronously so Chrome
   * keeps the message channel open until
   * sendResponse is called inside the async IIFE
   * above. Without this, the channel closes
   * immediately and you get a DOMException.
   */
  return true;
});

/*
 * ---------------------------------------------------------
 * GITHUB: DEVICE FLOW AUTH
 * ---------------------------------------------------------
 *
 * This must live in background.ts, not popup.ts or
 * options.ts: the device flow polling loop runs for up to
 * several minutes while the person goes to github.com/login/device
 * in a different tab, and a popup's JS context is destroyed
 * the moment the popup closes (which happens as soon as the
 * person clicks away to go authorize). The service worker has
 * no such lifecycle constraint, so the poll survives even if
 * the popup/options page that started it is long gone.
 *
 * GITHUB_START_AUTH kicks off the flow and immediately
 * returns the user_code/verification_uri for the UI to show,
 * without waiting for the poll to finish. The poll itself
 * runs in the background and reports its outcome via the
 * GITHUB_AUTH_COMPLETE runtime message once it resolves,
 * which whichever UI is open (if any) can listen for.
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "GITHUB_START_AUTH") {
    return false;
  }

  (async () => {
    try {
      const deviceCode = await startDeviceFlow();

      sendResponse({
        success: true,
        data: {
          userCode: deviceCode.user_code,
          verificationUri: deviceCode.verification_uri,
        },
      });

      /*
       * Poll in the background, independent of whether the
       * caller (popup/options) is still open. Broadcast the
       * result when it's done; any open UI can listen for it,
       * and if none is open, the token is still stored for
       * next time the person opens the popup/options page.
       */
      try {
        await pollForAccessToken(
          deviceCode.device_code,
          deviceCode.interval,
          deviceCode.expires_in,
        );

        chrome.runtime
          .sendMessage({ type: "GITHUB_AUTH_COMPLETE", success: true })
          .catch(() => {
            /*
             * No listener currently open - fine, the token
             * is already stored; the UI will pick it up next
             * time it checks connection status.
             */
          });
      } catch (pollError) {
        chrome.runtime
          .sendMessage({
            type: "GITHUB_AUTH_COMPLETE",
            success: false,
            error:
              pollError instanceof Error
                ? pollError.message
                : String(pollError),
          })
          .catch(() => {
            /* No listener currently open - nothing to do. */
          });
      }
    } catch (error) {
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })();

  return true;
});

/*
 * ---------------------------------------------------------
 * GITHUB: CONNECTION STATUS
 * ---------------------------------------------------------
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "GITHUB_GET_STATUS") {
    return false;
  }

  (async () => {
    try {
      const token = await getStoredToken();

      if (!token) {
        sendResponse({ success: true, data: { connected: false } });

        return;
      }

      const user = await getCurrentUser();

      sendResponse({
        success: true,
        data: { connected: true, login: user.login },
      });
    } catch (error) {
      /*
       * If the token is bad, getCurrentUser already clears it
       * (see github.ts githubApiRequest). Report as
       * disconnected rather than surfacing an error here -
       * this endpoint is used for silent status checks, not
       * user-initiated actions.
       */
      sendResponse({ success: true, data: { connected: false } });
    }
  })();

  return true;
});

/*
 * ---------------------------------------------------------
 * GITHUB: DISCONNECT
 * ---------------------------------------------------------
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "GITHUB_DISCONNECT") {
    return false;
  }

  (async () => {
    try {
      await disconnectGitHub();

      sendResponse({ success: true });
    } catch (error) {
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })();

  return true;
});

/*
 * ---------------------------------------------------------
 * GITHUB: LIST REPOS
 * ---------------------------------------------------------
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "GITHUB_LIST_REPOS") {
    return false;
  }

  (async () => {
    try {
      const repos = await listRepos();

      sendResponse({ success: true, data: repos });
    } catch (error) {
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })();

  return true;
});

/*
 * ---------------------------------------------------------
 * GITHUB: SAVE FILE
 * ---------------------------------------------------------
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "GITHUB_SAVE_FILE") {
    return false;
  }

  (async () => {
    try {
      const result = await saveFileToRepo(
        message.fullName,
        message.filename,
        message.content,
      );

      sendResponse({ success: true, data: result });
    } catch (error) {
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  })();

  return true;
});
