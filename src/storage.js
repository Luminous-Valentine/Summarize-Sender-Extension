const DEFAULT_SETTINGS = {
  autoSend: false,
  sendMode: 'url',
  target: 'chatgpt',
  model: 'gpt-4o',
  maxCharacters: 12000,
  truncateStrategy: 'truncate',
  retryCount: 1,
  retryIntervalMs: 800,
  extractionMode: 'readability-first',
  domainExceptionsReadability: [],
  domainExceptionsRaw: [],
  modelAvailabilityMode: 'auto',
  theme: 'light',
  selectedTemplateId: 'default',
  promptDraft: '',
  geminiAccountIndex: 0,
  messageOverride: '',
  detectedModels: [],
  modelDetectionBetaEnabled: false,
  allowedModelsManual: [],
  allowedModelsAuto: [],
  allowedModels: [
    'gpt-4o',
    'gpt-4o-mini',
    'o1',
    'o1-mini',
    'o3-mini',
    'o3-mini-high',
  ],
  templates: [
    {
      id: 'default',
      name: 'Summarize the page',
      body: 'Please summarize the main points from {title} ({url}).'
    },
    {
      id: 'code',
      name: 'Explain the code',
      body: 'Explain the code found at {url} focusing on purpose, flow, and risks.'
    }
  ],
};

async function getSettings() {
  const stored = await chrome.storage.local.get();
  const merged = { ...DEFAULT_SETTINGS, ...stored };
  if (!Array.isArray(merged.templates) || merged.templates.length === 0) {
    merged.templates = DEFAULT_SETTINGS.templates;
  }
  merged.allowedModelsManual = merged.allowedModelsManual?.length ? merged.allowedModelsManual : (merged.allowedModels?.length ? merged.allowedModels : DEFAULT_SETTINGS.allowedModels);
  merged.allowedModelsAuto = merged.allowedModelsAuto?.length ? merged.allowedModelsAuto : merged.allowedModelsManual;
  merged.detectedModels = Array.isArray(merged.detectedModels) ? merged.detectedModels : [];
  merged.allowedModels = merged.allowedModelsManual; // backward compatibility
  await chrome.storage.local.set(merged);
  return merged;
}

async function saveSettings(partial) {
  const current = await getSettings();
  const next = { ...current, ...partial };
  await chrome.storage.local.set(next);
  return next;
}

async function upsertTemplate(template) {
  const settings = await getSettings();
  const without = settings.templates.filter((t) => t.id !== template.id);
  const templates = [...without, template];
  return saveSettings({ templates });
}

async function removeTemplate(templateId) {
  const settings = await getSettings();
  const templates = settings.templates.filter((t) => t.id !== templateId);
  return saveSettings({ templates });
}

function formatTemplate(body, vars) {
  let result = body;
  Object.entries(vars).forEach(([key, value]) => {
    const token = `{${key}}`;
    result = result.split(token).join(value ?? '');
  });
  return result;
}

function buildMessage({ mode, prompt, page }) {
  const contentBlock = '```text\n' + (page.content || '') + '\n```';
  const base = `${prompt}\n${mode === 'url' ? page.url : contentBlock}`;
  return base.trim();
}

function enforceSizeLimit(text, maxCharacters, strategy = 'truncate') {
  if (text.length <= maxCharacters) {
    return { text, truncated: false, aborted: false };
  }
  if (strategy === 'abort') {
    return { text, truncated: false, aborted: true };
  }
  const truncated = text.slice(0, Math.max(0, maxCharacters - 14));
  return { text: `${truncated}\n[TRUNCATED]`, truncated: true, aborted: false };
}

export {
  DEFAULT_SETTINGS,
  getSettings,
  saveSettings,
  upsertTemplate,
  removeTemplate,
  formatTemplate,
  buildMessage,
  enforceSizeLimit,
};
