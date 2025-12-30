const ICON_CACHE = {};
const DEBUG_INPUT_LOG = true;

function debugLog(...args) {
  if (!DEBUG_INPUT_LOG) return;
  try {
    console.log('[SummarizeSender]', ...args);
  } catch (_err) {}
}

function isElementUsable(el) {
  if (!el) return false;
  if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
  if (el.getAttribute('aria-hidden') === 'true') return false;
  try {
    const rect = el.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return false;
    const view = el.ownerDocument?.defaultView;
    const style = view ? view.getComputedStyle(el) : null;
    if (style) {
      if (style.visibility === 'hidden' || style.display === 'none') return false;
      const opacity = parseFloat(style.opacity);
      if (!Number.isNaN(opacity) && opacity === 0) return false;
    }
  } catch (error) {
    // If getBoundingClientRect is unavailable, err on the side of skipping this element.
    return false;
  }
  return true;
}

async function resolveIcon(size = 128) {
  const key = String(size);
  if (ICON_CACHE[key]) return ICON_CACHE[key];

  const candidates = [
    `icons/icon${size}.png`,
    `icons/icon${size}.svg`,
  ];

  for (const path of candidates) {
    try {
      const url = chrome.runtime.getURL(path);
      const response = await fetch(url);
      if (response.ok) {
        ICON_CACHE[key] = url;
        return url;
      }
    } catch (error) {
      console.warn('Icon lookup failed', path, error);
    }
  }

  // Fall back to the last candidate (SVG) so notifications always have an icon.
  const fallback = chrome.runtime.getURL(candidates[0]);
  ICON_CACHE[key] = fallback;
  return fallback;
}

const CHATGPT_BASE = {
  selectors: {
    textarea: [
      'div[contenteditable="true"][data-id="prompt-textarea"]',
      'div[contenteditable="true"][data-testid="prompt-textarea"]',
      'div[contenteditable="true"][data-lexical-editor]',
      'div[data-lexical-editor="true"]',
      'div[data-lexical-editor]',
      'div[contenteditable="true"][data-placeholder]',
      'textarea[data-id="prompt-textarea"]',
      'textarea#prompt-textarea',
      'textarea[data-testid="composer"]',
      'textarea[aria-label="Message ChatGPT"]',
      'textarea[aria-label*="メッセージ"]',
      'div[aria-label*="メッセージ"]',
      'textarea[placeholder]',
      'div[contenteditable="true"]',
      'div[role="textbox"]',
      'textarea',
    ],
    sendButton: [
      'button[data-testid="send-button"]',
      'button[data-testid="composer-send-button"]',
      'button[aria-label="Send message"]',
      'button[aria-label="Send"]',
      'button[aria-label*="送信"]'
    ],
    modelButton: [
      'button[data-testid="model-switcher-button"]',
      'button[data-testid="ModelSwitcher"]',
      'button[data-testid="model-selector"]',
      '[data-testid="model-switcher"] button',
      '[data-testid*="model-switcher"] button',
      'button[aria-haspopup="listbox"][data-testid]',
      'button[aria-haspopup="menu"][data-testid]',
      'button[aria-label*="Model"]',
      'button[aria-label*="モデル"]'
    ],
  },
};

