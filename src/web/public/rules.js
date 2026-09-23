import { fetchJson, sendJson } from './api.js';

const RULE_TYPES = [
  'path',
  'tag',
  'category',
  'frontmatter',
  'frontmatterField',
  'privacy',
  'content',
  'fileMeta',
];
const NODE_TYPES = ['rule', 'all', 'any', 'not'];
const CONDITION_OPERATORS = [
  'exists',
  'notExists',
  'truthy',
  'equals',
  'notEquals',
  'in',
  'notIn',
  'contains',
  'matches',
  'gt',
  'gte',
  'lt',
  'lte',
];
const TAG_SOURCES = ['frontmatter', 'inline', 'task', 'both', 'all'];

const state = {
  activeTab: 'form',
  etag: null,
  originalText: '',
  currentText: '',
  currentDocument: null,
  loading: true,
  readOnly: false,
  saving: false,
  validating: false,
  validation: {
    valid: false,
    errors: [],
    warnings: [],
    needsMigration: false,
    parsedDocument: null,
    migratedDocument: null,
  },
  saveMessage: '',
};

const elements = {
  addDefinitionButton: document.getElementById('add-definition-button'),
  banner: document.getElementById('rules-banner'),
  diffOutput: document.getElementById('diff-output'),
  formDisabledMessage: document.getElementById('form-disabled-message'),
  formEditor: document.getElementById('form-editor'),
  formPanel: document.getElementById('form-panel'),
  meta: document.getElementById('rules-meta'),
  migrateButton: document.getElementById('migrate-button'),
  rawEditor: document.getElementById('raw-editor'),
  rawPanel: document.getElementById('raw-panel'),
  reloadButton: document.getElementById('reload-button'),
  saveButton: document.getElementById('save-button'),
  saveStatus: document.getElementById('save-status'),
  tabForm: document.getElementById('tab-form'),
  tabRaw: document.getElementById('tab-raw'),
  validationOutput: document.getElementById('validation-output'),
};

let validateTimer = null;

