import { CHAT_TARGETS } from './chatTargets.js';
import { buildMessage, formatTemplate, getSettings } from './storage.js';

let settings;
let pageData = { url: '', title: '', content: '', selection: '' };
let pageStatusEl;
let themeToggleEl;
let previewDirty = false;
let modelStatusEl;
let detectModelsBtn;

async function init() {
  settings = await getSettings();
  pageStatusEl = document.getElementById('pageStatus');
  themeToggleEl = document.getElementById('themeToggle');
  modelStatusEl = document.getElementById('modelStatus');
  detectModelsBtn = document.getElementById('detectModels');
  previewDirty = Boolean(settings.messageOverride);
  applyTheme(settings.theme || 'light');
  await pullPageData();
  populateTemplates();
  populateModels();
  hydrateForm();
  if (previewDirty && settings.messageOverride) {
    const text = document.getElementById('preview').value || settings.messageOverride;
    document.getElementById('charCount').textContent = `${text.length} chars`;
  } else {
    renderPreview({ force: true });
  }
  bindEvents();
  renderModelStatus();
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
  if (!/^https?:\/\//.test(pageData.url)) {
    pageStatusEl.textContent = 'このページでは本文抽出が許可されていません（URLのみ送信されます）';
    pageStatusEl.classList.add('warning');
    return;
  }
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'extractPage' });
    if (response?.ok) {
      pageData = response.payload;
      pageStatusEl.textContent = '';
      pageStatusEl.classList.remove('warning');
    } else {
      pageStatusEl.textContent = 'ページの本文を取得できませんでした（URLのみ送信されます）';
      pageStatusEl.classList.add('warning');
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

function populateModels() {
  const select = document.getElementById('model');
  select.innerHTML = '';
  const autoMode = settings.modelAvailabilityMode === 'auto';
  const betaOn = Boolean(settings.modelDetectionBetaEnabled);
  if (!betaOn) {
    return populateManualModels();
  }
  const sourceModels = autoMode
    ? Array.from(new Set([...(settings.allowedModelsAuto || []), ...(settings.detectedModels || [])]))
    : settings.allowedModelsManual;
  const models = Array.from(new Set([...(sourceModels || []), settings.model].filter(Boolean)));
  models.forEach((model) => {
    const option = document.createElement('option');
    option.value = model;
    option.textContent = model;
    select.appendChild(option);
  });
}

function populateManualModels() {
  const select = document.getElementById('model');
  select.innerHTML = '';
  const models = Array.from(new Set([...(settings.allowedModelsManual || []), settings.model].filter(Boolean)));
  models.forEach((model) => {
    const option = document.createElement('option');
    option.value = model;
    option.textContent = model;
    select.appendChild(option);
  });
}

function hydrateForm() {
  const templateSelect = document.getElementById('template');
  const promptEl = document.getElementById('prompt');
  const previewEl = document.getElementById('preview');
  document.getElementById('target').value = settings.target;
  document.getElementById('mode').value = settings.sendMode;
  document.getElementById('autoSend').checked = settings.autoSend;
  if (themeToggleEl) {
    themeToggleEl.checked = (settings.theme || 'light') === 'dark';
  }
  const betaOn = Boolean(settings.modelDetectionBetaEnabled);
  document.getElementById('model-wrapper').style.display = betaOn ? 'block' : 'none';
  const selectedTemplateId = settings.selectedTemplateId || settings.templates[0]?.id;
  if (selectedTemplateId) {
    templateSelect.value = selectedTemplateId;
  }
  if (!templateSelect.value && templateSelect.options.length > 0) {
    templateSelect.value = templateSelect.options[0].value;
  }
  if (settings.promptDraft) {
    promptEl.value = settings.promptDraft;
  } else {
    applyTemplateToPrompt();
  }
  if (settings.messageOverride) {
    previewEl.value = settings.messageOverride;
  }
  const modelSelect = document.getElementById('model');
  modelSelect.value = settings.model;
  if (!modelSelect.value && modelSelect.options.length > 0) {
    modelSelect.value = modelSelect.options[0].value;
  }
  toggleModelVisibility();
}

function toggleModelVisibility() {
  const wrapper = document.getElementById('model-wrapper');
  if (!settings.modelDetectionBetaEnabled) {
    wrapper.style.display = 'none';
    return;
  }
  const target = document.getElementById('target').value;
  wrapper.style.display = (target === 'chatgpt' || target === 'chatgpt_temp') ? 'block' : 'none';
}

function currentTemplate() {
  const id = document.getElementById('template').value;
  return settings.templates.find((tpl) => tpl.id === id) || settings.templates[0];
}

function applyTemplateToPrompt() {
  const tpl = currentTemplate();
  const promptBody = formatTemplate(tpl.body, pageData);
  document.getElementById('prompt').value = promptBody;
  return promptBody;
}

function renderPreview(options = {}) {
  const force = options.force === true;
  const previewEl = document.getElementById('preview');
  if (previewDirty && !force) {
    const text = previewEl.value || '';
    document.getElementById('charCount').textContent = `${text.length} chars`;
    return;
  }
  const mode = document.getElementById('mode').value;
  const promptBody = document.getElementById('prompt').value;
  const message = buildMessage({ mode, prompt: promptBody, page: pageData });
  previewEl.value = message;
  previewDirty = false;
  if (settings.messageOverride) {
    persistSettings({ messageOverride: '' });
  }
  document.getElementById('charCount').textContent = `${message.length} chars`;
  renderModelStatus();
}

function bindEvents() {
  document.getElementById('template').addEventListener('change', () => {
    applyTemplateToPrompt();
    persistSettings({ selectedTemplateId: document.getElementById('template').value, promptDraft: document.getElementById('prompt').value });
    renderPreview();
  });
  document.getElementById('mode').addEventListener('change', () => {
    persistSettings({ sendMode: document.getElementById('mode').value });
    renderPreview();
  });
  document.getElementById('target').addEventListener('change', () => {
    toggleModelVisibility();
    persistSettings({ target: document.getElementById('target').value });
    renderPreview();
    renderModelStatus();
  });
  document.getElementById('prompt').addEventListener('input', () => {
    persistSettings({ promptDraft: document.getElementById('prompt').value });
    renderPreview();
  });
  document.getElementById('model').addEventListener('change', () => {
    persistSettings({ model: document.getElementById('model').value });
    renderModelStatus();
  });
  document.getElementById('autoSend').addEventListener('change', () => {
    persistSettings({ autoSend: document.getElementById('autoSend').checked });
  });
  if (detectModelsBtn) {
    detectModelsBtn.addEventListener('click', detectModelsNow);
  }
  document.getElementById('preview').addEventListener('input', handlePreviewEdit);
  document.getElementById('regenPreview').addEventListener('click', handlePreviewRegen);
  document.getElementById('execute').addEventListener('click', executeSend);
  document.getElementById('openOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());
  if (themeToggleEl) {
    themeToggleEl.addEventListener('change', handleThemeToggle);
  }
}

async function detectModelsNow() {
  if (settings.modelAvailabilityMode !== 'auto') {
    renderModelStatus('手動モードでは自動検出を行いません');
    return;
  }
  if (!settings.modelDetectionBetaEnabled) {
    renderModelStatus('ベータ機能がOFFです');
    return;
  }
  const target = document.getElementById('target').value;
  if (target !== 'chatgpt' && target !== 'chatgpt_temp') {
    renderModelStatus('ChatGPT選択時のみ検出できます');
    return;
  }
  if (detectModelsBtn) detectModelsBtn.disabled = true;
  renderModelStatus('モデル検出中...');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      renderModelStatus('タブが見つかりませんでした');
      return;
    }
    if (!/^https?:\/\/(chatgpt\.com|chat\.openai\.com)/.test(tab.url || '')) {
      renderModelStatus('ChatGPTを開いてから再検出してください');
      return;
    }
    const resp = await chrome.runtime.sendMessage({ type: 'detectChatGPTModels', tabId: tab.id, target });
    if (resp?.ok && Array.isArray(resp.models) && resp.models.length > 0) {
      settings.detectedModels = resp.models;
      populateModels();
      renderModelStatus(`自動検出: ${resp.models.join(', ')}`);
    } else {
      renderModelStatus('検出できませんでした（ChatGPT画面で開いてから再試行）');
    }
  } catch (error) {
    console.warn('detectModelsNow failed', error);
    renderModelStatus('検出に失敗しました');
  } finally {
    if (detectModelsBtn) detectModelsBtn.disabled = false;
  }
}

