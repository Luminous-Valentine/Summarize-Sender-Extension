const ICON_CACHE = {};

async function resolveIcon(size = 128) {
  const key = String(size);
  if (ICON_CACHE[key]) return ICON_CACHE[key];

  const candidates = [
    `icons/icon${size}.png`,
    `icons/icon${size}.svg`,
  ];

  for (const path of candidates) {
    try {
      const response = await fetch(chrome.runtime.getURL(path));
      if (response.ok) {
        ICON_CACHE[key] = path;
        return path;
      }
    } catch (error) {
      console.warn('Icon lookup failed', path, error);
    }
  }

  // Fall back to the last candidate (SVG) so notifications always have an icon.
  const fallback = candidates[candidates.length - 1];
  ICON_CACHE[key] = fallback;
  return fallback;
}

const CHAT_TARGETS = {
  chatgpt: {
    name: 'ChatGPT',
    newChatUrl: 'https://chatgpt.com/?new_chat=true',
    selectors: {
      textarea: [
        'div[contenteditable="true"][data-id="prompt-textarea"]',
        'div[contenteditable="true"][data-testid="prompt-textarea"]',
        'textarea[data-id="prompt-textarea"]',
        'textarea#prompt-textarea',
        'textarea[aria-label="Message ChatGPT"]',
        'textarea[placeholder]',
        'div[contenteditable="true"]',
        'div[role="textbox"]',
        'textarea',
      ],
      sendButton: [
        'button[data-testid="send-button"]',
        'button[aria-label="Send message"]',
        'button[aria-label="Send"]'
      ],
      modelButton: [
        'button[data-testid="model-switcher-button"]',
        'button[aria-haspopup="listbox"][data-testid]'
      ],
    },
  },
  gemini: {
    name: 'Gemini',
    newChatUrl: 'https://gemini.google.com/app',
    selectors: {
      textarea: [
        'textarea[aria-label="Enter a prompt here"]',
        'textarea[aria-label^="Enter a prompt"]',
        'textarea[aria-label]',
        'div[contenteditable="true"]',
        'div[role="textbox"]'
      ],
      sendButton: [
        'button[aria-label="Send message"]',
        'button[data-testid="send-button"]',
        'button[type="submit"]',
        'button[aria-label="Send"]'
      ],
      modelButton: [],
    },
  },
};

async function emitNotification(title, message) {
  const iconUrl = await resolveIcon(128);
  if (chrome.notifications) {
    chrome.notifications.create({ type: 'basic', iconUrl, title, message });
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
          func: (innerSelector) => Boolean(document.querySelector(innerSelector)),
          args: [sel],
        });
        if (result?.result) return true;
      } catch (error) {
        console.warn('waitForElement failed', error);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

async function clickElement(tabId, selector, attempts = 10, delayMs = 500) {
  const selectors = Array.isArray(selector) ? selector : [selector];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    for (const sel of selectors) {
      try {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId },
          func: (innerSelector) => {
            const el = document.querySelector(innerSelector);
            if (!el || el.disabled) return false;
            el.click();
            return true;
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
  return false;
}

async function setTextareaValue(tabId, selector, value, attempts = 20, delayMs = 500) {
  const selectors = Array.isArray(selector) ? selector : [selector];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    for (const sel of selectors) {
      try {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId },
          func: (innerSelector, text) => {
            const el = document.querySelector(innerSelector);
            if (!el) return false;
            if (el.isContentEditable) {
              el.focus();
              el.textContent = text;
              const inputEvent = new InputEvent('input', { bubbles: true, data: text });
              el.dispatchEvent(inputEvent);
            } else {
              const setter = Object.getOwnPropertyDescriptor(el.__proto__, 'value')?.set;
              if (setter) {
                setter.call(el, text);
              } else {
                el.value = text;
              }
            }
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.focus();
            return true;
          },
          args: [sel, value],
        });
        if (result?.result) return true;
      } catch (error) {
        console.warn('setTextareaValue failed', error);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

async function selectChatGPTModel(tabId, selectors, modelName) {
  if (!selectors.modelButton || selectors.modelButton.length === 0) return { ok: true };
  const opened = await clickElement(tabId, selectors.modelButton, 8, 600);
  if (!opened) {
    return { ok: false, reason: 'Model picker not found' };
  }
  try {
    const needle = modelName.trim().toLowerCase();
    for (let i = 0; i < 8; i += 1) {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        func: (name) => {
          const buttons = Array.from(document.querySelectorAll('button, div'));
          const target = buttons.find((b) => {
            const label = (b.innerText || '').trim().toLowerCase();
            return label === name || label.includes(name);
          });
          if (!target) return false;
          target.click();
          return true;
        },
        args: [needle],
      });
      if (result?.result) return { ok: true };
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return { ok: false, reason: 'Model not available' };
  } catch (error) {
    console.warn('selectChatGPTModel failed', error);
    return { ok: false, reason: 'Model selection blocked by permissions' };
  }
}

export { CHAT_TARGETS, emitNotification, setTextareaValue, clickElement, selectChatGPTModel, waitForElement };