const CHAT_TARGETS = {
  chatgpt: {
    name: 'ChatGPT',
    newChatUrl: 'https://chatgpt.com/?new_chat=true',
    selectors: CHATGPT_BASE.selectors,
  },
  chatgpt_temp: {
    name: 'ChatGPT (Temporary chat)',
    newChatUrl: 'https://chatgpt.com/?temporary-chat=true',
    selectors: CHATGPT_BASE.selectors,
  },
  gemini: {
    name: 'Gemini',
    newChatUrl: 'https://gemini.google.com/app',
    selectors: {
      textarea: [
        'textarea[data-qa="input-textarea"]',
        'textarea[data-qa="chat-input-textarea"]',
        'div[contenteditable="true"][data-lexical-editor]',
        'div[data-lexical-editor]',
        'textarea[aria-label="Message Gemini"]',
        'textarea[aria-label="Message Gemini AI"]',
        'textarea[aria-label="Enter a prompt here"]',
        'textarea[aria-label^="Enter a prompt"]',
        'textarea[aria-label*="メッセージ"]',
        'div[aria-label*="メッセージ"]',
        'textarea[aria-label]',
        'div[contenteditable="true"]',
        'div[role="textbox"]'
      ],
      sendButton: [
        'button[data-qa="send-button"]',
        'button[data-qa="input-send-button"]',
        'button[data-qa="composer-send-button"]',
        'button[aria-label="Send message"]',
        'button[data-testid="send-button"]',
        'button[type="submit"]',
        'button[aria-label="Send"]',
        'button[aria-label*="送信"]'
      ],
      modelButton: [],
    },
  },
};

function findInDocumentAndShadows(selectors, root = document, predicate) {
  const selectorList = Array.isArray(selectors) ? selectors : [selectors];
  const matchesPredicate = (el) => {
    if (!isElementUsable(el)) return false;
    return (typeof predicate === 'function' ? predicate(el) : true);
  };

  const findWithSelector = (selector, searchRoot) => {
    const rootWithQuery = searchRoot && typeof searchRoot.querySelectorAll === 'function';
    if (rootWithQuery) {
      const directMatches = searchRoot.querySelectorAll(selector);
      for (const match of directMatches) {
        if (matchesPredicate(match)) return match;
      }
    }

    const allElements = rootWithQuery ? searchRoot.querySelectorAll('*') : [];
    for (const el of allElements) {
      if (el.shadowRoot) {
        const shadowMatch = findWithSelector(selector, el.shadowRoot);
        if (shadowMatch) return shadowMatch;
      }
    }

    return null;
  };

  for (const selector of selectorList) {
    const found = findWithSelector(selector, root);
    if (found) return found;
  }

  return null;
}

async function emitNotification(title, message) {
  const iconUrl = await resolveIcon(128);
  if (chrome.notifications) {
    chrome.notifications.create({ type: 'basic', iconUrl, title, message }, () => {
      const err = chrome.runtime?.lastError;
      if (!err) return;
      console.warn('Notification failed', err);
      // Retry once with a known-good PNG URL.
      const retryIconUrl = chrome.runtime.getURL('icons/icon128.png');
      chrome.notifications.create({ type: 'basic', iconUrl: retryIconUrl, title, message });
    });
  } else {
    console.warn(title, message);
  }
}

async function waitForElement(tabId, selector, attempts = 20, delayMs = 500) {
  const selectors = Array.isArray(selector) ? selector : [selector];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    for (const sel of selectors) {
      try {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId },
          func: (selectorList) => {
            const list = Array.isArray(selectorList) ? selectorList : [selectorList];
            const isUsable = (el) => {
              if (!el) return false;
              if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
              if (el.getAttribute('aria-hidden') === 'true') return false;
              try {
                const rect = el.getBoundingClientRect();
                if (!rect || rect.width === 0 || rect.height === 0) return false;
                const style = el.ownerDocument?.defaultView?.getComputedStyle(el);
                if (style && (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0)) return false;
              } catch (_err) {}
              return true;
            };
            const findWithSelector = (oneSelector, root = document) => {
              const hasQuery = root && typeof root.querySelectorAll === 'function';
              if (hasQuery) {
                const direct = root.querySelectorAll(oneSelector);
                for (const el of direct) {
                  if (isUsable(el)) return el;
                }
              }
              const all = hasQuery ? root.querySelectorAll('*') : [];
              for (const el of all) {
                if (el.shadowRoot) {
                  const shadowMatch = findWithSelector(oneSelector, el.shadowRoot);
                  if (shadowMatch) return shadowMatch;
                }
              }
              return null;
            };
            return list.some((one) => Boolean(findWithSelector(one, document)));
          },
          args: [sel],
        });
        if (result?.result) return true;
      } catch (error) {
        console.warn('waitForElement failed', error);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  const detail = `waitForElement: selectors ${selectors.join(', ')} not found after ${attempts} attempts.`;
  console.warn(detail);
  await emitNotification('Element not found', detail);
  return false;
}