function clone(value) {
  return value === null || value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function serializeDocument(document) {
  return `${JSON.stringify(document, null, 2)}\n`;
}

function readLines(value) {
  return value
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function toMultiline(values) {
  return Array.isArray(values) && values.length > 0 ? values.join('\n') : '';
}

function parseLooseJsonValue(value) {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;

  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

function formatLooseJsonValue(value) {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function createElement(tagName, options = {}, children = []) {
  const element = document.createElement(tagName);
  if (options.className) element.className = options.className;
  if (options.textContent !== undefined) element.textContent = options.textContent;
  if (options.html !== undefined) element.innerHTML = options.html;
  if (options.attributes) {
    for (const [name, value] of Object.entries(options.attributes)) {
      if (value !== null && value !== undefined) {
        element.setAttribute(name, String(value));
      }
    }
  }
  if (options.listeners) {
    for (const [eventName, listener] of Object.entries(options.listeners)) {
      element.addEventListener(eventName, listener);
    }
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    element.append(child);
  }
  return element;
}

function createField(label, control, description = null) {
  const labelElement = createElement('label', { className: 'field-block' });
  labelElement.append(createElement('span', { className: 'field-label', textContent: label }));
  labelElement.append(control);
  if (description) {
    labelElement.append(createElement('span', { className: 'field-hint', textContent: description }));
  }
  return labelElement;
}

function createInput(type, value, listener, attributes = {}) {
  return createElement('input', {
    className: 'text-input',
    attributes: {
      type,
      ...(value !== undefined && value !== null ? { value } : {}),
      ...attributes,
    },
    listeners: { input: listener },
  });
}

function createCheckbox(label, checked, listener) {
  const input = createElement('input', {
    attributes: { type: 'checkbox' },
    listeners: { change: listener },
  });
  input.checked = Boolean(checked);
  return createElement('label', { className: 'checkbox-field' }, [
    input,
    createElement('span', { textContent: label }),
  ]);
}

function createTextarea(value, listener, attributes = {}) {
  const textarea = createElement('textarea', {
    className: 'text-area',
    textContent: value ?? '',
    attributes,
    listeners: { input: listener },
  });
  textarea.value = value ?? '';
  return textarea;
}

function createSelect(value, options, listener) {
  const select = createElement('select', {
    className: 'text-input',
    listeners: { change: listener },
  });
  for (const optionValue of options) {
    const option = createElement('option', {
      textContent: optionValue,
      attributes: { value: optionValue },
    });
    if (optionValue === value) {
      option.selected = true;
    }
    select.append(option);
  }
  return select;
}

function createButton(text, listener, className = '') {
  return createElement('button', {
    className,
    textContent: text,
    attributes: { type: 'button' },
    listeners: { click: listener },
  });
}

function ruleKind(definition) {
  if (definition && typeof definition === 'object' && 'type' in definition) {
    return definition.type;
  }
  if ('all' in definition) return 'all';
  if ('any' in definition) return 'any';
  if ('not' in definition) return 'not';
  return 'rule';
}

function defaultRuleDefinition(type) {
  switch (type) {
    case 'path':
      return { type: 'path', include: [], exclude: [] };
    case 'tag':
      return { type: 'tag', allowList: [], ignoreList: [], source: 'both' };
    case 'category':
      return { type: 'category', allowList: [], ignoreList: [] };
    case 'frontmatter':
      return { type: 'frontmatter' };
    case 'frontmatterField':
      return {
        type: 'frontmatterField',
        mode: 'all',
        conditions: [{ field: '', op: 'equals', value: '' }],
      };
    case 'privacy':
      return { type: 'privacy', allowPrivate: false };
    case 'content':
      return { type: 'content', includePatterns: [], excludePatterns: [], mode: 'any' };
    case 'fileMeta':
      return { type: 'fileMeta', extensions: [] };
    default:
      return { type: 'path', include: [], exclude: [] };
  }
}

function defaultNode(type = 'rule') {
  switch (type) {
    case 'all':
      return { all: [{ rule: '' }] };
    case 'any':
      return { any: [{ rule: '' }] };
    case 'not':
      return { not: { rule: '' } };
    default:
      return { rule: '' };
  }
}

function ensureRulesSection(document) {
  if (!document.rules || typeof document.rules !== 'object') {
    document.rules = {};
  }
  if (!document.rules.definitions || typeof document.rules.definitions !== 'object') {
    document.rules.definitions = {};
  }
}

function ensureCurrentDocument() {
  if (state.currentDocument) return state.currentDocument;
  return {
    rulesVersion: 2,
    rules: { definitions: {}, match: { all: [] } },
  };
}

function updateDocument(mutator) {
  const nextDocument = clone(ensureCurrentDocument());
  if (!nextDocument.rulesVersion) {
    nextDocument.rulesVersion = 2;
  }
  ensureRulesSection(nextDocument);
  mutator(nextDocument);
  applyDocumentState(nextDocument, { validateImmediately: true, saveMessage: '' });
}

function applyDocumentState(nextDocument, options = {}) {
  state.currentDocument = nextDocument;
  state.currentText = serializeDocument(nextDocument);
  elements.rawEditor.value = state.currentText;
  state.saveMessage = options.saveMessage ?? state.saveMessage;
  renderMeta();
  renderDiff();
  renderForm();
  scheduleValidation(nextDocument, options.validateImmediately === true);
}

function buildValidationState(payload) {
  return {
    valid: true,
    errors: [],
    warnings: payload.warnings ?? [],
    needsMigration: Boolean(payload.needsMigration),
    parsedDocument: payload.parsedDocument ?? null,
    migratedDocument: payload.needsMigration ? payload.parsedDocument ?? null : null,
  };
}

function setLoadedRules(payload) {
  state.loading = false;
  state.readOnly = Boolean(payload.readOnly);
  state.saving = false;
  state.validating = false;
  state.etag = payload.etag;
  state.originalText = payload.rawText ?? serializeDocument(payload.document);
  state.currentText = state.originalText;
  elements.rawEditor.value = state.currentText;
  state.validation = buildValidationState(payload);
  state.currentDocument = payload.needsMigration ? null : clone(payload.parsedDocument ?? payload.document);
  state.saveMessage = '';
  renderAll();
}

function setTab(tabName) {
  state.activeTab = tabName;
  const showingForm = tabName === 'form';
  elements.formPanel.classList.toggle('hidden', !showingForm);
  elements.rawPanel.classList.toggle('hidden', showingForm);
  elements.tabForm.classList.toggle('tab-button-active', showingForm);
  elements.tabRaw.classList.toggle('tab-button-active', !showingForm);
  elements.tabForm.setAttribute('aria-selected', showingForm ? 'true' : 'false');
  elements.tabRaw.setAttribute('aria-selected', showingForm ? 'false' : 'true');
}

function renderAll() {
  renderBanner();
  renderMeta();
  renderValidation();
  renderDiff();
  renderForm();
}

function renderBanner() {
  if (state.loading) {
    elements.banner.textContent = 'Loading rules…';
    elements.banner.className = 'notice';
    return;
  }

  if (state.readOnly) {
    elements.banner.textContent = 'Read-only mode is enabled. Review rules here, but use the CLI or restart without WEB_UI_READONLY to save changes.';
    elements.banner.className = 'notice notice-warning';
    return;
  }

  if (state.validation.needsMigration) {
    elements.banner.textContent = 'This file still uses the legacy v1 schema. Migrate your working copy to rulesVersion 2 before saving.';
    elements.banner.className = 'notice notice-warning';
    return;
  }

  if (!state.validation.valid) {
    elements.banner.textContent = 'Fix validation errors before saving.';
    elements.banner.className = 'notice notice-error';
    return;
  }

  elements.banner.textContent = '';
  elements.banner.className = 'notice hidden';
}

function renderMeta() {
  const dirty = state.currentText !== state.originalText;
  const versionLabel = state.validation.needsMigration ? 'v1 loaded (migration required)' : 'v2';
  const validationLabel = state.validating
    ? 'validating…'
    : state.validation.valid
      ? 'valid'
      : 'invalid';

  elements.meta.textContent = state.loading
    ? 'Loading…'
    : `ETag ${state.etag ?? '—'} · ${versionLabel} · ${validationLabel}${dirty ? ' · unsaved changes' : ''}`;

  elements.saveButton.disabled =
    state.loading ||
    state.readOnly ||
    state.saving ||
    state.validating ||
    !dirty ||
    !state.validation.valid ||
    state.validation.needsMigration;
  elements.reloadButton.disabled = state.loading || state.saving;
  elements.addDefinitionButton.disabled =
    state.loading || state.readOnly || state.validation.needsMigration;
  elements.migrateButton.classList.toggle(
    'hidden',
    !state.validation.needsMigration || !state.validation.migratedDocument
  );
  elements.migrateButton.disabled = state.loading || state.readOnly;
  elements.rawEditor.disabled = state.readOnly;
  elements.saveStatus.textContent = state.saveMessage;
  elements.saveStatus.className =
    state.saveMessage && state.validation.valid ? 'status-message status-success' : 'status-message muted';
}

function renderValidation() {
  elements.validationOutput.replaceChildren();

  if (state.validating) {
    elements.validationOutput.append(createElement('p', { className: 'muted', textContent: 'Validating…' }));
  }

  if (state.validation.valid) {
    elements.validationOutput.append(
      createElement('p', { className: 'status-success', textContent: 'Document is valid.' })
    );
  }

  if (state.validation.errors.length > 0) {
    const list = createElement('ul', { className: 'message-list' });
    for (const error of state.validation.errors) {
      list.append(
        createElement('li', {
          className: 'status-error',
          textContent: error.path ? `${error.path}: ${error.message}` : error.message,
        })
      );
    }
    elements.validationOutput.append(list);
  }

  if (state.validation.warnings.length > 0) {
    const list = createElement('ul', { className: 'message-list' });
    for (const warning of state.validation.warnings) {
      list.append(createElement('li', { className: 'status-warning', textContent: warning }));
    }
    elements.validationOutput.append(list);
  }

  if (
    !state.validating &&
    !state.validation.valid &&
    state.validation.errors.length === 0 &&
    state.loading
  ) {
    elements.validationOutput.append(
      createElement('p', { className: 'muted', textContent: 'Loading validation state…' })
    );
  }
}

function createLineDiff(beforeText, afterText) {
  if (beforeText === afterText) {
    return 'No pending changes.';
  }

  const beforeLines = beforeText.split('\n');
  const afterLines = afterText.split('\n');
  const rows = [];
  let beforeIndex = 0;
  let afterIndex = 0;

  while (beforeIndex < beforeLines.length || afterIndex < afterLines.length) {
    const beforeLine = beforeLines[beforeIndex];
    const afterLine = afterLines[afterIndex];

    if (beforeLine === afterLine) {
      rows.push(`  ${beforeLine ?? ''}`);
      beforeIndex += 1;
      afterIndex += 1;
      continue;
    }

    const nextAfterMatch = beforeLine === undefined ? -1 : afterLines.indexOf(beforeLine, afterIndex + 1);
    const nextBeforeMatch = afterLine === undefined ? -1 : beforeLines.indexOf(afterLine, beforeIndex + 1);

    if (beforeLine !== undefined && (nextAfterMatch === -1 || (nextBeforeMatch !== -1 && nextBeforeMatch < nextAfterMatch))) {
      rows.push(`- ${beforeLine}`);
      beforeIndex += 1;
      continue;
    }

    if (afterLine !== undefined) {
      rows.push(`+ ${afterLine}`);
      afterIndex += 1;
    }
  }

  return rows.join('\n');
}

function renderDiff() {
  elements.diffOutput.textContent = createLineDiff(state.originalText, state.currentText);
}

function matchingErrors(prefix) {
  return state.validation.errors.filter((error) => error.path.startsWith(prefix));
}

function renderForm() {
  elements.formEditor.replaceChildren();

  if (state.readOnly) {
    elements.formDisabledMessage.textContent = 'Read-only mode is enabled. Rule edits are disabled.';
    elements.formDisabledMessage.className = 'notice notice-warning';
  }

  if (state.validation.needsMigration) {
    elements.formDisabledMessage.textContent = 'The form editor only saves rulesVersion 2 documents. Use “Migrate to v2” to create an editable working copy.';
    elements.formDisabledMessage.className = 'notice notice-warning';
    return;
  }

  if (!state.currentDocument) {
    elements.formDisabledMessage.textContent = 'No editable rules document is loaded.';
    elements.formDisabledMessage.className = 'notice';
    return;
  }

  if (!state.readOnly) {
    elements.formDisabledMessage.textContent = '';
    elements.formDisabledMessage.className = 'notice hidden';
  }

  const document = state.currentDocument;
  ensureRulesSection(document);

  const definitions = Object.entries(document.rules.definitions ?? {});
  if (definitions.length === 0) {
    elements.formEditor.append(
      createElement('p', { className: 'muted', textContent: 'No rule definitions yet. Add one to get started.' })
    );
  }

  for (const [name, definition] of definitions) {
    elements.formEditor.append(renderDefinitionCard(name, definition));
  }

  elements.formEditor.append(renderMatchEditor(document.rules.match ?? { all: [] }));
  applyReadOnlyControls();
}

function renderDefinitionCard(name, definition) {
  const card = createElement('section', { className: 'card editor-card' });
  const header = createElement('div', { className: 'card-header' });
  header.append(createElement('h3', { textContent: name }));
  header.append(
    createButton('Remove', () => {
      updateDocument((document) => {
        delete document.rules.definitions[name];
      });
    }, 'button-danger')
  );
  card.append(header);

  const nameInput = createInput('text', name, (event) => {
    const nextName = event.target.value.trim();
    if (!nextName || nextName === name) return;
    updateDocument((document) => {
      ensureRulesSection(document);
      if (document.rules.definitions[nextName]) return;
      document.rules.definitions[nextName] = document.rules.definitions[name];
      delete document.rules.definitions[name];
      replaceRuleReferences(document.rules.match, name, nextName);
      for (const value of Object.values(document.rules.definitions)) {
        replaceRuleReferences(value, name, nextName);
      }
    });
  });
  card.append(createField('Definition name', nameInput));

  const kind = ruleKind(definition);
  const typeSelect = createSelect(kind, [...RULE_TYPES, ...NODE_TYPES], (event) => {
    const nextKind = event.target.value;
    updateDocument((document) => {
      document.rules.definitions[name] = RULE_TYPES.includes(nextKind)
        ? defaultRuleDefinition(nextKind)
        : defaultNode(nextKind);
    });
  });
  card.append(createField('Definition type', typeSelect));

  const errorList = matchingErrors(`rules.definitions.${name}`);
  if (errorList.length > 0) {
    const list = createElement('ul', { className: 'message-list' });
    for (const error of errorList) {
      list.append(
        createElement('li', {
          className: 'status-error',
          textContent: `${error.path}: ${error.message}`,
        })
      );
    }
    card.append(list);
  }

  if (RULE_TYPES.includes(kind)) {
    card.append(renderRuleDefinitionFields(name, definition));
  } else {
    card.append(
      renderNodeEditor(definition, `rules.definitions.${name}`, (nextNode) => {
        updateDocument((document) => {
          document.rules.definitions[name] = nextNode;
        });
      })
    );
  }

  return card;
}

function replaceRuleReferences(node, oldName, newName) {
  if (!node || typeof node !== 'object') return;
  if ('rule' in node && node.rule === oldName) {
    node.rule = newName;
    return;
  }
  if ('not' in node) {
    replaceRuleReferences(node.not, oldName, newName);
    return;
  }
  if ('all' in node && Array.isArray(node.all)) {
    node.all.forEach((child) => replaceRuleReferences(child, oldName, newName));
  }
  if ('any' in node && Array.isArray(node.any)) {
    node.any.forEach((child) => replaceRuleReferences(child, oldName, newName));
  }
}

function renderRuleDefinitionFields(name, definition) {
  const wrapper = createElement('div', { className: 'form-grid' });
  const updateDefinition = (mutator) => {
    updateDocument((document) => {
      mutator(document.rules.definitions[name]);
    });
  };

  switch (definition.type) {
    case 'path':
      wrapper.append(
        createField(
          'Include globs',
          createTextarea(toMultiline(definition.include), (event) => {
            updateDefinition((target) => {
              target.include = readLines(event.target.value);
            });
          })
        ),
        createField(
          'Exclude globs',
          createTextarea(toMultiline(definition.exclude), (event) => {
            updateDefinition((target) => {
              target.exclude = readLines(event.target.value);
            });
          })
        ),
        createField(
          'Vault path override',
          createInput('text', definition.vaultPath ?? '', (event) => {
            updateDefinition((target) => {
              assignOptionalString(target, 'vaultPath', event.target.value);
            });
          })
        ),
        createCheckbox('Case insensitive', definition.caseInsensitive, () => {
          updateDefinition((target) => {
            target.caseInsensitive = !target.caseInsensitive;
          });
        }),
        createCheckbox('Negate result', definition.negate, () => {
          updateDefinition((target) => {
            target.negate = !target.negate;
          });
        })
      );
      break;
    case 'tag':
      wrapper.append(
        createField(
          'Allow list',
          createTextarea(toMultiline(definition.allowList), (event) => {
            updateDefinition((target) => {
              target.allowList = readLines(event.target.value);
            });
          })
        ),
        createField(
          'Ignore list',
          createTextarea(toMultiline(definition.ignoreList), (event) => {
            updateDefinition((target) => {
              target.ignoreList = readLines(event.target.value);
            });
          })
        ),
        createField(
          'Source',
          createSelect(definition.source ?? 'both', TAG_SOURCES, (event) => {
            updateDefinition((target) => {
              target.source = event.target.value;
            });
          })
        ),
        createCheckbox('Require any allow-list tag', definition.requireAny, () => {
          updateDefinition((target) => {
            target.requireAny = !target.requireAny;
          });
        }),
        createCheckbox('Require all allow-list tags', definition.requireAll, () => {
          updateDefinition((target) => {
            target.requireAll = !target.requireAll;
          });
        }),
        createCheckbox('Case insensitive', definition.caseInsensitive, () => {
          updateDefinition((target) => {
            target.caseInsensitive = !target.caseInsensitive;
          });
        }),
        createCheckbox('Match nested tags', definition.matchNested, () => {
          updateDefinition((target) => {
            target.matchNested = !target.matchNested;
          });
        }),
        createCheckbox('Negate result', definition.negate, () => {
          updateDefinition((target) => {
            target.negate = !target.negate;
          });
        })
      );
      break;
    case 'category':
      wrapper.append(
        createField(
          'Allow list',
          createTextarea(toMultiline(definition.allowList), (event) => {
            updateDefinition((target) => {
              target.allowList = readLines(event.target.value);
            });
          })
        ),
        createField(
          'Ignore list',
          createTextarea(toMultiline(definition.ignoreList), (event) => {
            updateDefinition((target) => {
              target.ignoreList = readLines(event.target.value);
            });
          })
        ),
        createCheckbox('Derive categories from path', definition.fromPath, () => {
          updateDefinition((target) => {
            target.fromPath = !target.fromPath;
          });
        }),
        createCheckbox('Match nested categories', definition.matchNested, () => {
          updateDefinition((target) => {
            target.matchNested = !target.matchNested;
          });
        }),
        createCheckbox('Case insensitive', definition.caseInsensitive, () => {
          updateDefinition((target) => {
            target.caseInsensitive = !target.caseInsensitive;
          });
        }),
        createCheckbox('Negate result', definition.negate, () => {
          updateDefinition((target) => {
            target.negate = !target.negate;
          });
        })
      );
      break;
    case 'frontmatter':
      wrapper.append(
        createCheckbox('Negate result', definition.negate, () => {
          updateDefinition((target) => {
            target.negate = !target.negate;
          });
        })
      );
      break;
    case 'frontmatterField':
      wrapper.append(
        createField(
          'Mode',
          createSelect(definition.mode ?? 'all', ['all', 'any'], (event) => {
            updateDefinition((target) => {
              target.mode = event.target.value;
            });
          })
        ),
        createCheckbox('Negate result', definition.negate, () => {
          updateDefinition((target) => {
            target.negate = !target.negate;
          });
        })
      );
      wrapper.append(renderConditionsEditor(definition.conditions ?? [], (nextConditions) => {
        updateDefinition((target) => {
          target.conditions = nextConditions;
        });
      }));
      break;
    case 'privacy':
      wrapper.append(
        createCheckbox('Allow private notes', definition.allowPrivate, () => {
          updateDefinition((target) => {
            target.allowPrivate = !target.allowPrivate;
          });
        }),
        createCheckbox('Negate result', definition.negate, () => {
          updateDefinition((target) => {
            target.negate = !target.negate;
          });
        })
      );
      break;
    case 'content':
      wrapper.append(
        createField(
          'Include patterns',
          createTextarea(toMultiline(definition.includePatterns), (event) => {
            updateDefinition((target) => {
              target.includePatterns = readLines(event.target.value);
            });
          })
        ),
        createField(
          'Exclude patterns',
          createTextarea(toMultiline(definition.excludePatterns), (event) => {
            updateDefinition((target) => {
              target.excludePatterns = readLines(event.target.value);
            });
          })
        ),
        createField(
          'Mode',
          createSelect(definition.mode ?? 'any', ['any', 'all'], (event) => {
            updateDefinition((target) => {
              target.mode = event.target.value;
            });
          })
        ),
        createField(
          'Max bytes',
          createInput('number', definition.maxBytes ?? '', (event) => {
            updateDefinition((target) => {
              assignOptionalNumber(target, 'maxBytes', event.target.value);
            });
          })
        ),
        createCheckbox('Regex patterns', definition.regex, () => {
          updateDefinition((target) => {
            target.regex = !target.regex;
          });
        }),
        createCheckbox('Case insensitive', definition.caseInsensitive, () => {
          updateDefinition((target) => {
            target.caseInsensitive = !target.caseInsensitive;
          });
        }),
        createCheckbox('Negate result', definition.negate, () => {
          updateDefinition((target) => {
            target.negate = !target.negate;
          });
        })
      );
      break;
    case 'fileMeta':
      wrapper.append(
        createField(
          'Minimum size',
          createInput('number', definition.minSize ?? '', (event) => {
            updateDefinition((target) => {
              assignOptionalNumber(target, 'minSize', event.target.value);
            });
          })
        ),
        createField(
          'Maximum size',
          createInput('number', definition.maxSize ?? '', (event) => {
            updateDefinition((target) => {
              assignOptionalNumber(target, 'maxSize', event.target.value);
            });
          })
        ),
        createField(
          'Modified within',
          createInput('text', definition.modifiedWithin ?? '', (event) => {
            updateDefinition((target) => {
              assignOptionalString(target, 'modifiedWithin', event.target.value);
            });
          })
        ),
        createField(
          'Modified before',
          createInput('text', definition.modifiedBefore ?? '', (event) => {
            updateDefinition((target) => {
              assignOptionalString(target, 'modifiedBefore', event.target.value);
            });
          })
        ),
        createField(
          'Extensions',
          createTextarea(toMultiline(definition.extensions), (event) => {
            updateDefinition((target) => {
              target.extensions = readLines(event.target.value);
            });
          })
        ),
        createField(
          'Vault path override',
          createInput('text', definition.vaultPath ?? '', (event) => {
            updateDefinition((target) => {
              assignOptionalString(target, 'vaultPath', event.target.value);
            });
          })
        ),
        createCheckbox('Negate result', definition.negate, () => {
          updateDefinition((target) => {
            target.negate = !target.negate;
          });
        })
      );
      break;
    default:
      wrapper.append(
        createElement('p', {
          className: 'muted',
          textContent: 'Use the raw JSON tab for fields this form does not expose.',
        })
      );
  }

  return wrapper;
}

function renderConditionsEditor(conditions, onChange) {
  const section = createElement('div', { className: 'nested-editor' });
  const header = createElement('div', { className: 'card-header' });
  header.append(createElement('h4', { textContent: 'Frontmatter conditions' }));
  header.append(
    createButton('Add condition', () => {
      onChange([
        ...conditions,
        { field: '', op: 'equals', value: '' },
      ]);
    })
  );
  section.append(header);

  if (conditions.length === 0) {
    section.append(createElement('p', { className: 'muted', textContent: 'No conditions yet.' }));
    return section;
  }

  conditions.forEach((condition, index) => {
    const row = createElement('div', { className: 'condition-row' });
    row.append(
      createField(
        'Field path',
        createInput('text', condition.field ?? '', (event) => {
          const next = clone(conditions);
          next[index].field = event.target.value;
          onChange(next);
        })
      ),
      createField(
        'Operator',
        createSelect(condition.op ?? 'equals', CONDITION_OPERATORS, (event) => {
          const next = clone(conditions);
          next[index].op = event.target.value;
          onChange(next);
        })
      ),
      createField(
        'Value',
        createInput('text', formatLooseJsonValue(condition.value), (event) => {
          const next = clone(conditions);
          const parsedValue = parseLooseJsonValue(event.target.value);
          if (parsedValue === undefined) {
            delete next[index].value;
          } else {
            next[index].value = parsedValue;
          }
          onChange(next);
        })
      ),
      createCheckbox('Case insensitive', condition.caseInsensitive, () => {
        const next = clone(conditions);
        next[index].caseInsensitive = !next[index].caseInsensitive;
        onChange(next);
      }),
      createButton('Remove', () => {
        const next = clone(conditions);
        next.splice(index, 1);
        onChange(next);
      }, 'button-danger')
    );
    section.append(row);
  });

  return section;
}

function renderNodeEditor(node, path, onChange) {
  const container = createElement('div', { className: 'nested-editor' });
  const kind = ruleKind(node);
  container.append(
    createField(
      'Node type',
      createSelect(kind, NODE_TYPES, (event) => {
        onChange(defaultNode(event.target.value));
      })
    )
  );

  const nodeErrors = matchingErrors(path);
  if (nodeErrors.length > 0) {
    const list = createElement('ul', { className: 'message-list' });
    for (const error of nodeErrors) {
      list.append(
        createElement('li', {
          className: 'status-error',
          textContent: `${error.path}: ${error.message}`,
        })
      );
    }
    container.append(list);
  }

  if (kind === 'rule') {
    container.append(
      createField(
        'Referenced definition',
        createInput('text', node.rule ?? '', (event) => {
          onChange({ rule: event.target.value });
        })
      )
    );
    return container;
  }

  if (kind === 'not') {
    container.append(
      renderNodeEditor(node.not ?? { rule: '' }, `${path}.not`, (nextNode) => {
        onChange({ not: nextNode });
      })
    );
    return container;
  }

  const key = kind === 'all' ? 'all' : 'any';
  const children = Array.isArray(node[key]) ? node[key] : [];
  const header = createElement('div', { className: 'card-header' });
  header.append(createElement('h4', { textContent: `${key.toUpperCase()} children` }));
  header.append(
    createButton('Add child', () => {
      onChange({ [key]: [...children, { rule: '' }] });
    })
  );
  container.append(header);

  children.forEach((child, index) => {
    const childCard = createElement('div', { className: 'child-node' });
    childCard.append(
      renderNodeEditor(child, `${path}.${key}[${index}]`, (nextNode) => {
        const nextChildren = clone(children);
        nextChildren[index] = nextNode;
        onChange({ [key]: nextChildren });
      })
    );
    childCard.append(
      createButton('Remove child', () => {
        const nextChildren = clone(children);
        nextChildren.splice(index, 1);
        onChange({ [key]: nextChildren });
      }, 'button-danger')
    );
    container.append(childCard);
  });

  return container;
}

function renderMatchEditor(matchNode) {
  const card = createElement('section', { className: 'card editor-card' });
  card.append(createElement('h3', { textContent: 'Match tree' }));

  const errors = matchingErrors('rules.match');
  if (errors.length > 0) {
    const list = createElement('ul', { className: 'message-list' });
    for (const error of errors) {
      list.append(
        createElement('li', {
          className: 'status-error',
          textContent: `${error.path}: ${error.message}`,
        })
      );
    }
    card.append(list);
  }

  card.append(
    renderNodeEditor(matchNode, 'rules.match', (nextNode) => {
      updateDocument((document) => {
        document.rules.match = nextNode;
      });
    })
  );
  return card;
}

function applyReadOnlyControls() {
  const controls = document.querySelectorAll(
    '#form-panel input, #form-panel select, #form-panel textarea, #form-panel button, #raw-panel textarea'
  );
  for (const control of controls) {
    control.disabled = state.readOnly;
  }
}

function assignOptionalString(target, key, value) {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    delete target[key];
    return;
  }
  target[key] = trimmed;
}

function assignOptionalNumber(target, key, value) {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    delete target[key];
    return;
  }
  target[key] = Number(trimmed);
}

function scheduleValidation(parsedDocument, immediate = false) {
  if (validateTimer) {
    window.clearTimeout(validateTimer);
  }

  const runValidation = async () => {
    state.validating = true;
    renderMeta();
    renderValidation();

    try {
      const { response, payload } = await sendJson('/api/rules/validate', 'POST', parsedDocument);
      if (response.ok) {
        state.validation = buildValidationState(payload ?? {});
        if (!state.validation.needsMigration) {
          state.currentDocument = clone(payload.parsedDocument ?? parsedDocument);
        }
      } else {
        state.validation = {
          valid: false,
          errors: payload?.errors ?? [{ path: '', message: payload?.error ?? 'Validation failed' }],
          warnings: payload?.warnings ?? [],
          needsMigration: Boolean(payload?.needsMigration),
          parsedDocument: payload?.parsedDocument ?? null,
          migratedDocument: payload?.migratedDocument ?? null,
        };
      }
    } catch (error) {
      state.validation = {
        valid: false,
        errors: [{ path: '', message: error instanceof Error ? error.message : String(error) }],
        warnings: [],
        needsMigration: false,
        parsedDocument: null,
        migratedDocument: null,
      };
    } finally {
      state.validating = false;
      renderAll();
    }
  };

  if (immediate) {
    void runValidation();
    return;
  }

  validateTimer = window.setTimeout(() => {
    validateTimer = null;
    void runValidation();
  }, 300);
}

function handleRawInput(event) {
  state.currentText = event.target.value;
  state.saveMessage = '';
  renderMeta();
  renderDiff();

  try {
    const parsed = JSON.parse(state.currentText);
    state.currentDocument = null;
    scheduleValidation(parsed);
  } catch (error) {
    state.validation = {
      valid: false,
      errors: [
        {
          path: '',
          message: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      warnings: [],
      needsMigration: false,
      parsedDocument: null,
      migratedDocument: null,
    };
    state.validating = false;
    renderAll();
  }
}

async function loadRules() {
  state.loading = true;
  state.saveMessage = '';
  renderAll();

  try {
    const { response, payload } = await fetchJson('/api/rules');
    if (!response.ok) {
      state.loading = false;
      state.validation = {
        valid: false,
        errors: [{ path: '', message: payload?.error ?? `Failed to load rules (${response.status})` }],
        warnings: [],
        needsMigration: false,
        parsedDocument: null,
        migratedDocument: null,
      };
      renderAll();
      return;
    }
    setLoadedRules(payload);
  } catch (error) {
    state.loading = false;
    state.validation = {
      valid: false,
      errors: [{ path: '', message: error instanceof Error ? error.message : String(error) }],
      warnings: [],
      needsMigration: false,
      parsedDocument: null,
      migratedDocument: null,
    };
    renderAll();
  }
}

async function saveRules() {
  if (!state.currentDocument || !state.etag || elements.saveButton.disabled) return;

  state.saving = true;
  state.saveMessage = 'Saving…';
  renderMeta();

  try {
    const { response, payload } = await sendJson('/api/rules', 'PUT', state.currentDocument, {
      'If-Match': state.etag,
    });

    if (!response.ok) {
      if (response.status === 409) {
        state.saveMessage = 'Save rejected because the on-disk rules changed. Reload and merge your edits.';
      } else {
        state.saveMessage = payload?.error ?? `Save failed with ${response.status}`;
      }
      if (payload?.errors) {
        state.validation = {
          valid: false,
          errors: payload.errors,
          warnings: payload.warnings ?? [],
          needsMigration: Boolean(payload.needsMigration),
          parsedDocument: payload.parsedDocument ?? null,
          migratedDocument: payload.migratedDocument ?? null,
        };
      }
      renderAll();
      return;
    }

    setLoadedRules(payload);
    state.saveMessage = 'Rules saved and reloaded successfully.';
    renderMeta();
  } catch (error) {
    state.saveMessage = error instanceof Error ? error.message : String(error);
    renderMeta();
  } finally {
    state.saving = false;
    renderMeta();
  }
}

function addDefinition() {
  updateDocument((document) => {
    ensureRulesSection(document);
    let index = 1;
    let name = `rule${index}`;
    while (document.rules.definitions[name]) {
      index += 1;
      name = `rule${index}`;
    }
    document.rules.definitions[name] = defaultRuleDefinition('path');
  });
}

function migrateWorkingCopy() {
  if (!state.validation.migratedDocument) return;
  applyDocumentState(clone(state.validation.migratedDocument), {
    validateImmediately: true,
    saveMessage: 'Working copy migrated to rulesVersion 2. Review the diff, then save when ready.',
  });
}

elements.rawEditor.addEventListener('input', handleRawInput);
elements.reloadButton.addEventListener('click', () => {
  void loadRules();
});
elements.saveButton.addEventListener('click', () => {
  void saveRules();
});
elements.addDefinitionButton.addEventListener('click', addDefinition);
elements.migrateButton.addEventListener('click', migrateWorkingCopy);
elements.tabForm.addEventListener('click', () => setTab('form'));
elements.tabRaw.addEventListener('click', () => setTab('raw'));

setTab('form');
void loadRules();
