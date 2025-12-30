import { CHAT_TARGETS, emitNotification, setTextareaValue, readTextareaSnapshot, clickElement, selectChatGPTModel, waitForElement } from './chatTargets.js';
import { buildMessage, enforceSizeLimit, getSettings } from './storage.js';

const DEBUG_BG_LOG = true;
const dbg = (...args) => { if (DEBUG_BG_LOG) console.log('[SummarizeSender:bg]', ...args); };

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
  if (message?.type === 'detectChatGPTModels') {
    (async () => {
      try {
        const tabId = message.tabId;
        const targetKey = message.target || 'chatgpt';
        const selectors = CHAT_TARGETS[targetKey]?.selectors;
        if (!selectors || !tabId) {
          sendResponse({ ok: false, error: 'No tab or selectors' });
          return;
        }
    const settings = await getSettings();
    const models = await detectChatGPTModels(tabId, selectors);
    if (models.length > 0) {
      const mergedDetected = Array.from(new Set([...(settings.detectedModels || []), ...models]));
      const mergedAuto = Array.from(new Set([...(settings.allowedModelsAuto || []), ...models]));
      await chrome.storage.local.set({ detectedModels: mergedDetected, allowedModelsAuto: mergedAuto });
    }
    sendResponse({ ok: models.length > 0, models });
      } catch (error) {
        sendResponse({ ok: false, error: String(error) });
      }
    })();
    return true;
  }
  return false;
});

function resolveTargetUrl(targetKey, settings) {
  const target = CHAT_TARGETS[targetKey];
  if (!target) return '';
  if (targetKey === 'gemini') {
    const idx = Math.max(0, Math.floor(Number(settings?.geminiAccountIndex ?? 0)));
    return `https://gemini.google.com/u/${idx}/app`;
  }
  return target.newChatUrl;
}