function renderModelStatus(forcedText) {
  if (!modelStatusEl) return;
  const mode = settings.modelAvailabilityMode;
  const target = document.getElementById('target').value;
  if (!settings.modelDetectionBetaEnabled) {
    modelStatusEl.textContent = '';
    return;
  }
  if (target !== 'chatgpt' && target !== 'chatgpt_temp') {
    modelStatusEl.textContent = '';
    return;
  }
  if (mode !== 'auto') {
    modelStatusEl.textContent = '手動リストを使用中';
    return;
  }
  if (forcedText) {
    modelStatusEl.textContent = forcedText;
    return;
  }
  if (settings.detectedModels && settings.detectedModels.length > 0) {
    modelStatusEl.textContent = `自動検出: ${settings.detectedModels.join(', ')}`;
  } else {
    modelStatusEl.textContent = '未検出: 送信時または「再検出」で更新';
  }
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
    messageOverride: previewDirty ? document.getElementById('preview').value : '',
    page: pageData,
  };
  const targetConfig = CHAT_TARGETS[payload.target];
  const targetUrl = resolveTargetUrl(payload.target, settings);
  if (targetUrl) {
    const granted = await ensurePermissionForUrl(targetUrl);
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
      return;
    }
    const result = response.result || {};
    const warnings = [];
    if (result.truncated) warnings.push('本文が長いため切り詰めました。');
    if (payload.target === 'chatgpt' && result.modelSelected === false) {
      warnings.push(`モデル選択に失敗しました（入力は継続）: ${result.modelReason || 'unknown'}`);
    }
    if (payload.target === 'gemini' && payload.mode === 'content' && result.gemini) {
      if (result.gemini.truncated) warnings.push('Geminiは本文が長いため短縮して入力しました。');
      if (result.gemini.variant && result.gemini.variant !== 'fenced') {
        warnings.push(`Gemini入力方式: ${result.gemini.variant}`);
      }
      if (result.gemini.needleLength && result.gemini.needleFound === false) {
        warnings.push('Gemini本文の入力検証に失敗しました（本文が貼り付いていない可能性があります）。');
      }
      if (result.gemini.observedTag) {
        warnings.push(`Gemini入力要素: ${result.gemini.observedTag}${result.gemini.observedContentEditable ? ' (contenteditable)' : ''}`);
      }
    }
    if (result.status && result.status !== 'sent' && result.status !== 'input-only') {
      warnings.unshift(`送信結果: ${result.status}`);
    }
    if (warnings.length > 0) {
      pageStatusEl.textContent = warnings.join(' ');
      pageStatusEl.classList.add('warning');
    } else {
      pageStatusEl.textContent = '';
      pageStatusEl.classList.remove('warning');
    }
  } catch (error) {
    alert(`送信に失敗しました: ${error?.message || error}`);
  }
}

