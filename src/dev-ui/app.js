// Cmssy Dev Server - Interactive UI
let currentBlock = null;
let blocks = [];
let previewData = {};
let eventSource = null;

// Initialize app
async function init() {
  await loadBlocks();
  setupSSE();
}

// Load all blocks from API
async function loadBlocks() {
  try {
    const response = await fetch('/api/blocks');
    blocks = await response.json();
    renderBlocksList();
  } catch (error) {
    console.error('Failed to load blocks:', error);
    document.getElementById('blocks-list').innerHTML = `
      <div style="padding: 20px; color: #e53935;">
        Failed to load blocks. Make sure the dev server is running.
      </div>
    `;
  }
}

// Render blocks list
function renderBlocksList() {
  const listEl = document.getElementById('blocks-list');
  const countEl = document.getElementById('blocks-count');

  if (blocks.length === 0) {
    listEl.innerHTML = '<div class="editor-empty">No blocks found</div>';
    countEl.textContent = 'No blocks';
    return;
  }

  countEl.textContent = `${blocks.length} ${blocks.length === 1 ? 'block' : 'blocks'}`;

  listEl.innerHTML = blocks.map(block => `
    <div
      class="block-item ${currentBlock?.name === block.name ? 'active' : ''}"
      data-block="${block.name}"
      onclick="selectBlock('${block.name}')"
    >
      <div class="block-item-header">
        <div class="block-item-name">${block.displayName || block.name}</div>
        <span class="version-badge">v${block.version || '1.0.0'}</span>
      </div>
      <div class="block-item-footer">
        <span class="block-item-type">${block.type}</span>
        <span class="status-badge status-local">Local</span>
      </div>
    </div>
  `).join('');
}

// Select a block
async function selectBlock(blockName) {
  const block = blocks.find(b => b.name === blockName);
  if (!block) return;

  currentBlock = block;
  renderBlocksList(); // Update active state

  // Load preview data
  try {
    const response = await fetch(`/api/preview/${blockName}`);
    previewData = await response.json();
  } catch (error) {
    console.error('Failed to load preview data:', error);
    previewData = {};
  }

  // Update UI
  document.getElementById('preview-title').textContent = block.displayName || block.name;
  document.getElementById('editor-subtitle').textContent = block.name;

  // Show publish button
  const publishBtn = document.getElementById('publish-btn');
  if (publishBtn) {
    publishBtn.style.display = 'block';
  }

  // Render preview
  renderPreview();

  // Render editor form
  renderEditor();
}

// Render preview iframe
function renderPreview() {
  if (!currentBlock) return;

  const previewContent = document.getElementById('preview-content');
  previewContent.innerHTML = `
    <div class="preview-iframe-wrapper">
      <iframe
        class="preview-iframe"
        src="/preview/${currentBlock.name}"
        id="preview-iframe"
      ></iframe>
    </div>
  `;
}

// Render editor form
function renderEditor() {
  if (!currentBlock || !currentBlock.schema) {
    document.getElementById('editor-content').innerHTML = `
      <div class="editor-empty">No schema defined for this block</div>
    `;
    return;
  }

  const editorContent = document.getElementById('editor-content');
  const fields = Object.entries(currentBlock.schema);

  editorContent.innerHTML = fields.map(([key, field]) =>
    renderField(key, field, previewData[key])
  ).join('');

  // Attach event listeners
  attachFieldListeners();
}