async function clickElement(tabId, selector, attempts = 10, delayMs = 500) {
  const selectors = Array.isArray(selector) ? selector : [selector];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    for (const sel of selectors) {
      try {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId },
          func: (selectorList) => {
            const list = Array.isArray(selectorList) ? selectorList : [selectorList];
            const isUsable = (el) => {
              if (!el) return false;
              if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
              if (el.getAttribute('aria-hidden') === 'true') return false;
              try {
                const rect = el.getBoundingClientRect();
                if (!rect || rect.width === 0 || rect.height === 0) return false;
                const style = el.ownerDocument?.defaultView?.getComputedStyle(el);
                if (style && (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0)) return false;
              } catch (_err) {}
              return true;
            };
            const findWithSelector = (oneSelector, root = document) => {
              const hasQuery = root && typeof root.querySelectorAll === 'function';
              if (hasQuery) {
                const direct = root.querySelectorAll(oneSelector);
                for (const el of direct) {
                  if (isUsable(el)) return el;
                }
              }
              const all = hasQuery ? root.querySelectorAll('*') : [];
              for (const el of all) {
                if (el.shadowRoot) {
                  const shadowMatch = findWithSelector(oneSelector, el.shadowRoot);
                  if (shadowMatch) return shadowMatch;
                }
              }
              return null;
            };
            for (const one of list) {
              const el = findWithSelector(one, document);
              if (el) {
                el.focus?.();
                el.click();
                el.dispatchEvent(new Event('input', { bubbles: true }));
                return true;
              }
            }
            return false;
          },
          args: [sel],
        });
        if (result?.result) return true;
      } catch (error) {
        console.warn('clickElement failed', error);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  const detail = `clickElement: selectors ${selectors.join(', ')} not found or not clickable after ${attempts} attempts.`;
  console.warn(detail);
  await emitNotification('Click failed', detail);
  return false;
}

