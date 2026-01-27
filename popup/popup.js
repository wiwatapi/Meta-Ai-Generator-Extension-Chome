// ===== State =====
const state = {
  mode: 'image',
  aspectRatio: '9:16',
  inputMode: 'manual',
  autoDownload: true,
  refImage: null,
  prompts: [],
  queue: [],
  isConnected: false,
  isProcessing: false
};

// ===== DOM Elements =====
const elements = {
  modeButtons: document.querySelectorAll('[data-mode]'),
  ratioButtons: document.querySelectorAll('[data-ratio]'),
  inputModeButtons: document.querySelectorAll('[data-input]'),
  autoDownload: document.getElementById('autoDownload'),
  refImagePath: document.getElementById('refImagePath'),
  refImageFile: document.getElementById('refImageFile'),
  browseRefImage: document.getElementById('browseRefImage'),
  clearRefImage: document.getElementById('clearRefImage'),
  refImagePreview: document.getElementById('refImagePreview'),
  promptsInput: document.getElementById('promptsInput'),
  promptsFile: document.getElementById('promptsFile'),
  loadPromptsFile: document.getElementById('loadPromptsFile'),
  promptCount: document.getElementById('promptCount'),
  sendBtn: document.getElementById('sendBtn'),
  clearBtn: document.getElementById('clearBtn'),
  queueList: document.getElementById('queueList'),
  queueCount: document.getElementById('queueCount'),
  statusText: document.getElementById('statusText'),
  connectionStatus: document.getElementById('connectionStatus')
};

// ===== Initialize =====
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  setupEventListeners();
  checkConnection();
});

// ===== Event Listeners =====
function setupEventListeners() {
  // Mode toggle
  elements.modeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      elements.modeButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.mode = btn.dataset.mode;
      saveSettings();
    });
  });

  // Aspect ratio toggle
  elements.ratioButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      elements.ratioButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.aspectRatio = btn.dataset.ratio;
      saveSettings();
    });
  });

  // Input mode toggle
  elements.inputModeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      elements.inputModeButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.inputMode = btn.dataset.input;
      saveSettings();
    });
  });

  // Auto download toggle
  elements.autoDownload.addEventListener('change', () => {
    state.autoDownload = elements.autoDownload.checked;
    saveSettings();
  });

  // Reference image browse
  elements.browseRefImage.addEventListener('click', () => {
    elements.refImageFile.click();
  });

  elements.refImageFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      state.refImage = file;
      elements.refImagePath.value = file.name;
      showImagePreview(file);
    }
  });

  elements.clearRefImage.addEventListener('click', () => {
    state.refImage = null;
    elements.refImageFile.value = '';
    elements.refImagePath.value = '';
    elements.refImagePreview.classList.add('hidden');
    elements.refImagePreview.innerHTML = '';
  });

  // Prompts input
  elements.promptsInput.addEventListener('input', () => {
    updatePromptCount();
  });

  // Load prompts from file
  elements.loadPromptsFile.addEventListener('click', () => {
    elements.promptsFile.click();
  });

  elements.promptsFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        elements.promptsInput.value = event.target.result;
        updatePromptCount();
      };
      reader.readAsText(file);
    }
  });

  // Send button
  elements.sendBtn.addEventListener('click', sendPrompts);

  // Clear button
  elements.clearBtn.addEventListener('click', clearAll);
}

// ===== Functions =====
function parsePrompts(text) {
  // Split by blank lines (one or more empty lines)
  return text
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(p => p.length > 0);
}

function updatePromptCount() {
  const prompts = parsePrompts(elements.promptsInput.value);
  const count = prompts.length;
  elements.promptCount.textContent = `${count} prompt${count !== 1 ? 's' : ''}`;
}

function showImagePreview(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    elements.refImagePreview.innerHTML = `<img src="${e.target.result}" alt="Preview">`;
    elements.refImagePreview.classList.remove('hidden');
  };
  reader.readAsDataURL(file);
}