async function openTargetTab(targetKey, urlOverride) {
  const target = CHAT_TARGETS[targetKey];
  const url = urlOverride || target?.newChatUrl;
  const tab = await chrome.tabs.create({ url, active: true });
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
    return new Promise((resolve) => chrome.permissions.request(perm, (granted) => {
      const err = chrome.runtime?.lastError;
      if (err) {
        console.warn('Host permission request failed', err);
        resolve(false);
        return;
      }
      resolve(Boolean(granted));
    }));
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

function truncateForGemini(text, maxLen) {
  if (text.length <= maxLen) return { text, truncated: false };
  const marker = '\n[TRUNCATED_FOR_GEMINI]';
  const keep = Math.max(0, maxLen - marker.length);
  return { text: `${text.slice(0, keep)}${marker}`, truncated: true };
}

function buildNeedleFromContent(content, maxLen = 16) {
  if (!content) return '';
  let needle = '';
  for (const ch of String(content)) {
    if (/\s/.test(ch)) continue;
    needle += ch;
    if (needle.length >= maxLen) break;
  }
  return needle;
}

async function fillInputWithVerification({ tabId, selectors, target, mode, fullText, prompt, page }) {
  if (target !== 'gemini' || mode !== 'content') {
    const ok = await setTextareaValue(tabId, selectors.textarea, fullText);
    return { ok, finalText: fullText, gemini: null };
  }

  const contentNeedle = buildNeedleFromContent(page.content, 16);
  dbg('Gemini fill start', { fullTextLen: fullText.length, promptLen: (prompt || '').length, needle: contentNeedle });
  const variants = [
    { name: 'plain', text: `${prompt}\n\n${page.content || ''}`.trim() },
    { name: 'url+plain', text: `${prompt}\n${page.url}\n\n${page.content || ''}`.trim() },
    { name: 'fenced', text: fullText },
  ].filter((v) => typeof v.text === 'string' && v.text.length > 0);

  const maxLens = [fullText.length, 8000, 6000, 4000, 2500, 1500].filter((n) => Number.isFinite(n) && n > 0);

  for (const variant of variants) {
    for (const maxLen of maxLens) {
      const { text: candidateText, truncated } = truncateForGemini(variant.text, maxLen);
      const candidateNonWs = candidateText.replace(/\s+/g, '');
      dbg('Gemini variant attempt', { variant: variant.name, maxLen, candidateLength: candidateText.length, candidateNonWs: candidateNonWs.length, truncated });
      const okMain = await setTextareaValue(tabId, selectors.textarea, candidateText, 8, 250, { world: 'MAIN' });
      const ok = okMain || await setTextareaValue(tabId, selectors.textarea, candidateText, 6, 250);
      if (!ok) continue;
      const snap = await readTextareaSnapshot(tabId, selectors.textarea, contentNeedle);
      const minExpected = Math.min(candidateText.length, 200);
      const minNonWs = Math.min(candidateNonWs.length, 32);
      const hasBody = contentNeedle ? Boolean(snap.needleFound) : (snap.nonWhitespaceLength >= Math.max(4, minNonWs));
      dbg('Gemini snapshot', { variant: variant.name, maxLen, snap, minExpected, minNonWs, hasBody });
      if (snap.found && snap.length >= Math.min(minExpected, snap.length) && hasBody) {
        return {
          ok: true,
          finalText: candidateText,
          gemini: {
            variant: variant.name,
            truncated,
            requestedLength: candidateText.length,
            observedLength: snap.length,
            observedNonWhitespaceLength: snap.nonWhitespaceLength,
            observedHasFence: snap.hasFence,
            observedTag: snap.tag,
            observedContentEditable: snap.isContentEditable,
            needleLength: contentNeedle.length,
            needleFound: snap.needleFound,
          },
        };
      }
    }
  }

  const okMain = await setTextareaValue(tabId, selectors.textarea, fullText, 10, 250, { world: 'MAIN' });
  const ok = okMain || await setTextareaValue(tabId, selectors.textarea, fullText);
  const snap = await readTextareaSnapshot(tabId, selectors.textarea, contentNeedle);
  const minExpected = Math.min(fullText.length, 200);
  const minNonWs = Math.min(fullText.replace(/\s+/g, '').length, 32);
  const hasBody = contentNeedle ? Boolean(snap.needleFound) : snap.nonWhitespaceLength >= Math.max(4, minNonWs);
  dbg('Gemini fallback snapshot', { snap, minExpected, minNonWs, hasBody });
  const verified = snap.found && snap.length >= minExpected && hasBody;
  return {
    ok: ok && verified,
    finalText: fullText,
    gemini: {
      variant: 'fallback',
      truncated: false,
      requestedLength: fullText.length,
      observedLength: snap.found ? snap.length : null,
      observedNonWhitespaceLength: snap.found ? snap.nonWhitespaceLength : null,
      observedHasFence: snap.found ? snap.hasFence : null,
      verified,
      observedTag: snap.found ? snap.tag : null,
      observedContentEditable: snap.found ? snap.isContentEditable : null,
      needleLength: contentNeedle.length,
      needleFound: snap.found ? snap.needleFound : null,
    },
  };
}

async function detectChatGPTModels(tabId, selectors) {
  const settings = await getSettings();
  if (!settings.modelDetectionBetaEnabled) {
    dbg('detectChatGPTModels: beta disabled');
    return [];
  }
  if (!selectors.modelButton || selectors.modelButton.length === 0) return [];
  const found = await waitForElement(tabId, selectors.modelButton, 10, 400);
  if (!found) {
    dbg('detectChatGPTModels: model button not found');
    return [];
  }
  const opened = await clickElement(tabId, selectors.modelButton, 6, 400);
  if (!opened) {
    dbg('detectChatGPTModels: model button not opened');
    return [];
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const seen = new Set();
        const pushUnique = (text, list) => {
          const t = (text || '').trim();
          if (!t || t.length > 80) return;
          if (seen.has(t)) return;
          seen.add(t);
          list.push(t);
        };
        const isVisible = (el) => {
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          if (!rect || rect.width === 0 || rect.height === 0) return false;
          const style = el.ownerDocument?.defaultView?.getComputedStyle(el);
          if (!style || style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return false;
          return true;
        };
        const findButtonInShadows = (selectors) => {
          const list = Array.isArray(selectors) ? selectors : [selectors];
          const search = (root) => {
            for (const sel of list) {
              const els = (root.querySelectorAll?.(sel) || []);
              for (const el of els) {
                if (isVisible(el)) return el;
              }
            }
            const all = root.querySelectorAll?.('*') || [];
            for (const el of all) {
              if (el.shadowRoot) {
                const hit = search(el.shadowRoot);
                if (hit) return hit;
              }
            }
            return null;
          };
          return search(document);
        };

        // If menu not open yet, try clicking from inside this world.
        const btn = findButtonInShadows([
          'button[data-testid="model-switcher-button"]',
          'button[data-testid="ModelSwitcher"]',
          'button[data-testid="model-selector"]',
          '[data-testid="model-switcher"] button',
          '[data-testid*="model-switcher"] button',
          'button[aria-haspopup="listbox"][data-testid]',
          'button[aria-haspopup="menu"][data-testid]',
          'button[aria-label*="Model"]',
          'button[aria-label*="モデル"]'
        ]);
        if (btn) {
          try { btn.click(); } catch (_err) {}
        }

        const collectFromRoot = (root, list) => {
          const hasQuery = root && typeof root.querySelectorAll === 'function';
          if (hasQuery) {
            const candidates = root.querySelectorAll('button,[role="option"],[role="menuitem"],[role="menuitemradio"]');
            candidates.forEach((el) => {
              if (!isVisible(el)) return;
              const txt = (el.innerText || el.textContent || '').trim();
              pushUnique(txt, list);
            });
          }
          const all = hasQuery ? root.querySelectorAll('*') : [];
          for (const el of all) {
            if (el.shadowRoot) collectFromRoot(el.shadowRoot, list);
          }
        };

        const models = [];
        collectFromRoot(document, models);
        // Try closing with Escape to avoid leaving menu open.
        try {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true }));
        } catch (_err) {}
        return models;
      },
      args: [],
    });
    const modelsRaw = Array.isArray(result?.result) ? result.result : [];
    const models = filterModelNames(modelsRaw, settings.allowedModelsAuto);
    dbg('Detected ChatGPT models', models);
    return models;
  } catch (error) {
    console.warn('detectChatGPTModels failed', error);
    return [];
  }
}