// Render a single field based on type
function renderField(key, field, value) {
  const required = field.required ? '<span class="field-required">*</span>' : '';
  const helpText = field.helpText ? `<div class="field-help">${field.helpText}</div>` : '';

  let inputHtml = '';

  switch (field.type) {
    case 'singleLine':
    case 'text':
    case 'string':
      inputHtml = `
        <input
          type="text"
          class="field-input"
          data-field="${key}"
          value="${escapeHtml(value || field.defaultValue || '')}"
          placeholder="${field.placeholder || ''}"
          ${field.required ? 'required' : ''}
        />
      `;
      break;

    case 'multiLine':
      inputHtml = `
        <textarea
          class="field-input field-textarea"
          data-field="${key}"
          placeholder="${field.placeholder || ''}"
          ${field.required ? 'required' : ''}
        >${escapeHtml(value || field.defaultValue || '')}</textarea>
      `;
      break;

    case 'richText':
      inputHtml = `
        <textarea
          class="field-input field-textarea"
          data-field="${key}"
          placeholder="${field.placeholder || 'Enter rich text...'}"
          ${field.required ? 'required' : ''}
          style="min-height: 120px;"
        >${escapeHtml(value || field.defaultValue || '')}</textarea>
      `;
      break;

    case 'number':
      inputHtml = `
        <input
          type="number"
          class="field-input"
          data-field="${key}"
          value="${value !== undefined ? value : (field.defaultValue || '')}"
          placeholder="${field.placeholder || ''}"
          ${field.required ? 'required' : ''}
        />
      `;
      break;

    case 'boolean':
      inputHtml = `
        <label style="display: flex; align-items: center; cursor: pointer;">
          <input
            type="checkbox"
            class="field-checkbox"
            data-field="${key}"
            ${value || field.defaultValue ? 'checked' : ''}
          />
          <span>${field.label}</span>
        </label>
      `;
      break;

    case 'date':
      inputHtml = `
        <input
          type="date"
          class="field-input"
          data-field="${key}"
          value="${value || field.defaultValue || ''}"
          ${field.required ? 'required' : ''}
        />
      `;
      break;

    case 'link':
      inputHtml = `
        <input
          type="url"
          class="field-input"
          data-field="${key}"
          value="${escapeHtml(value || field.defaultValue || '')}"
          placeholder="${field.placeholder || 'https://...'}"
          ${field.required ? 'required' : ''}
        />
      `;
      break;

    case 'color':
      const colorValue = value || field.defaultValue || '#000000';
      inputHtml = `
        <div class="color-field">
          <input
            type="color"
            class="color-preview"
            data-field="${key}"
            value="${colorValue}"
          />
          <input
            type="text"
            class="field-input color-input"
            data-field="${key}-text"
            value="${colorValue}"
            placeholder="#000000"
          />
        </div>
      `;
      break;

    case 'select':
      const currentValue = value || field.defaultValue || '';
      inputHtml = `
        <select class="field-input field-select" data-field="${key}" ${field.required ? 'required' : ''}>
          <option value="">Select an option...</option>
          ${field.options.map(opt => {
            const optValue = typeof opt === 'string' ? opt : opt.value;
            const optLabel = typeof opt === 'string' ? opt : opt.label;
            return `<option value="${escapeHtml(optValue)}" ${currentValue === optValue ? 'selected' : ''}>${escapeHtml(optLabel)}</option>`;
          }).join('')}
        </select>
      `;
      break;

    case 'media':
      const mediaValue = value || field.defaultValue || {};
      inputHtml = `
        <div class="media-field">
          <div class="media-preview">
            ${mediaValue.url ?
              `<img src="${escapeHtml(mediaValue.url)}" alt="${escapeHtml(mediaValue.alt || '')}"/>` :
              '<div class="media-placeholder">No image</div>'
            }
          </div>
          <div class="media-input-group">
            <input
              type="url"
              class="field-input"
              data-field="${key}.url"
              value="${escapeHtml(mediaValue.url || '')}"
              placeholder="Image URL"
              style="margin-bottom: 8px;"
            />
            <input
              type="text"
              class="field-input"
              data-field="${key}.alt"
              value="${escapeHtml(mediaValue.alt || '')}"
              placeholder="Alt text"
            />
          </div>
        </div>
      `;
      break;

    case 'repeater':
      inputHtml = renderRepeaterField(key, field, value || field.defaultValue || []);
      break;

    default:
      inputHtml = `<div style="color: #999;">Unsupported field type: ${field.type}</div>`;
  }

  // Special case for boolean - don't show separate label
  if (field.type === 'boolean') {
    return `
      <div class="field-group">
        ${inputHtml}
        ${helpText}
      </div>
    `;
  }

  return `
    <div class="field-group">
      <label class="field-label">
        ${field.label}${required}
      </label>
      ${inputHtml}
      ${helpText}
    </div>
  `;
}