async function setTextareaValue(tabId, selector, value, attempts = 20, delayMs = 500, options = {}) {
  const selectors = Array.isArray(selector) ? selector : [selector];
  const world = options?.world;
  debugLog('setTextareaValue start', { selectors, attempts, world, textLength: String(value || '').length });
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    for (const sel of selectors) {
      try {
        const execParams = {
          target: { tabId },
          func: (selectorList, text) => {
            const list = Array.isArray(selectorList) ? selectorList : [selectorList];
            const isUsable = (el) => {
              if (!el) return false;
              if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
              if (el.getAttribute('aria-hidden') === 'true') return false;
              try {
                const rect = el.getBoundingClientRect();
                if (!rect || rect.width === 0 || rect.height === 0) return false;
                const style = el.ownerDocument?.defaultView?.getComputedStyle(el);
                if (style && (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0)) return false;
              } catch (_err) {}
              return true;
            };
            const findWithSelector = (oneSelector, root = document) => {
              const hasQuery = root && typeof root.querySelectorAll === 'function';
              if (hasQuery) {
                const direct = root.querySelectorAll(oneSelector);
                for (const el of direct) {
                  if (isUsable(el)) return el;
                }
              }
              const all = hasQuery ? root.querySelectorAll('*') : [];
              for (const el of all) {
                if (el.shadowRoot) {
                  const shadowMatch = findWithSelector(oneSelector, el.shadowRoot);
                  if (shadowMatch) return shadowMatch;
                }
              }
              return null;
            };
            const el = (() => {
              for (const one of list) {
                const found = findWithSelector(one, document);
                if (found) return found;
              }
              return null;
            })();
            if (!el) return false;
            const tag = (el.tagName || '').toLowerCase();
            const isTextHost = el.isContentEditable || tag === 'textarea' || tag === 'input';
            if (!isTextHost) return false;
            const beforeText = el.isContentEditable ? ((el.innerText || el.textContent || '') || '') : (el.value || '');
            const beforeNonWs = beforeText.replace(/\s+/g, '').length;
            console.debug('[SummarizeSender:setTextareaValue]', { selectorList: list, tag, isContentEditable: el.isContentEditable, beforeLength: beforeText.length, beforeNonWs });

            const firePaste = (target, textToPaste) => {
              try {
                const dt = new DataTransfer();
                dt.setData('text/plain', textToPaste);
                const evt = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
                target.dispatchEvent(evt);
              } catch (_err) {}
            };

            const fireInputLike = (target, name, detail) => {
              try {
                const event = new InputEvent(name, { bubbles: true, cancelable: true, data: detail, inputType: 'insertFromPaste' });
                target.dispatchEvent(event);
              } catch (_err) {
                target.dispatchEvent(new Event(name, { bubbles: true, cancelable: true }));
              }
            };

            const fireKeyLike = (target, name) => {
              try {
                target.dispatchEvent(new KeyboardEvent(name, { bubbles: true, cancelable: true, key: 'v', metaKey: true }));
              } catch (_err) {
                target.dispatchEvent(new Event(name, { bubbles: true, cancelable: true }));
              }
            };

            const fireMouse = (name) => {
              try {
                el.dispatchEvent(new MouseEvent(name, { bubbles: true, cancelable: true }));
              } catch (_err) {}
            };

            el.scrollIntoView?.({ block: 'center', inline: 'nearest' });
            fireMouse('mousedown');
            fireMouse('mouseup');
            fireMouse('click');
            if (typeof el.focus === 'function') {
              el.focus();
            }

            fireInputLike(el, 'beforeinput', text);

            const doc = el.ownerDocument || document;
            const applyStrategies = () => {
              const strategies = [
                () => {
                  const setter = Object.getOwnPropertyDescriptor(el.__proto__, 'value')?.set;
                  if (setter) setter.call(el, text);
                  else el.value = text;
                },
                () => { el.value = text; },
                () => { el.textContent = text; },
                () => { el.innerText = text; },
                () => {
                  try {
                    doc.execCommand?.('selectAll', false, null);
                    doc.execCommand?.('delete', false, null);
                    doc.execCommand?.('insertText', false, text);
                  } catch (_err) {}
                },
                () => {
                  try {
                    const sel = doc.getSelection?.();
                    if (sel && typeof sel.removeAllRanges === 'function' && typeof doc.createRange === 'function') {
                      const range = doc.createRange();
                      range.selectNodeContents(el);
                      range.collapse(false);
                      sel.removeAllRanges();
                      sel.addRange(range);
                      doc.execCommand?.('insertText', false, text);
                    }
                  } catch (_err) {}
                },
                () => {
                  try {
                    firePaste(el, text);
                  } catch (_err) {}
                },
              ];
              strategies.forEach((fn) => { try { fn(); } catch (_err) {} });
            };

            applyStrategies();
            if (el.isContentEditable) {
              try {
                const sel = doc.getSelection?.();
                if (sel && typeof sel.removeAllRanges === 'function' && typeof doc.createRange === 'function') {
                  const range = doc.createRange();
                  range.selectNodeContents(el);
                  sel.removeAllRanges();
                  sel.addRange(range);
                  doc.execCommand?.('insertText', false, text);
                  fireInputLike(el, 'input', text);
                }
              } catch (_err) {}
            }
            fireInputLike(el, 'input', text);

            fireKeyLike(el, 'keydown');
            fireKeyLike(el, 'keyup');
            el.dispatchEvent(new Event('change', { bubbles: true }));
            fireInputLike(el, 'input', text);

            const currentText = el.isContentEditable
              ? ((el.innerText || el.textContent || '') || '')
              : (el.value || '');
            const needle = text.slice(0, Math.min(8, text.length));
            const nonWsLen = currentText.replace(/\s+/g, '').length;
            console.debug('[SummarizeSender:setTextareaValue:after]', { tag, isContentEditable: el.isContentEditable, length: currentText.length, nonWsLen, includesNeedle: needle ? currentText.includes(needle) : null });
            if (currentText && (needle ? currentText.includes(needle) : nonWsLen > 0)) return true;
            // If still empty, try one more direct assignment for stubborn editors.
            try { el.textContent = text; el.value = text; } catch (_err) {}
            if (el.isContentEditable) {
              try {
                const sel = doc.getSelection?.();
                const lines = String(text).split(/\n/);
                el.innerHTML = '';
                lines.forEach((line, idx) => {
                  const div = doc.createElement('div');
                  div.appendChild(doc.createTextNode(line));
                  if (idx < lines.length - 1) {
                    div.appendChild(doc.createElement('br'));
                  }
                  el.appendChild(div);
                });
                if (sel && typeof sel.removeAllRanges === 'function') {
                  const range = doc.createRange();
                  range.selectNodeContents(el);
                  range.collapse(false);
                  sel.removeAllRanges();
                  sel.addRange(range);
                }
                fireInputLike(el, 'input', text);
                fireKeyLike(el, 'keydown');
                fireKeyLike(el, 'keyup');
              } catch (_err) {}
            }
            const finalText = el.isContentEditable ? ((el.innerText || el.textContent || '') || '') : (el.value || '');
            const finalNonWsLen = finalText.replace(/\s+/g, '').length;
            console.debug('[SummarizeSender:setTextareaValue:final]', { tag, isContentEditable: el.isContentEditable, length: finalText.length, finalNonWsLen, includesNeedle: needle ? finalText.includes(needle) : null, prefix: finalText.slice(0, 80) });
            return finalText ? finalNonWsLen > 0 || (needle ? finalText.includes(needle) : true) : false;
          },
          args: [sel, value],
        };
        if (world) execParams.world = world;
        const [result] = await chrome.scripting.executeScript(execParams);
        if (result?.result) return true;
      } catch (error) {
        console.warn('setTextareaValue failed', error);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  const detail = `setTextareaValue: selectors ${selectors.join(', ')} not found after ${attempts} attempts.`;
  console.warn(detail);
  await emitNotification('Textarea not found', detail);
  return false;
}

async function readTextareaSnapshot(tabId, selector, needle) {
  const selectors = Array.isArray(selector) ? selector : [selector];
  for (const sel of selectors) {
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        func: (selectorList, searchNeedle) => {
          const list = Array.isArray(selectorList) ? selectorList : [selectorList];
          const isUsable = (el) => {
            if (!el) return false;
            if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
            if (el.getAttribute('aria-hidden') === 'true') return false;
            try {
              const rect = el.getBoundingClientRect();
              if (!rect || rect.width === 0 || rect.height === 0) return false;
              const style = el.ownerDocument?.defaultView?.getComputedStyle(el);
              if (style && (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0)) return false;
            } catch (_err) {}
            return true;
          };
          const findWithSelector = (oneSelector, root = document) => {
            const hasQuery = root && typeof root.querySelectorAll === 'function';
            if (hasQuery) {
              const direct = root.querySelectorAll(oneSelector);
              for (const el of direct) {
                if (isUsable(el)) return el;
              }
            }
            const all = hasQuery ? root.querySelectorAll('*') : [];
            for (const el of all) {
              if (el.shadowRoot) {
                const shadowMatch = findWithSelector(oneSelector, el.shadowRoot);
                if (shadowMatch) return shadowMatch;
              }
            }
            return null;
          };
          const el = (() => {
            for (const one of list) {
              const found = findWithSelector(one, document);
              if (found) return found;
            }
            return null;
          })();
          if (!el) return { found: false };
          const tag = (el.tagName || '').toLowerCase();
          const isContentEditable = Boolean(el.isContentEditable);
          const text = isContentEditable ? (el.innerText || el.textContent || '') : (el.value || el.textContent || '');
          const needleFound = searchNeedle ? String(text || '').includes(searchNeedle) : null;
          const nonWhitespaceLength = (text || '').replace(/\s+/g, '').length;
          console.debug('[SummarizeSender:readTextareaSnapshot]', {
            selectorList: list,
            found: true,
            tag,
            isContentEditable,
            length: (text || '').length,
            nonWhitespaceLength,
            needleFound,
            prefix: (text || '').slice(0, 120)
          });
          return {
            found: true,
            tag,
            isContentEditable,
            length: (text || '').length,
            nonWhitespaceLength,
            needleFound,
            prefix: (text || '').slice(0, 200),
            hasFence: (text || '').includes('```'),
          };
        },
        args: [sel, needle || ''],
      });
      if (result?.result?.found) {
        return result.result;
      }
    } catch (error) {
      console.warn('readTextareaSnapshot failed', error);
    }
  }
  return { found: false, tag: '', isContentEditable: false, length: 0, needleFound: null, prefix: '', hasFence: false };
}

