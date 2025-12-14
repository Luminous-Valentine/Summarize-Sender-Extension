const CHAT_TARGETS = {
  chatgpt: {
    name: 'ChatGPT',
    newChatUrl: 'https://chat.openai.com/?new_chat=true',
    selectors: {
      textarea: 'textarea',
      sendButton: 'button[data-testid="send-button"]',
      modelButton: 'button[data-testid="model-switcher-button"]',
    },
  },
  gemini: {
    name: 'Gemini',
    newChatUrl: 'https://gemini.google.com/app',
    selectors: {
      textarea: 'textarea[aria-label], textarea',
      sendButton: 'button[type="submit"], button[aria-label="Send"]',
      modelButton: '',
    },
  },
};

function emitNotification(title, message) {
  if (chrome.notifications) {
    chrome.notifications.create({ type: 'basic', iconUrl: 'icons/icon128.png', title, message });
  } else {
    console.warn(title, message);
  }
}

async function clickElement(tabId, selector) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      el.click();
      return true;
    },
    args: [selector],
  });
  return result?.result;
}

async function setTextareaValue(tabId, selector, value) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel, text) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      el.focus();
      el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    args: [selector, value],
  });
  return result?.result;
}

async function selectChatGPTModel(tabId, selectors, modelName) {
  if (!selectors.modelButton) return { ok: true };
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