// Render repeater field
function renderRepeaterField(key, field, items) {
  const minItems = field.minItems || 0;
  const maxItems = field.maxItems || 999;

  const itemsHtml = items.map((item, index) => {
    const nestedFields = Object.entries(field.schema || {}).map(([nestedKey, nestedField]) => {
      return renderField(`${key}.${index}.${nestedKey}`, nestedField, item[nestedKey]);
    }).join('');

    return `
      <div class="repeater-item" data-repeater-item="${key}.${index}">
        <div class="repeater-item-header">
          <div class="repeater-item-title">Item ${index + 1}</div>
          ${items.length > minItems ? `
            <button
              type="button"
              class="repeater-item-remove"
              onclick="removeRepeaterItem('${key}', ${index})"
            >Remove</button>
          ` : ''}
        </div>
        ${nestedFields}
      </div>
    `;
  }).join('');

  return `
    <div class="repeater-items" data-repeater="${key}">
      ${itemsHtml || '<div style="padding: 12px; color: #999; text-align: center;">No items yet</div>'}
    </div>
    ${items.length < maxItems ? `
      <button
        type="button"
        class="repeater-add"
        onclick="addRepeaterItem('${key}')"
      >+ Add Item</button>
    ` : ''}
  `;
}

// Get nested field definition from schema using dot notation path
function getNestedFieldDefinition(key) {
  const parts = key.split('.');
  let fieldDef = null;
  let schema = currentBlock.schema;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    // Skip numeric indices (they reference array items, not schema keys)
    if (/^\d+$/.test(part)) {
      continue;
    }

    if (schema && schema[part]) {
      fieldDef = schema[part];
      // If this is a repeater, its nested fields are in .schema
      if (fieldDef.type === 'repeater' && fieldDef.schema) {
        schema = fieldDef.schema;
      }
    } else {
      return null;
    }
  }

  return fieldDef;
}

// Get nested value from previewData using dot notation path
function getNestedValue(key) {
  const parts = key.split('.');
  let value = previewData;

  for (const part of parts) {
    if (value === undefined || value === null) return undefined;
    value = value[part];
  }

  return value;
}

// Set nested value in previewData using dot notation path
function setNestedValue(key, newValue) {
  const parts = key.split('.');
  let obj = previewData;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const nextPart = parts[i + 1];

    if (obj[part] === undefined) {
      // Create array if next part is numeric, otherwise object
      obj[part] = /^\d+$/.test(nextPart) ? [] : {};
    }
    obj = obj[part];
  }

  obj[parts[parts.length - 1]] = newValue;
}

// Add repeater item
window.addRepeaterItem = function(key) {
  // Get field definition (supports nested paths like "plans.0.features")
  const field = getNestedFieldDefinition(key);
  if (!field || !field.schema) {
    console.error('Could not find repeater field definition for:', key);
    return;
  }

  // Get current items at the nested path
  const currentItems = getNestedValue(key) || [];

  // Create new empty item with defaults
  const newItem = {};
  Object.keys(field.schema).forEach(nestedKey => {
    const nestedField = field.schema[nestedKey];
    if (nestedField.type === 'repeater') {
      newItem[nestedKey] = []; // Nested repeaters start empty
    } else {
      newItem[nestedKey] = nestedField.defaultValue !== undefined ? nestedField.defaultValue : '';
    }
  });

  // Set the updated array at the nested path
  setNestedValue(key, [...currentItems, newItem]);

  // Re-render editor and save
  renderEditor();
  savePreviewData();
};

