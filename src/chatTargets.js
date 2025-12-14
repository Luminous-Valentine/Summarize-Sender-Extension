const CHAT_TARGETS = {
  chatgpt: {
    name: 'ChatGPT',
    newChatUrl: 'https://chatgpt.com/?new_chat=true',
    selectors: {
      textarea: [
        'textarea[data-id="prompt-textarea"]',
        'textarea#prompt-textarea',
        'textarea[aria-label="Message ChatGPT"]',
        'textarea',
      ],
      sendButton: [
        'button[data-testid="send-button"]',
        'button[aria-label="Send message"]',
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
        'textarea[aria-label]'
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

function emitNotification(title, message) {
  if (chrome.notifications) {
    chrome.notifications.create({ type: 'basic', iconUrl: 'icons/icon128.svg', title, message });
  } else {
    console.warn(title, message);
  }
}

async function clickElement(tabId, selector) {
  const selectors = Array.isArray(selector) ? selector : [selector];
  for (const sel of selectors) {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (innerSelector) => {
        const el = document.querySelector(innerSelector);
        if (!el) return false;
        el.click();
        return true;
      },
      args: [sel],
    });
    if (result?.result) return true;
  }
  return false;
}

async function setTextareaValue(tabId, selector, value) {
  const selectors = Array.isArray(selector) ? selector : [selector];
  for (const sel of selectors) {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (innerSelector, text) => {
        const el = document.querySelector(innerSelector);
        if (!el) return false;
        el.focus();
        el.value = text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      },
      args: [sel, value],
    });
    if (result?.result) return true;
  }
  return false;
}

async function selectChatGPTModel(tabId, selectors, modelName) {
  if (!selectors.modelButton || selectors.modelButton.length === 0) return { ok: true };
  const opened = await clickElement(tabId, selectors.modelButton);
  if (!opened) {
    return { ok: false, reason: 'Model picker not found' };
  }
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (name) => {
      const buttons = Array.from(document.querySelectorAll('button, div'));
      const target = buttons.find((b) => (b.innerText || '').trim() === name);
      if (!target) return false;
      target.click();
      return true;
    },
    args: [modelName],
  });
  if (!result?.result) {
    return { ok: false, reason: 'Model not available' };
  }
  return { ok: true };
}

export { CHAT_TARGETS, emitNotification, setTextareaValue, clickElement, selectChatGPTModel };