function filterModelNames(models, allowedAuto = []) {
  const unique = [];
  const allowlist = Array.isArray(allowedAuto) ? allowedAuto.map((m) => m.trim()).filter(Boolean) : [];
  const isAllowed = (t) => (allowlist.length === 0 ? true : allowlist.some((a) => t.toLowerCase().includes(a.toLowerCase())));
  const blacklistExact = ['gpt', 'chatgpt', 'project', 'プロジェクト', 'あなたのチャット'];
  models.forEach((m) => {
    const t = (m || '').trim();
    if (!t || t.length > 60) return;
    const lower = t.toLowerCase();
    if (blacklistExact.includes(lower)) return;
    const hasKeyword = /(gpt|chatgpt|o[0-9]|4\.|5\.|think|turbo|mini)/.test(lower);
    if (!hasKeyword) return;
    if (!isAllowed(t)) return;
    if (unique.includes(t)) return;
    unique.push(t);
  });
  return unique;
}

async function executeSend(payload) {
  const settings = await getSettings();
  const { target, model, mode, prompt, autoSend, page, messageOverride } = payload;
  const targetConfig = CHAT_TARGETS[target];
  if (!targetConfig) {
    throw new Error('Unknown target');
  }

  const targetUrl = resolveTargetUrl(target, settings);
  const hasPermission = await ensureHostPermission(targetUrl);
  if (!hasPermission) {
    emitNotification('Permission required', 'Please allow access to the chat site and try again.');
    return { status: 'permission-denied' };
  }

  const useOverride = typeof messageOverride === 'string' && messageOverride.trim().length > 0;
  const composed = useOverride ? messageOverride : buildMessage({ mode, prompt, page });
  const { text, truncated, aborted } = enforceSizeLimit(composed, settings.maxCharacters, settings.truncateStrategy);
  if (aborted) {
    emitNotification('Size limit exceeded', 'The message was not sent because it exceeded the configured limit.');
    return { status: 'aborted' };
  }

  const tabId = await openTargetTab(target, targetUrl);
  const selectors = targetConfig.selectors;

  const ready = await waitForElement(tabId, selectors.textarea, 24, 600);
  if (!ready) {
    emitNotification('Input not ready', 'Chat interface did not load in time.');
    return { status: 'input-missing' };
  }

  let detectedModels = settings.detectedModels || [];
  const isChatGPT = target === 'chatgpt' || target === 'chatgpt_temp';
  if (isChatGPT && settings.modelAvailabilityMode === 'auto' && settings.modelDetectionBetaEnabled) {
    const models = await detectChatGPTModels(tabId, selectors);
    if (models.length > 0) {
      const mergedDetected = Array.from(new Set([...(settings.detectedModels || []), ...models]));
      const mergedAuto = Array.from(new Set([...(settings.allowedModelsAuto || []), ...models]));
      detectedModels = mergedDetected;
      settings.detectedModels = mergedDetected;
      settings.allowedModelsAuto = mergedAuto;
      await chrome.storage.local.set({ detectedModels: mergedDetected, allowedModelsAuto: mergedAuto });
    }
  }

  let modelResult = { ok: true };
  if (isChatGPT && model) {
    modelResult = await selectChatGPTModel(tabId, selectors, model);
    if (!modelResult.ok) {
      emitNotification('Model unavailable', modelResult.reason || 'Unable to select model.');
    }
  }

  const fillResult = await fillInputWithVerification({ tabId, selectors, target, mode, fullText: text, prompt, page });
  if (!fillResult.ok) {
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

  return {
    status: sendStatus,
    truncated,
    modelSelected: modelResult.ok,
    modelReason: modelResult.reason,
    gemini: fillResult.gemini,
  };
}