async function sendPrompts() {
  const prompts = parsePrompts(elements.promptsInput.value);
  if (prompts.length === 0) {
    updateStatus('No prompts to send', 'warning');
    return;
  }

  state.queue = prompts.map((text, index) => ({
    id: Date.now() + index,
    text,
    status: 'pending'
  }));

  renderQueue();
  
  // Get active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  if (!tab || !tab.url.includes('meta.ai')) {
    updateStatus('Please open meta.ai first', 'error');
    return;
  }

  // Prepare reference image as base64 if exists
  let refImageData = null;
  if (state.refImage) {
    refImageData = await fileToBase64(state.refImage);
  }

  // Send to content script
  try {
    await chrome.tabs.sendMessage(tab.id, {
      action: 'startGeneration',
      data: {
        mode: state.mode,
        aspectRatio: state.aspectRatio,
        autoDownload: state.autoDownload,
        refImage: refImageData,
        prompts: state.queue
      }
    });
    
    state.isProcessing = true;
    updateStatus('Processing...', 'info');
  } catch (error) {
    updateStatus('Failed to connect to page', 'error');
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function renderQueue() {
  if (state.queue.length === 0) {
    elements.queueList.innerHTML = '<div class="queue-empty">No prompts in queue</div>';
    elements.queueCount.textContent = '0 prompts';
    return;
  }

  elements.queueCount.textContent = `${state.queue.length} prompt${state.queue.length !== 1 ? 's' : ''}`;
  
  elements.queueList.innerHTML = state.queue.map((item, index) => `
    <div class="queue-item ${item.status}">
      <span class="queue-item-number">${index + 1}</span>
      <span class="queue-item-text" title="${escapeHtml(item.text)}">${escapeHtml(item.text)}</span>
      <span class="queue-item-status">${getStatusText(item.status)}</span>
    </div>
  `).join('');
}

function getStatusText(status) {
  const statusMap = {
    pending: '⏳ Pending',
    generating: '🔄 Generating...',
    downloading: '⬇️ Downloading...',
    completed: '✅ Done',
    error: '❌ Error'
  };
  return statusMap[status] || status;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function clearAll() {
  elements.promptsInput.value = '';
  state.queue = [];
  renderQueue();
  updatePromptCount();
  updateStatus('Cleared', 'info');
}

function updateStatus(message, type = 'info') {
  elements.statusText.textContent = message;
  elements.statusText.className = `status-text status-${type}`;
}

async function checkConnection() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && tab.url.includes('meta.ai')) {
      try {
        await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
        state.isConnected = true;
        elements.connectionStatus.classList.remove('disconnected');
        elements.connectionStatus.classList.add('connected');
        updateStatus('Connected to Meta AI', 'info');
      } catch {
        state.isConnected = false;
      }
    }
  } catch {
    state.isConnected = false;
  }
}

// ===== Settings =====
function saveSettings() {
  chrome.storage.local.set({
    mode: state.mode,
    aspectRatio: state.aspectRatio,
    inputMode: state.inputMode,
    autoDownload: state.autoDownload
  });
}

function loadSettings() {
  chrome.storage.local.get(['mode', 'aspectRatio', 'inputMode', 'autoDownload'], (result) => {
    if (result.mode) {
      state.mode = result.mode;
      elements.modeButtons.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === state.mode);
      });
    }
    
    if (result.aspectRatio) {
      state.aspectRatio = result.aspectRatio;
      elements.ratioButtons.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.ratio === state.aspectRatio);
      });
    }
    
    if (result.inputMode) {
      state.inputMode = result.inputMode;
      elements.inputModeButtons.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.input === state.inputMode);
      });
    }
    
    if (result.autoDownload !== undefined) {
      state.autoDownload = result.autoDownload;
      elements.autoDownload.checked = state.autoDownload;
    }
  });
}

// ===== Message Listener =====
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'updateQueue') {
    const { promptId, status } = message.data;
    const item = state.queue.find(q => q.id === promptId);
    if (item) {
      item.status = status;
      renderQueue();
    }
  }
  
  if (message.action === 'generationComplete') {
    state.isProcessing = false;
    updateStatus('All prompts completed!', 'success');
  }
  
  if (message.action === 'error') {
    updateStatus(message.data.message, 'error');
  }
});