// Remove repeater item
window.removeRepeaterItem = function(key, index) {
  // Get current items at the nested path
  const currentItems = getNestedValue(key) || [];

  // Filter out the item at the given index
  const newItems = currentItems.filter((_, i) => i !== index);

  // Set the updated array at the nested path
  setNestedValue(key, newItems);

  // Re-render editor and save
  renderEditor();
  savePreviewData();
};

// Attach event listeners to form fields
function attachFieldListeners() {
  const inputs = document.querySelectorAll('[data-field]');
  inputs.forEach(input => {
    const eventType = input.type === 'checkbox' ? 'change' : 'input';
    input.addEventListener(eventType, handleFieldChange);
  });
}

// Handle field value change
function handleFieldChange(event) {
  const input = event.target;
  const fieldPath = input.dataset.field;

  let value;
  if (input.type === 'checkbox') {
    value = input.checked;
  } else if (input.type === 'number') {
    value = input.value ? parseFloat(input.value) : '';
  } else {
    value = input.value;
  }

  // Use generic nested setter to handle any depth (supports nested repeaters)
  setNestedValue(fieldPath, value);

  // Sync color picker with text input
  if (fieldPath.endsWith('-text')) {
    const colorKey = fieldPath.replace('-text', '');
    const colorInput = document.querySelector(`[data-field="${colorKey}"]`);
    if (colorInput) colorInput.value = value;
  }

  // Debounce save (quick debounce since we're using postMessage for instant updates)
  clearTimeout(window.saveTimeout);
  window.saveTimeout = setTimeout(() => savePreviewData(), 200);
}