async function selectChatGPTModel(tabId, selectors, modelName) {
  if (!selectors.modelButton || selectors.modelButton.length === 0) return { ok: true };
  const opened = await clickElement(tabId, selectors.modelButton, 8, 600);
  if (!opened) {
    const detail = 'Model button not found (including within shadow DOM).';
    console.warn(detail);
    await emitNotification('Model picker missing', detail);
    return { ok: false, reason: 'Model picker not found' };
  }
  try {
    const needle = modelName.trim().toLowerCase();
    for (let i = 0; i < 8; i += 1) {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        func: (name) => {
          const isUsable = (el) => {
            if (!el) return false;
            if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
            if (el.getAttribute('aria-hidden') === 'true') return false;
            try {
              const rect = el.getBoundingClientRect();
              if (!rect || rect.width === 0 || rect.height === 0) return false;
              const style = el.ownerDocument?.defaultView?.getComputedStyle(el);
              if (style && (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0)) return false;
            } catch (_err) {}
            return true;
          };

          const matchesName = (el) => {
            const label = (el.innerText || '').trim().toLowerCase();
            return Boolean(label) && (label === name || label.includes(name));
          };

          const findOption = (root = document) => {
            const hasQuery = root && typeof root.querySelectorAll === 'function';
            if (hasQuery) {
              const candidates = root.querySelectorAll('button, [role="option"], [role="menuitem"], [role="menuitemradio"], div');
              for (const el of candidates) {
                if (!isUsable(el)) continue;
                if (matchesName(el)) return el;
              }
            }
            const all = hasQuery ? root.querySelectorAll('*') : [];
            for (const el of all) {
              if (el.shadowRoot) {
                const shadowMatch = findOption(el.shadowRoot);
                if (shadowMatch) return shadowMatch;
              }
            }
            return null;
          };

          const target = findOption(document);
          if (!target) return false;
          const clickable = (typeof target.closest === 'function' && target.closest('button')) ? target.closest('button') : target;
          if (clickable.disabled || clickable.getAttribute?.('aria-disabled') === 'true') return false;
          clickable.click();
          return true;
        },
        args: [needle],
      });
      if (result?.result) return { ok: true };
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const detail = 'Model option not found within shadow DOM or visible DOM.';
    console.warn(detail);
    await emitNotification('Model option missing', detail);
    return { ok: false, reason: 'Model not available' };
  } catch (error) {
    console.warn('selectChatGPTModel failed', error);
    return { ok: false, reason: 'Model selection blocked by permissions' };
  }
}

export { CHAT_TARGETS, emitNotification, setTextareaValue, readTextareaSnapshot, clickElement, selectChatGPTModel, waitForElement, findInDocumentAndShadows };
