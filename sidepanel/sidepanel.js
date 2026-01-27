// ===== Meta AI Generator - Side Panel =====

// State
const state = {
    mode: 'image',
    aspectRatio: '9:16',
    autoDownload: true,
    delaySeconds: 3,
    refImage: null,
    queue: [],
    isConnected: false,
    isProcessing: false,
    currentTabId: null
};

// DOM Elements
let elements = {};

// ===== Initialize =====
document.addEventListener('DOMContentLoaded', async () => {
    initElements();
    loadSettings();
    setupEventListeners();
    await checkConnection();

    // Listen for messages
    chrome.runtime.onMessage.addListener(handleMessage);
});

function initElements() {
    elements = {
        connectionBanner: document.getElementById('connectionBanner'),
        connectionText: document.getElementById('connectionText'),
        modeButtons: document.querySelectorAll('[data-mode]'),
        ratioButtons: document.querySelectorAll('[data-ratio]'),
        aspectRatioSection: document.getElementById('aspectRatioSection'),
        autoDownload: document.getElementById('autoDownload'),
        delaySeconds: document.getElementById('delaySeconds'),
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
        stopBtn: document.getElementById('stopBtn'),
        queueList: document.getElementById('queueList'),
        queueCount: document.getElementById('queueCount'),
        clearQueueBtn: document.getElementById('clearQueueBtn'),
        logList: document.getElementById('logList'),
        clearLogBtn: document.getElementById('clearLogBtn')
    };
}

// ===== Event Listeners =====
function setupEventListeners() {
    // Mode toggle
    elements.modeButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            elements.modeButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.mode = btn.dataset.mode;
            updateModeUI();
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

    // Auto download toggle
    elements.autoDownload.addEventListener('change', () => {
        state.autoDownload = elements.autoDownload.checked;
        saveSettings();
    });

    // Delay seconds
    elements.delaySeconds.addEventListener('change', () => {
        state.delaySeconds = parseInt(elements.delaySeconds.value) || 3;
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
            addLog('info', `Reference image selected: ${file.name}`);
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
    elements.promptsInput.addEventListener('input', updatePromptCount);

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
                addLog('info', `Loaded ${parsePrompts(event.target.result).length} prompts from file`);
            };
            reader.readAsText(file);
        }
    });

    // Send button
    elements.sendBtn.addEventListener('click', startGeneration);

    // Stop button
    elements.stopBtn.addEventListener('click', stopGeneration);

    // Clear queue
    elements.clearQueueBtn.addEventListener('click', () => {
        state.queue = [];
        renderQueue();
    });

    // Clear log
    elements.clearLogBtn.addEventListener('click', () => {
        elements.logList.innerHTML = '<div class="log-empty">No activity yet</div>';
    });
}

// ===== Connection =====
async function checkConnection() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (tab && tab.url && tab.url.includes('meta.ai')) {
            state.currentTabId = tab.id;

            // Try to ping content script
            try {
                const response = await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
                if (response && response.status === 'ok') {
                    setConnected(true);
                    return;
                }
            } catch (e) {
                // Content script not loaded, try to inject it
                try {
                    await chrome.scripting.executeScript({
                        target: { tabId: tab.id },
                        files: ['content/content.js']
                    });
                    await chrome.scripting.insertCSS({
                        target: { tabId: tab.id },
                        files: ['content/content.css']
                    });

                    // Wait a bit and try again
                    await delay(500);
                    const response = await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
                    if (response && response.status === 'ok') {
                        setConnected(true);
                        addLog('success', 'Connected to Meta AI');
                        return;
                    }
                } catch (injectError) {
                    console.log('Could not inject script:', injectError);
                }
            }
        }

        setConnected(false);
    } catch (error) {
        console.error('Connection check error:', error);
        setConnected(false);
    }
}

function setConnected(connected) {
    state.isConnected = connected;
    elements.connectionBanner.className = `connection-banner ${connected ? 'connected' : 'disconnected'}`;
    elements.connectionText.textContent = connected ? 'เชื่อมต่อกับ Meta AI แล้ว' : 'กรุณาเปิดหน้า meta.ai';
}

// ===== Generation =====
async function startGeneration() {
    if (!state.isConnected) {
        addLog('error', 'Not connected to Meta AI. Please open meta.ai first.');
        await checkConnection();
        return;
    }

    const prompts = parsePrompts(elements.promptsInput.value);
    if (prompts.length === 0) {
        addLog('error', 'No prompts to generate');
        return;
    }

    state.queue = prompts.map((text, index) => ({
        id: Date.now() + index,
        text,
        status: 'pending'
    }));

    renderQueue();
    state.isProcessing = true;
    elements.sendBtn.disabled = true;
    elements.stopBtn.disabled = false;

    addLog('info', `Starting generation of ${prompts.length} prompts...`);

    // Prepare reference image
    let refImageData = null;
    if (state.refImage) {
        refImageData = await fileToBase64(state.refImage);
    }

    // Send to content script
    try {
        await chrome.tabs.sendMessage(state.currentTabId, {
            action: 'startGeneration',
            data: {
                mode: state.mode,
                aspectRatio: state.aspectRatio,
                autoDownload: state.autoDownload,
                delaySeconds: state.delaySeconds,
                refImage: refImageData,
                prompts: state.queue
            }
        });
    } catch (error) {
        addLog('error', `Failed to start: ${error.message}`);
        resetProcessingState();
    }
}