// Save preview data to server
async function savePreviewData() {
  if (!currentBlock) return;

  try {
    // Update preview iframe immediately (no reload/blink)
    const iframe = document.getElementById('preview-iframe');
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage({
        type: 'UPDATE_PROPS',
        props: previewData
      }, '*');
    }

    // Save to server in background
    const response = await fetch(`/api/preview/${currentBlock.name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(previewData)
    });

    if (response.ok) {
      document.getElementById('preview-status').textContent = 'Saved';
      setTimeout(() => {
        document.getElementById('preview-status').textContent = 'Ready';
      }, 1000);
    }
  } catch (error) {
    console.error('Failed to save preview data:', error);
    document.getElementById('preview-status').textContent = 'Error';
  }
}

// Setup Server-Sent Events for hot reload
function setupSSE() {
  eventSource = new EventSource('/events');

  eventSource.onmessage = async (event) => {
    const data = JSON.parse(event.data);

    if (data.type === 'reload') {
      // If config changed, reload blocks list to update schema
      if (data.configChanged && currentBlock && data.block === currentBlock.name) {
        console.log('Config changed, reloading block data...');
        await loadBlocks();
        // Re-select current block to refresh properties sidebar
        await selectBlock(currentBlock.name);
      }

      // Reload preview iframe
      const iframe = document.getElementById('preview-iframe');
      if (iframe && (!data.block || data.block === currentBlock?.name)) {
        iframe.src = iframe.src; // Force reload
      }
    }
  };

  eventSource.onerror = () => {
    console.error('SSE connection lost. Reconnecting...');
  };
}

// Utility: Escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Publish functionality
let publishTaskId = null;
let publishEventSource = null;
let workspacesCache = null;

// Store original progress HTML template
const PROGRESS_TEMPLATE = `
  <div class="publish-progress-container">
    <div class="progress-bar-container">
      <div class="progress-bar-bg">
        <div class="progress-bar-fill" id="publish-progress-bar" style="width: 0%"></div>
      </div>
      <div class="progress-text" id="publish-progress-text">0%</div>
    </div>

    <div class="progress-steps" id="publish-steps">
      <!-- Steps will be dynamically added here -->
    </div>

    <div style="text-align: center; margin-top: 24px;">
      <button class="btn btn-primary" onclick="closePublishModal()" id="publish-close-btn" style="display: none;">
        Done
      </button>
    </div>
  </div>
`;

async function loadWorkspaces() {
  const select = document.getElementById('publish-workspace-id');
  const errorDiv = document.getElementById('workspace-error');

  try {
    // Use cached workspaces if available
    if (workspacesCache) {
      populateWorkspaceSelect(workspacesCache);
      return;
    }

    const response = await fetch('/api/workspaces');

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || 'Failed to load workspaces');
    }

    const workspaces = await response.json();
    workspacesCache = workspaces;

    populateWorkspaceSelect(workspaces);
    errorDiv.style.display = 'none';
  } catch (error) {
    console.error('Failed to load workspaces:', error);
    select.innerHTML = '<option value="">Failed to load workspaces</option>';
    errorDiv.textContent = error.message || 'Failed to load workspaces. Check your API token configuration.';
    errorDiv.style.display = 'block';
  }
}

function populateWorkspaceSelect(workspaces) {
  const select = document.getElementById('publish-workspace-id');

  if (workspaces.length === 0) {
    select.innerHTML = '<option value="">No workspaces found</option>';
    return;
  }

  select.innerHTML = '<option value="">Select a workspace</option>';
  workspaces.forEach(ws => {
    const option = document.createElement('option');
    option.value = ws.id;
    option.textContent = `${ws.name} (${ws.myRole})`;
    select.appendChild(option);
  });
}

window.openPublishModal = async function() {
  if (!currentBlock) return;

  const modal = document.getElementById('publish-modal');
  const blockName = document.getElementById('publish-block-name');
  const localVersion = document.getElementById('publish-local-version');
  const publishedVersionRow = document.getElementById('publish-published-version-row');

  blockName.textContent = currentBlock.displayName || currentBlock.name;
  localVersion.textContent = `v${currentBlock.version || '1.0.0'}`;

  // Hide published version initially
  publishedVersionRow.style.display = 'none';

  // Reset form
  document.getElementById('publish-target-marketplace').checked = true;
  document.getElementById('publish-workspace-id').value = '';
  document.getElementById('publish-version-bump').value = '';

  // Load workspaces (will be shown when workspace target is selected)
  await loadWorkspaces();

  // Show/hide workspace input
  toggleWorkspaceInput();

  modal.classList.add('active');
};

window.closePublishModal = function() {
  const modal = document.getElementById('publish-modal');
  modal.classList.remove('active');

  // Reset modal state
  resetPublishModal();
};

function resetPublishModal() {
  // Close EventSource if active
  if (publishEventSource) {
    publishEventSource.close();
    publishEventSource = null;
  }

  // Reset to form view (hide progress)
  document.getElementById('publish-form').style.display = 'block';
  const progressDiv = document.getElementById('publish-progress');
  progressDiv.style.display = 'none';

  // Restore original progress HTML (in case showPublishError changed it)
  progressDiv.innerHTML = PROGRESS_TEMPLATE;

  // Reset task ID
  publishTaskId = null;
}

// Simple semver increment helper
function incrementVersion(version, type) {
  const parts = version.split('.').map(Number);
  if (parts.length !== 3) return version;

  const [major, minor, patch] = parts;

  switch (type) {
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'major':
      return `${major + 1}.0.0`;
    default:
      return version;
  }
}

async function fetchPublishedVersion(workspaceId) {
  if (!currentBlock || !workspaceId) return;

  const publishedVersionRow = document.getElementById('publish-published-version-row');
  const publishedVersionSpan = document.getElementById('publish-published-version');
  const versionBumpSelect = document.getElementById('publish-version-bump');

  try {
    const response = await fetch(`/api/blocks/${currentBlock.name}/published-version?workspaceId=${workspaceId}`);
    const data = await response.json();

    if (data.published && data.version) {
      publishedVersionSpan.textContent = `v${data.version}`;
      publishedVersionRow.style.display = 'block';

      // Update version bump options with calculated versions
      const currentVer = data.version;
      const patchVer = incrementVersion(currentVer, 'patch');
      const minorVer = incrementVersion(currentVer, 'minor');
      const majorVer = incrementVersion(currentVer, 'major');

      versionBumpSelect.innerHTML = `
        <option value="">No change</option>
        <option value="patch">Patch (${currentVer} → ${patchVer})</option>
        <option value="minor">Minor (${currentVer} → ${minorVer})</option>
        <option value="major">Major (${currentVer} → ${majorVer})</option>
      `;
    } else {
      publishedVersionSpan.textContent = 'Not published yet';
      publishedVersionRow.style.display = 'block';

      // Use local version for initial publish
      const localVer = currentBlock.version || '1.0.0';
      versionBumpSelect.innerHTML = `
        <option value="">Use current version (${localVer})</option>
        <option value="patch">Patch (${localVer} → ${incrementVersion(localVer, 'patch')})</option>
        <option value="minor">Minor (${localVer} → ${incrementVersion(localVer, 'minor')})</option>
        <option value="major">Major (${localVer} → ${incrementVersion(localVer, 'major')})</option>
      `;
    }
  } catch (error) {
    console.error('Failed to fetch published version:', error);
    publishedVersionRow.style.display = 'none';
  }
}

window.handleWorkspaceChange = function() {
  const workspaceId = document.getElementById('publish-workspace-id').value;
  if (workspaceId) {
    fetchPublishedVersion(workspaceId);
  } else {
    // Hide published version when no workspace selected
    document.getElementById('publish-published-version-row').style.display = 'none';
  }
};

window.toggleWorkspaceInput = function() {
  const target = document.querySelector('input[name="publish-target"]:checked').value;
  const workspaceGroup = document.getElementById('workspace-id-group');
  const publishedVersionRow = document.getElementById('publish-published-version-row');

  if (target === 'workspace') {
    workspaceGroup.style.display = 'block';
  } else {
    workspaceGroup.style.display = 'none';
    publishedVersionRow.style.display = 'none';
  }
};

window.startPublish = async function() {
  if (!currentBlock) return;

  const target = document.querySelector('input[name="publish-target"]:checked').value;
  const workspaceId = document.getElementById('publish-workspace-id').value;
  const versionBump = document.getElementById('publish-version-bump').value;

  // Validate workspace ID if needed
  if (target === 'workspace' && !workspaceId) {
    alert('Please select a workspace from the dropdown');
    return;
  }

  // Show progress UI, hide form
  document.getElementById('publish-form').style.display = 'none';
  document.getElementById('publish-progress').style.display = 'block';

  try {
    // Start publish
    const response = await fetch(`/api/blocks/${currentBlock.name}/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target, workspaceId, versionBump })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to start publish');
    }

    const { taskId } = await response.json();
    publishTaskId = taskId;

    // Stream progress
    streamPublishProgress(taskId);

  } catch (error) {
    console.error('Publish failed:', error);
    showPublishError(error.message);
  }
};

