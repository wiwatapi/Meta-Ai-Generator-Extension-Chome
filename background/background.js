// ===== Meta AI Generator - Background Service Worker =====

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener(async (tab) => {
    await chrome.sidePanel.open({ tabId: tab.id });
});

// Set side panel behavior - open on action click
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Track download counter for unique naming
let downloadCounter = 0;

// Intercept downloads and set proper filename
chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
    // Check if it's from Meta AI / fbcdn
    const url = downloadItem.url || '';
    const referrer = downloadItem.referrer || '';

    const isMetaAI = url.includes('fbcdn.net') ||
        url.includes('meta.ai') ||
        referrer.includes('meta.ai') ||
        downloadItem.byExtensionId === chrome.runtime.id;

    // Check if filename has no extension or is a UUID-like name
    const filename = downloadItem.filename || '';
    const basename = filename.split(/[/\\]/).pop();
    const hasNoExtension = !basename.includes('.') || /^[a-f0-9-]{20,}$/i.test(basename);

    if (isMetaAI && hasNoExtension) {
        downloadCounter++;
        const timestamp = new Date().toISOString().slice(0, 10);
        const timeStr = new Date().toTimeString().slice(0, 8).replace(/:/g, '');
        const newFilename = `Meta AI/${timestamp}/meta-ai-${timeStr}-${downloadCounter}.jpg`;

        console.log(`📥 Renaming: ${basename} -> ${newFilename}`);
        suggest({ filename: newFilename, conflictAction: 'uniquify' });
        return true; // Indicates we will call suggest asynchronously
    }

    // Let default behavior continue
    return false;
});

// Handle messages from content script and side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'downloadImage') {
        downloadImage(message.url, message.filename);
        sendResponse({ status: 'downloading' });
        return true;
    }

    if (message.action === 'downloadVideo') {
        downloadVideo(message.url, message.filename);
        sendResponse({ status: 'downloading' });
        return true;
    }

    // Forward messages to side panel
    if (message.action === 'updateQueue' || message.action === 'log' ||
        message.action === 'generationComplete' || message.action === 'error') {
        // Broadcast to all extension pages
        chrome.runtime.sendMessage(message).catch(() => {
            // Side panel might not be open
        });
    }

    return true;
});

// Download image using chrome.downloads API
async function downloadImage(url, filename) {
    try {
        const timestamp = new Date().toISOString().slice(0, 10);
        const safeName = filename.replace(/[<>:"/\\|?*]/g, '_');

        let downloadUrl = url;

        // If not a data URL, fetch and convert
        if (!url.startsWith('data:')) {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Fetch failed: ${response.status}`);
            }

            const blob = await response.blob();
            const arrayBuffer = await blob.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);
            let binary = '';
            for (let i = 0; i < uint8Array.length; i++) {
                binary += String.fromCharCode(uint8Array[i]);
            }
            const base64 = btoa(binary);
            const mimeType = blob.type || 'image/jpeg';
            downloadUrl = `data:${mimeType};base64,${base64}`;
        }

        // Download with proper filename
        const downloadId = await chrome.downloads.download({
            url: downloadUrl,
            filename: `Meta AI/${timestamp}/${safeName}`,
            saveAs: false
        });

        console.log('📥 Downloaded:', safeName, 'ID:', downloadId);

    } catch (error) {
        console.error('Download failed:', error);
    }
}

// Download video using chrome.downloads API
async function downloadVideo(url, filename) {
    try {
        const timestamp = new Date().toISOString().slice(0, 10);
        const safeName = filename.replace(/[<>:"/\\|?*]/g, '_');

        let downloadUrl = url;

        // If not a data URL, fetch and convert
        if (!url.startsWith('data:')) {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Fetch failed: ${response.status}`);
            }

            const blob = await response.blob();
            const arrayBuffer = await blob.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);
            let binary = '';
            for (let i = 0; i < uint8Array.length; i++) {
                binary += String.fromCharCode(uint8Array[i]);
            }
            const base64 = btoa(binary);
            const mimeType = blob.type || 'video/mp4';
            downloadUrl = `data:${mimeType};base64,${base64}`;
        }

        // Download with proper filename
        const downloadId = await chrome.downloads.download({
            url: downloadUrl,
            filename: `Meta AI/${timestamp}/${safeName}`,
            saveAs: false
        });

        console.log('🎬 Downloaded video:', safeName, 'ID:', downloadId);

    } catch (error) {
        console.error('Video download failed:', error);
    }
}

// On installation
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        console.log('Meta AI Generator extension installed');
        chrome.storage.local.set({
            mode: 'image',
            aspectRatio: '9:16',
            autoDownload: true,
            delaySeconds: 3
        });
    }
});
