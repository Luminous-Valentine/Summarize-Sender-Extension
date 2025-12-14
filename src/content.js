const SELECTOR_CANDIDATES = [
  'main article',
  'article',
  'main',
  '[role="main"]',
];

function extractReadableText() {
  for (const selector of SELECTOR_CANDIDATES) {
    const node = document.querySelector(selector);
    if (node && node.innerText && node.innerText.trim().length > 200) {
      return node.innerText.trim();
    }
  }
  const bodyText = document.body ? document.body.innerText.trim() : '';
  return bodyText || '';
}

function getSelectionText() {
  const selection = window.getSelection();
  if (!selection) return '';
  return selection.toString();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'extractPage') {
    try {
      const payload = {
        url: window.location.href,
        title: document.title,
        selection: getSelectionText(),
        content: extractReadableText(),
      };
      sendResponse({ ok: true, payload });
    } catch (error) {
      sendResponse({ ok: false, error: String(error) });
    }
  }
  return true;
});