function streamPublishProgress(taskId) {
  // Close existing connection
  if (publishEventSource) {
    publishEventSource.close();
    publishEventSource = null;
  }

  publishEventSource = new EventSource(`/api/publish/progress/${taskId}`);

  publishEventSource.onmessage = (event) => {
    try {
      const task = JSON.parse(event.data);
      updatePublishProgress(task);

      // Close connection when done - do this BEFORE any other processing
      if (task.status === 'completed' || task.status === 'failed') {
        console.log('[Publish] Task finished with status:', task.status);
        if (publishEventSource) {
          publishEventSource.close();
          publishEventSource = null;
        }
      }
    } catch (err) {
      console.error('[Publish] Failed to parse SSE message:', err);
    }
  };

  publishEventSource.onerror = (err) => {
    // Only log if we haven't already closed the connection
    if (publishEventSource) {
      console.error('[Publish] SSE connection error');
      publishEventSource.close();
      publishEventSource = null;
    }
  };
}

function updatePublishProgress(task) {
  const progressBar = document.getElementById('publish-progress-bar');
  const progressText = document.getElementById('publish-progress-text');
  const stepsContainer = document.getElementById('publish-steps');

  // Update progress bar
  progressBar.style.width = `${task.progress}%`;
  progressText.textContent = `${task.progress}%`;

  // Update steps
  stepsContainer.innerHTML = task.steps.map(step => `
    <div class="progress-step ${step.status}">
      <span class="step-icon">
        ${step.status === 'completed' ? '✓' : step.status === 'failed' ? '✗' : '⏳'}
      </span>
      <span class="step-message">${step.message}</span>
    </div>
  `).join('');

  // Handle completion
  if (task.status === 'completed') {
    document.getElementById('publish-close-btn').style.display = 'block';
    document.getElementById('publish-close-btn').textContent = 'Done';
  } else if (task.status === 'failed') {
    document.getElementById('publish-close-btn').style.display = 'block';
    document.getElementById('publish-close-btn').textContent = 'Close';
  }
}

