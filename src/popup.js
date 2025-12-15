import { CHAT_TARGETS } from './chatTargets.js';
import { buildMessage, formatTemplate, getSettings } from './storage.js';

let settings;
let pageData = { url: '', title: '', content: '', selection: '' };
let pageStatusEl;

async function init() {
  settings = await getSettings();
  pageStatusEl = document.getElementById('pageStatus');
  await pullPageData();
  populateTemplates();
  hydrateForm();
  applyTemplate();
  renderPreview();
  bindEvents();
}

async function ensurePermissionForUrl(rawUrl) {
  if (!rawUrl) return false;
  try {
    const url = new URL(rawUrl);
    const originPattern = `${url.origin}/*`;
    const perm = { origins: [originPattern] };
    const hasPermission = await new Promise((resolve) => chrome.permissions.contains(perm, (granted) => resolve(Boolean(granted))));
    if (hasPermission) return true;
    return new Promise((resolve) => chrome.permissions.request(perm, (granted) => resolve(Boolean(granted))));
  } catch (error) {
    console.warn('Permission request failed', error);
    return false;
  }
}

async function pullPageData() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  pageData.url = tab.url || '';
  pageData.title = tab.title || '';
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'extractPage' });
    if (response?.ok) {
      pageData = response.payload;
      pageStatusEl.textContent = '';
      pageStatusEl.classList.remove('warning');
    }
  } catch (error) {
    console.warn('Unable to read page data', error);
    pageStatusEl.textContent = 'ページの本文を取得できませんでした（URLのみ送信されます）';
    pageStatusEl.classList.add('warning');
  }
}

function populateTemplates() {
  const select = document.getElementById('template');
  select.innerHTML = '';
  settings.templates.forEach((tpl) => {
    const option = document.createElement('option');
    option.value = tpl.id;
    option.textContent = tpl.name;
    select.appendChild(option);
  });
}

function hydrateForm() {
  document.getElementById('target').value = settings.target;
  document.getElementById('mode').value = settings.sendMode;
  document.getElementById('autoSend').checked = settings.autoSend;
  document.getElementById('model').value = settings.model;
  toggleModelVisibility();
}

function toggleModelVisibility() {
  const wrapper = document.getElementById('model-wrapper');
  const target = document.getElementById('target').value;
  wrapper.style.display = target === 'chatgpt' ? 'block' : 'none';
}

function currentTemplate() {
  const id = document.getElementById('template').value;
  return settings.templates.find((tpl) => tpl.id === id) || settings.templates[0];
}

function applyTemplate() {
  const tpl = currentTemplate();
  const promptBody = formatTemplate(tpl.body, pageData);
  document.getElementById('prompt').value = promptBody;
}

function renderPreview() {
  const mode = document.getElementById('mode').value;
  const promptBody = document.getElementById('prompt').value;
  const message = buildMessage({ mode, prompt: promptBody, page: pageData });
  document.getElementById('preview').textContent = message;
  document.getElementById('charCount').textContent = `${message.length} chars`;
}

function bindEvents() {
  document.getElementById('template').addEventListener('change', () => { applyTemplate(); renderPreview(); });
  document.getElementById('mode').addEventListener('change', renderPreview);
  document.getElementById('target').addEventListener('change', () => {
    toggleModelVisibility();
    renderPreview();
  });
  document.getElementById('prompt').addEventListener('input', renderPreview);
  document.getElementById('execute').addEventListener('click', executeSend);
  document.getElementById('openOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());
}

async function executeSend() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url) {
    const granted = await ensurePermissionForUrl(tab.url);
    if (!granted) {
      alert('このページへのアクセス権がありません。権限を許可してから再試行してください。');
      return;
    }
    await pullPageData();
  }

  const payload = {
    target: document.getElementById('target').value,
    model: document.getElementById('model').value,
    mode: document.getElementById('mode').value,
    autoSend: document.getElementById('autoSend').checked,
    prompt: document.getElementById('prompt').value,
    page: pageData,
  };
  const targetConfig = CHAT_TARGETS[payload.target];
  if (targetConfig?.newChatUrl) {
    const granted = await ensurePermissionForUrl(targetConfig.newChatUrl);
    if (!granted) {
      alert('送信先サイトへのアクセス権がありません。権限を許可してから再試行してください。');
      return;
    }
  }
  chrome.storage.local.set({
    target: payload.target,
    model: payload.model,
    sendMode: payload.mode,
    autoSend: payload.autoSend,
  });
  try {
    const response = await chrome.runtime.sendMessage({ type: 'executeSend', payload });
    if (!response?.ok) {
      alert(`送信に失敗しました: ${response?.error || 'Unknown error'}`);
    }
  } catch (error) {
    alert(`送信に失敗しました: ${error?.message || error}`);
  }
}

document.addEventListener('DOMContentLoaded', init);
