import { getSettings, saveSettings, upsertTemplate, removeTemplate } from './storage.js';

let settings;

async function init() {
  settings = await getSettings();
  renderTemplates();
  fillSettings();
  bindEvents();
}

function renderTemplates() {
  const container = document.getElementById('templateList');
  container.innerHTML = '';
  settings.templates.forEach((tpl) => {
    const btn = document.createElement('button');
    btn.textContent = tpl.name;
    btn.addEventListener('click', () => selectTemplate(tpl));
    container.appendChild(btn);
  });
}

function selectTemplate(tpl) {
  document.getElementById('templateName').value = tpl.name;
  document.getElementById('templateId').value = tpl.id;
  document.getElementById('templateBody').value = tpl.body;
}

function fillSettings() {
  document.getElementById('maxChars').value = settings.maxCharacters;
  document.getElementById('truncateStrategy').value = settings.truncateStrategy;
  document.getElementById('retryCount').value = settings.retryCount;
  document.getElementById('retryIntervalMs').value = settings.retryIntervalMs;
  document.getElementById('modelAvailabilityMode').value = settings.modelAvailabilityMode;
  document.getElementById('allowedModels').value = settings.allowedModelsManual.join(',');
  document.getElementById('allowedModelsAuto').value = settings.allowedModelsAuto.join(',');
  document.getElementById('extractionMode').value = settings.extractionMode;
  document.getElementById('domainExceptionsReadability').value = settings.domainExceptionsReadability.join(',');
  document.getElementById('domainExceptionsRaw').value = settings.domainExceptionsRaw.join(',');
  document.getElementById('geminiAccountIndex').value = settings.geminiAccountIndex ?? 0;
  document.getElementById('modelDetectionBeta').checked = Boolean(settings.modelDetectionBetaEnabled);
  toggleModelTextareas();
  toggleDomainTextareas();
}

function bindEvents() {
  document.getElementById('saveTemplate').addEventListener('click', async () => {
    const tpl = {
      id: document.getElementById('templateId').value || crypto.randomUUID(),
      name: document.getElementById('templateName').value || 'Untitled',
      body: document.getElementById('templateBody').value || '',
    };
    settings = await upsertTemplate(tpl);
    renderTemplates();
    selectTemplate(tpl);
    flashStatus('Template saved');
  });
  document.getElementById('deleteTemplate').addEventListener('click', async () => {
    const id = document.getElementById('templateId').value;
    if (!id) return;
    settings = await removeTemplate(id);
    renderTemplates();
    flashStatus('Template deleted');
  });
  document.getElementById('save').addEventListener('click', saveAll);
  document.getElementById('modelAvailabilityMode').addEventListener('change', toggleModelTextareas);
  document.getElementById('extractionMode').addEventListener('change', toggleDomainTextareas);
}

async function saveAll() {
  const next = {
    maxCharacters: Number(document.getElementById('maxChars').value) || settings.maxCharacters,
    truncateStrategy: document.getElementById('truncateStrategy').value,
    retryCount: Number(document.getElementById('retryCount').value) || 1,
    retryIntervalMs: Number(document.getElementById('retryIntervalMs').value) || 500,
    modelAvailabilityMode: document.getElementById('modelAvailabilityMode').value,
    allowedModelsManual: document.getElementById('allowedModels').value.split(',').map((m) => m.trim()).filter(Boolean),
    allowedModelsAuto: document.getElementById('allowedModelsAuto').value.split(',').map((m) => m.trim()).filter(Boolean),
    extractionMode: document.getElementById('extractionMode').value,
    domainExceptionsReadability: document.getElementById('domainExceptionsReadability').value.split(',').map((d) => d.trim()).filter(Boolean),
    domainExceptionsRaw: document.getElementById('domainExceptionsRaw').value.split(',').map((d) => d.trim()).filter(Boolean),
    geminiAccountIndex: Math.max(0, Math.floor(Number(document.getElementById('geminiAccountIndex').value) || 0)),
    modelDetectionBetaEnabled: document.getElementById('modelDetectionBeta').checked,
  };
  // 自動用の編集内容を検出リストにも反映（削除も反映）
  next.detectedModels = next.allowedModelsAuto;
  settings = await saveSettings(next);
  flashStatus('Saved');
}

function toggleModelTextareas() {
  const mode = document.getElementById('modelAvailabilityMode').value;
  const manualVisible = mode === 'manual';
  const autoVisible = mode === 'auto';
  document.getElementById('allowedModels').style.display = manualVisible ? 'block' : 'none';
  document.getElementById('allowedModelsAuto').style.display = autoVisible ? 'block' : 'none';
  const autoHint = document.getElementById('allowedModelsAutoHint');
  if (autoHint) autoHint.style.display = autoVisible ? 'block' : 'none';
}

function toggleDomainTextareas() {
  const mode = document.getElementById('extractionMode').value;
  document.getElementById('domainExceptionsReadability').style.display = (mode === 'readability-first') ? 'block' : 'none';
  document.getElementById('domainExceptionsRaw').style.display = (mode === 'raw') ? 'block' : 'none';
}

function flashStatus(text) {
  const el = document.getElementById('status');
  el.textContent = text;
  setTimeout(() => { el.textContent = ''; }, 1500);
}

document.addEventListener('DOMContentLoaded', init);