function showPublishError(message) {
  const progressDiv = document.getElementById('publish-progress');
  progressDiv.innerHTML = `
    <div class="publish-error">
      <div class="error-icon">✗</div>
      <div class="error-message">${escapeHtml(message)}</div>
      <button class="btn btn-secondary" onclick="closePublishModal()">Close</button>
    </div>
  `;
}

// Panel Toggle Functionality - Collapsed Sidebar
let leftPanelCollapsed = false;
let rightPanelCollapsed = false;

window.toggleLeftPanel = function() {
  const container = document.getElementById('container');
  const toggleBtn = document.getElementById('toggle-left');

  leftPanelCollapsed = !leftPanelCollapsed;

  if (leftPanelCollapsed) {
    container.classList.add('left-collapsed');
    toggleBtn.setAttribute('title', 'Expand panel (Ctrl+B)');
  } else {
    container.classList.remove('left-collapsed');
    toggleBtn.setAttribute('title', 'Collapse panel (Ctrl+B)');
  }

  // Save preference
  localStorage.setItem('leftPanelCollapsed', leftPanelCollapsed);
};

window.toggleRightPanel = function() {
  const container = document.getElementById('container');
  const toggleBtn = document.getElementById('toggle-right');

  rightPanelCollapsed = !rightPanelCollapsed;

  if (rightPanelCollapsed) {
    container.classList.add('right-collapsed');
    toggleBtn.setAttribute('title', 'Expand panel (Ctrl+E)');
  } else {
    container.classList.remove('right-collapsed');
    toggleBtn.setAttribute('title', 'Collapse panel (Ctrl+E)');
  }

  // Save preference
  localStorage.setItem('rightPanelCollapsed', rightPanelCollapsed);
};

// Restore panel states from localStorage
function restorePanelStates() {
  const savedLeftState = localStorage.getItem('leftPanelCollapsed');
  const savedRightState = localStorage.getItem('rightPanelCollapsed');

  if (savedLeftState === 'true') {
    leftPanelCollapsed = false; // Set to false so toggle will flip it
    toggleLeftPanel();
  }

  if (savedRightState === 'true') {
    rightPanelCollapsed = false; // Set to false so toggle will flip it
    toggleRightPanel();
  }
}

// Keyboard shortcuts
document.addEventListener('keydown', (event) => {
  // Ctrl+B (or Cmd+B on Mac) - Toggle left panel
  if ((event.ctrlKey || event.metaKey) && event.key === 'b') {
    event.preventDefault();
    toggleLeftPanel();
  }

  // Ctrl+E (or Cmd+E on Mac) - Toggle right panel
  if ((event.ctrlKey || event.metaKey) && event.key === 'e') {
    event.preventDefault();
    toggleRightPanel();
  }
});

// Start the app
init();

// Restore panel states after init
setTimeout(restorePanelStates, 100);
