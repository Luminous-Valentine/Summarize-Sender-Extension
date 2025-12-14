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
  document.getElementById('allowedModels').value = settings.allowedModels.join(',');
  document.getElementById('extractionMode').value = settings.extractionMode;
  document.getElementById('domainExceptions').value = settings.domainExceptions.join(',');
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
}

async function saveAll() {
  const next = {
    maxCharacters: Number(document.getElementById('maxChars').value) || settings.maxCharacters,
    truncateStrategy: document.getElementById('truncateStrategy').value,
    retryCount: Number(document.getElementById('retryCount').value) || 1,
    retryIntervalMs: Number(document.getElementById('retryIntervalMs').value) || 500,
    modelAvailabilityMode: document.getElementById('modelAvailabilityMode').value,
    allowedModels: document.getElementById('allowedModels').value.split(',').map((m) => m.trim()).filter(Boolean),
    extractionMode: document.getElementById('extractionMode').value,
    domainExceptions: document.getElementById('domainExceptions').value.split(',').map((d) => d.trim()).filter(Boolean),
  };
  settings = await saveSettings(next);
  flashStatus('Saved');
}

function flashStatus(text) {
  const el = document.getElementById('status');
  el.textContent = text;
  setTimeout(() => { el.textContent = ''; }, 1500);
}

document.addEventListener('DOMContentLoaded', init);