async function stopGeneration() {
    try {
        await chrome.tabs.sendMessage(state.currentTabId, { action: 'stopGeneration' });
        addLog('info', 'Generation stopped by user');
    } catch (error) {
        console.error('Stop error:', error);
    }
    resetProcessingState();
}

function resetProcessingState() {
    state.isProcessing = false;
    elements.sendBtn.disabled = false;
    elements.stopBtn.disabled = true;
}

// ===== Message Handler =====
function handleMessage(message, sender, sendResponse) {
    console.log('Received message:', message);

    switch (message.action) {
        case 'updateQueue':
            updateQueueItem(message.data.promptId, message.data.status);
            break;
        case 'log':
            addLog(message.data.type || 'info', message.data.message);
            break;
        case 'generationComplete':
            addLog('success', 'All prompts completed!');
            resetProcessingState();
            break;
        case 'error':
            addLog('error', message.data.message);
            break;
    }

    sendResponse({ received: true });
    return true;
}

function updateQueueItem(promptId, status) {
    const item = state.queue.find(q => q.id === promptId);
    if (item) {
        item.status = status;
        renderQueue();

        if (status === 'generating') {
            addLog('info', `Generating: ${item.text.substring(0, 50)}...`);
        } else if (status === 'completed') {
            addLog('success', `Completed: ${item.text.substring(0, 50)}...`);
        } else if (status === 'error') {
            addLog('error', `Failed: ${item.text.substring(0, 50)}...`);
        }
    }
}

// ===== UI Functions =====
function updateModeUI() {
    // Hide aspect ratio section for Video mode (only supports 16:9)
    if (elements.aspectRatioSection) {
        if (state.mode === 'video') {
            elements.aspectRatioSection.style.display = 'none';
        } else {
            elements.aspectRatioSection.style.display = 'block';
        }
    }
}

function parsePrompts(text) {
    return text
        .split(/\n\s*\n/)
        .map(p => p.trim())
        .filter(p => p.length > 0);
}

function updatePromptCount() {
    const prompts = parsePrompts(elements.promptsInput.value);
    elements.promptCount.textContent = `${prompts.length} prompt${prompts.length !== 1 ? 's' : ''}`;
}

function showImagePreview(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        elements.refImagePreview.innerHTML = `<img src="${e.target.result}" alt="Preview">`;
        elements.refImagePreview.classList.remove('hidden');
    };
    reader.readAsDataURL(file);
}

function renderQueue() {
    if (state.queue.length === 0) {
        elements.queueList.innerHTML = '<div class="queue-empty">No prompts in queue</div>';
        elements.queueCount.textContent = '0 prompts';
        return;
    }

    const completed = state.queue.filter(q => q.status === 'completed').length;
    elements.queueCount.textContent = `${completed}/${state.queue.length}`;

    elements.queueList.innerHTML = state.queue.map((item, index) => `
    <div class="queue-item ${item.status}">
      <span class="queue-item-number">${index + 1}</span>
      <span class="queue-item-text" title="${escapeHtml(item.text)}">${escapeHtml(item.text)}</span>
      <span class="queue-item-status">${getStatusIcon(item.status)}</span>
    </div>
  `).join('');
}

function getStatusIcon(status) {
    const icons = {
        pending: '⏳',
        generating: '🔄',
        downloading: '⬇️',
        completed: '✅',
        error: '❌'
    };
    return icons[status] || '⏳';
}

function addLog(type, message) {
    const time = new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const logHtml = `<div class="log-item ${type}"><span class="log-time">${time}</span><span>${escapeHtml(message)}</span></div>`;

    if (elements.logList.querySelector('.log-empty')) {
        elements.logList.innerHTML = '';
    }

    elements.logList.insertAdjacentHTML('afterbegin', logHtml);

    // Keep only last 50 logs
    while (elements.logList.children.length > 50) {
        elements.logList.lastChild.remove();
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ===== Settings =====
function saveSettings() {
    chrome.storage.local.set({
        mode: state.mode,
        aspectRatio: state.aspectRatio,
        autoDownload: state.autoDownload,
        delaySeconds: state.delaySeconds
    });
}

function loadSettings() {
    chrome.storage.local.get(['mode', 'aspectRatio', 'autoDownload', 'delaySeconds'], (result) => {
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

        if (result.autoDownload !== undefined) {
            state.autoDownload = result.autoDownload;
            elements.autoDownload.checked = state.autoDownload;
        }

        if (result.delaySeconds) {
            state.delaySeconds = result.delaySeconds;
            elements.delaySeconds.value = state.delaySeconds;
        }

        // Update UI based on mode (hide aspect ratio for video mode)
        updateModeUI();
    });
}
