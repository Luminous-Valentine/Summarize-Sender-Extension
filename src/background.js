import { CHAT_TARGETS, emitNotification, setTextareaValue, clickElement, selectChatGPTModel, waitForElement } from './chatTargets.js';
import { buildMessage, enforceSizeLimit, getSettings } from './storage.js';

chrome.runtime.onInstalled.addListener(async () => {
  await getSettings();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'executeSend') {
    executeSend(message.payload)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  return false;
});

async function openTargetTab(targetKey) {
  const target = CHAT_TARGETS[targetKey];
  const tab = await chrome.tabs.create({ url: target.newChatUrl, active: true });
  await waitForTabReady(tab.id);
  // Allow the app shell to render before trying to inject into the page.
  await new Promise((resolve) => setTimeout(resolve, 1200));
  return tab.id;
}

async function ensureHostPermission(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const pattern = `${url.origin}/*`;
    const perm = { origins: [pattern] };
    const hasPerm = await new Promise((resolve) => chrome.permissions.contains(perm, (granted) => resolve(Boolean(granted))));
    if (hasPerm) return true;
    return new Promise((resolve) => chrome.permissions.request(perm, (granted) => resolve(Boolean(granted))));
  } catch (error) {
    console.warn('Failed to parse host permission', error);
    return false;
  }
}

function waitForTabReady(tabId) {
  return new Promise((resolve) => {
    const check = () => {
      chrome.tabs.get(tabId, (tab) => {
        if (!tab) return resolve();
        if (tab.status === 'complete') return resolve();
        setTimeout(check, 300);
      });
    };
    check();
  });
}

async function tryAutoSend(tabId, selectors, retries, delay) {
  for (let i = 0; i < retries; i += 1) {
    const clicked = await clickElement(tabId, selectors.sendButton, 10, delay);
    if (clicked) return true;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  return false;
}

async function executeSend(payload) {
  const settings = await getSettings();
  const { target, model, mode, prompt, autoSend, page } = payload;
  const targetConfig = CHAT_TARGETS[target];
  if (!targetConfig) {
    throw new Error('Unknown target');
  }

  const hasPermission = await ensureHostPermission(targetConfig.newChatUrl);
  if (!hasPermission) {
    emitNotification('Permission required', 'Please allow access to the chat site and try again.');
    return { status: 'permission-denied' };
  }

  const composed = buildMessage({ mode, prompt, page });
  const { text, truncated, aborted } = enforceSizeLimit(composed, settings.maxCharacters, settings.truncateStrategy);
  if (aborted) {
    emitNotification('Size limit exceeded', 'The message was not sent because it exceeded the configured limit.');
    return { status: 'aborted' };
  }

  const tabId = await openTargetTab(target);
  const selectors = targetConfig.selectors;

  const ready = await waitForElement(tabId, selectors.textarea, 24, 600);
  if (!ready) {
    emitNotification('Input not ready', 'Chat interface did not load in time.');
    return { status: 'input-missing' };
  }

  if (target === 'chatgpt' && model) {
    const modelResult = await selectChatGPTModel(tabId, selectors, model);
    if (!modelResult.ok) {
      emitNotification('Model unavailable', modelResult.reason || 'Unable to select model.');
      return { status: 'model-unavailable' };
    }
  }

  const textAreaSet = await setTextareaValue(tabId, selectors.textarea, text);
  if (!textAreaSet) {
    emitNotification('Input failed', 'Could not locate the chat input field.');
    return { status: 'input-missing' };
  }

  let sendStatus = 'input-only';
  if (autoSend) {
    const sent = await tryAutoSend(tabId, selectors, settings.retryCount || 1, settings.retryIntervalMs || 500);
    sendStatus = sent ? 'sent' : 'send-failed';
    if (!sent) {
      emitNotification('Auto-send failed', 'Input was filled but sending did not succeed.');
    }
  }

  return { status: sendStatus, truncated };
}