document.addEventListener('DOMContentLoaded', init);

function applyTheme(theme) {
  const mode = theme === 'dark' ? 'dark' : 'light';
  document.body.classList.toggle('theme-dark', mode === 'dark');
  settings.theme = mode;
  if (themeToggleEl) {
    themeToggleEl.checked = mode === 'dark';
  }
}

async function handleThemeToggle() {
  const mode = themeToggleEl?.checked ? 'dark' : 'light';
  applyTheme(mode);
  try {
    await chrome.storage.local.set({ theme: mode });
  } catch (error) {
    console.warn('Failed to persist theme', error);
  }
}

async function persistSettings(partial) {
  try {
    await chrome.storage.local.set(partial);
    Object.assign(settings, partial);
  } catch (error) {
    console.warn('Failed to persist popup settings', error);
  }
}

function handlePreviewEdit() {
  previewDirty = true;
  const text = document.getElementById('preview').value;
  persistSettings({ messageOverride: text });
  document.getElementById('charCount').textContent = `${text.length} chars`;
}

function handlePreviewRegen() {
  previewDirty = false;
  persistSettings({ messageOverride: '' });
  renderPreview({ force: true });
}

function resolveTargetUrl(targetKey, currentSettings) {
  const target = CHAT_TARGETS[targetKey];
  if (!target) return '';
  if (targetKey === 'gemini') {
    const idx = Math.max(0, Math.floor(Number(currentSettings?.geminiAccountIndex ?? 0)));
    return `https://gemini.google.com/u/${idx}/app`;
  }
  return target.newChatUrl;
}
