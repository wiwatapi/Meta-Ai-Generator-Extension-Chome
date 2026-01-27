// ===== Meta AI Image Generator - Content Script =====

console.log('Meta AI Generator: Content script loaded');

// Selectors - Updated based on actual page inspection
const SELECTORS = {
    promptInput: [
        'div[role="textbox"][contenteditable="true"]',
        'div[aria-label="Message Meta AI"]',
        'div[aria-label="Message"]',
        'textarea',
        'input[type="text"]'
    ],
    submitButton: [
        'button[aria-label="Send"]',
        'button[aria-label="ส่ง"]',
        'button[type="submit"]',
    ],
    // Mode/Aspect ratio dropdowns (combobox buttons)
    modeDropdown: 'button[role="combobox"]',
    dropdownOption: 'div[role="option"], div[role="menuitem"]',
    // Generated images and videos
    generatedImage: 'img[src*="fbcdn.net"]',
    generatedVideo: 'video[src*="fbcdn.net"], video source[src*="fbcdn.net"]'
};

// State
let isProcessing = false;
let shouldStop = false;
let currentQueue = [];
let settings = {
    mode: 'image',
    aspectRatio: '9:16',
    autoDownload: true,
    delaySeconds: 3,
    refImage: null
};

// ===== Message Listener =====
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Content script received:', message.action);

    if (message.action === 'ping') {
        sendResponse({ status: 'ok' });
        return true;
    }

    if (message.action === 'startGeneration') {
        const { mode, aspectRatio, autoDownload, delaySeconds, refImage, prompts } = message.data;
        settings = { mode, aspectRatio, autoDownload, delaySeconds, refImage };
        currentQueue = prompts;
        shouldStop = false;
        startProcessing();
        sendResponse({ status: 'started' });
        return true;
    }

    if (message.action === 'stopGeneration') {
        shouldStop = true;
        isProcessing = false;
        sendResponse({ status: 'stopped' });
        return true;
    }

    return true;
});

// ===== Helper: Find Element =====
function findElement(selectors) {
    if (typeof selectors === 'string') {
        return document.querySelector(selectors);
    }

    for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (el) return el;
    }
    return null;
}

function findAllElements(selectors) {
    if (typeof selectors === 'string') {
        return document.querySelectorAll(selectors);
    }

    for (const selector of selectors) {
        const els = document.querySelectorAll(selector);
        if (els.length > 0) return els;
    }
    return [];
}

// ===== Notify Side Panel =====
function notifyPanel(action, data) {
    chrome.runtime.sendMessage({ action, data }).catch(() => { });
}

function log(type, message) {
    console.log(`[${type}] ${message}`);
    notifyPanel('log', { type, message });
}

// ===== Main Processing =====
async function startProcessing() {
    if (isProcessing) {
        log('error', 'Already processing');
        return;
    }

    isProcessing = true;
    log('info', 'Starting generation process...');

    try {
        // Set mode first
        await setMode(settings.mode);
        await delay(500);

        // Set aspect ratio (only for image mode - video is always 16:9)
        if (settings.mode !== 'video') {
            await setAspectRatio(settings.aspectRatio);
            await delay(500);
        }

        // Process each prompt
        for (let i = 0; i < currentQueue.length; i++) {
            if (shouldStop) {
                log('info', 'Generation stopped');
                break;
            }

            const prompt = currentQueue[i];

            try {
                notifyPanel('updateQueue', { promptId: prompt.id, status: 'generating' });

                // Clear previous input and enter new prompt
                await clearAndEnterPrompt(prompt.text);
                await delay(500);

                // Capture current media BEFORE submitting
                const isVideoMode = settings.mode === 'video';

                // For videos: track COUNT (URLs can change)
                // For images: track URLs (they're stable)
                const countBefore = isVideoMode ? countVideos() : 0;
                const mediaBefore = isVideoMode ? null : getAllImageUrls();
                log('info', `${isVideoMode ? 'Videos' : 'Images'} before: ${isVideoMode ? countBefore : mediaBefore.size}`);

                // Click generate
                const submitted = await clickSubmit();
                if (!submitted) {
                    throw new Error('Could not find submit button');
                }

                // Wait for generation
                log('info', `Waiting for ${isVideoMode ? 'video' : 'images'} to generate...`);

                let newMediaUrls;
                if (isVideoMode) {
                    // For videos: wait for count to increase, then get the new ones
                    newMediaUrls = await waitForNewVideosByCount(countBefore);
                } else {
                    newMediaUrls = await waitForNewImages(mediaBefore);
                }

                if (shouldStop) {
                    log('info', 'Generation stopped during wait');
                    break;
                }

                // Auto download if enabled
                if (settings.autoDownload && newMediaUrls && newMediaUrls.length > 0) {
                    notifyPanel('updateQueue', { promptId: prompt.id, status: 'downloading' });
                    log('info', 'Starting auto-download...');
                    if (isVideoMode) {
                        await downloadNewVideos(newMediaUrls);
                    } else {
                        await downloadNewImages(newMediaUrls);
                    }
                }

                notifyPanel('updateQueue', { promptId: prompt.id, status: 'completed' });

                // Delay between prompts
                if (i < currentQueue.length - 1 && !shouldStop) {
                    log('info', `Waiting ${settings.delaySeconds}s before next prompt...`);
                    await delay(settings.delaySeconds * 1000);
                }

            } catch (error) {
                log('error', `Error: ${error.message}`);
                notifyPanel('updateQueue', { promptId: prompt.id, status: 'error' });
            }
        }

    } catch (error) {
        log('error', `Fatal error: ${error.message}`);
    }

    isProcessing = false;
    notifyPanel('generationComplete', {});
}

// ===== Set Mode =====
async function setMode(mode) {
    const modeText = mode === 'image' ? 'รูปภาพ' : 'วิดีโอ';
    const modeTextEn = mode === 'image' ? 'Image' : 'Video';

    try {
        // Find all combobox buttons (mode and aspect ratio)
        const dropdowns = document.querySelectorAll(SELECTORS.modeDropdown);
        log('info', `Found ${dropdowns.length} dropdown buttons`);

        if (dropdowns.length > 0) {
            // First dropdown is usually Mode (Image/Video)
            dropdowns[0].click();
            await delay(500);

            const options = document.querySelectorAll(SELECTORS.dropdownOption);
            log('info', `Found ${options.length} options`);

            for (const option of options) {
                const text = option.textContent.toLowerCase();
                if (text.includes(modeText.toLowerCase()) || text.includes(modeTextEn.toLowerCase())) {
                    option.click();
                    log('success', `Mode set to: ${mode}`);
                    await delay(300);
                    return true;
                }
            }

            // Close dropdown if no match
            document.body.click();
            log('warn', 'Mode option not found in dropdown');
        } else {
            log('warn', 'No mode dropdown found on page');
        }
    } catch (e) {
        log('error', `Could not set mode: ${e.message}`);
    }
    return false;
}

// ===== Set Aspect Ratio =====
async function setAspectRatio(ratio) {
    try {
        // Wait a bit for UI to update after mode selection
        await delay(500);

        // Re-query dropdowns (might have changed after mode selection)
        const dropdowns = document.querySelectorAll(SELECTORS.modeDropdown);
        log('info', `Found ${dropdowns.length} dropdowns for aspect ratio`);

        // Try to find the aspect ratio dropdown
        // It might be the 2nd dropdown, or we need to find one that shows ratio text
        let targetDropdown = null;

        if (dropdowns.length > 1) {
            // If there are multiple dropdowns, the 2nd one is likely aspect ratio
            targetDropdown = dropdowns[1];
        } else if (dropdowns.length === 1) {
            // If only 1 dropdown and mode was already set, this might be the ratio dropdown
            // Check if it contains ratio-like text
            const text = dropdowns[0].textContent || '';
            if (text.includes(':') || text.includes('1:1') || text.includes('9:16') || text.includes('16:9')) {
                targetDropdown = dropdowns[0];
            }
        }

        // Also try to find by looking for buttons with ratio text
        if (!targetDropdown) {
            const allButtons = document.querySelectorAll('button');
            for (const btn of allButtons) {
                const text = btn.textContent || '';
                if (text.includes('1:1') || text.includes('9:16') || text.includes('16:9')) {
                    targetDropdown = btn;
                    break;
                }
            }
        }

        if (targetDropdown) {
            targetDropdown.click();
            await delay(500);

            const options = document.querySelectorAll(SELECTORS.dropdownOption);
            log('info', `Found ${options.length} ratio options`);

            for (const option of options) {
                if (option.textContent.includes(ratio)) {
                    option.click();
                    log('success', `Aspect ratio set to: ${ratio}`);
                    await delay(300);
                    return true;
                }
            }

            // Close dropdown if not found
            document.body.click();
            log('warn', `Aspect ratio "${ratio}" not found in options`);
        } else {
            log('warn', 'Aspect ratio dropdown not found on page');
        }
    } catch (e) {
        log('error', `Could not set aspect ratio: ${e.message}`);
    }
    return false;
}

// ===== Enter Prompt =====
async function clearAndEnterPrompt(text) {
    const input = findElement(SELECTORS.promptInput);
    if (!input) {
        throw new Error('Could not find prompt input');
    }

    // Focus
    input.focus();
    await delay(100);

    // Technique 1: Clear
    document.execCommand('selectAll', false, null);
    document.execCommand('delete', false, null);
    await delay(50);

    if (input.innerHTML.length > 0) {
        input.innerHTML = '';
    }

    // Technique 2: Insert Text (Native event simulation)
    // This is most likely to trigger React's onChange
    input.focus();
    const subText = text || ' ';

    // Method A: execCommand match
    const success = document.execCommand('insertText', false, subText);

    // Method B: Dispatch textInput event (often used by legacy React/Draft.js)
    if (!success) {
        const textEvent = document.createEvent('TextEvent');
        textEvent.initTextEvent('textInput', true, true, null, subText);
        input.dispatchEvent(textEvent);
    }

    // Method C: Input Event
    input.textContent = subText;
    input.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: subText
    }));

    // Method D: Change Event
    input.dispatchEvent(new Event('change', { bubbles: true }));

    await delay(500);

    // Check if empty (sometimes clear fails or text insert fails)
    if (input.innerText.trim() === '') {
        log('info', 'Retry input entry...');
        input.innerText = text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    log('info', `Entered prompt: ${text.substring(0, 50)}...`);
}

// ===== Click Submit =====
async function clickSubmit() {
    log('info', 'Searching for submit button...');

    const inputEl = findElement(SELECTORS.promptInput);

    // METHOD 1: Try Enter key first (most reliable for Meta AI)
    if (inputEl) {
        inputEl.focus();
        await delay(200);

        // Dispatch Enter key event
        const enterEvent = new KeyboardEvent('keydown', {
            bubbles: true,
            cancelable: true,
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13
        });

        inputEl.dispatchEvent(enterEvent);
        log('info', 'Dispatched Enter key');

        // Wait to see if it works
        await delay(1000);

        // Check if input was cleared (indicates submit worked)
        const inputContent = inputEl.innerText || inputEl.textContent || '';
        if (inputContent.trim().length < 10) {
            log('success', 'Submit via Enter key worked');
            return true;
        }
    }

    // METHOD 2: Try clicking buttons
    for (let attempt = 0; attempt < 5; attempt++) {
        await delay(400);

        // 2a. Try explicit selectors first
        for (const selector of SELECTORS.submitButton) {
            const button = document.querySelector(selector);
            if (button && !button.disabled) {
                dispatchClick(button);
                log('success', `Clicked submit: ${selector}`);
                await delay(500);
                return true;
            }
        }

        // 2b. Find button by aria-label
        const allButtons = Array.from(document.querySelectorAll('button'));
        const enabledButtons = allButtons.filter(b => !b.disabled);

        for (const btn of enabledButtons) {
            const label = (btn.getAttribute('aria-label') || '').toLowerCase();
            if (label.includes('send') || label.includes('ส่ง') || label.includes('submit') || label.includes('generate')) {
                dispatchClick(btn);
                log('success', `Clicked submit (label: ${label})`);
                await delay(500);
                return true;
            }
        }

        // 2c. Find SVG button near input
        if (inputEl) {
            const inputRect = inputEl.getBoundingClientRect();
            const svgButtons = enabledButtons.filter(btn => btn.querySelector('svg'));

            // Find buttons on the same row as input
            const nearbyButtons = svgButtons.filter(btn => {
                const rect = btn.getBoundingClientRect();
                return Math.abs(rect.top - inputRect.top) < 100 && rect.left > inputRect.left;
            });

            if (nearbyButtons.length > 0) {
                // Click the rightmost one (usually the send button)
                nearbyButtons.sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right);
                dispatchClick(nearbyButtons[0]);
                log('success', 'Clicked SVG button near input');
                await delay(500);
                return true;
            }
        }
    }

    log('error', 'Could not find submit button');
    return false;
}

// Helper to dispatch mouse events properly
function dispatchClick(element) {
    const events = ['mousedown', 'mouseup', 'click'];
    events.forEach(type => {
        element.dispatchEvent(new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window
        }));
    });
}


// ===== Get All Current Image URLs =====
function getAllImageUrls() {
    const imgs = document.querySelectorAll('img[src*="fbcdn.net"]');
    const urls = new Set();
    imgs.forEach(img => {
        if (img.src && (img.width > 150 || img.naturalWidth > 150)) {
            urls.add(img.src);
        }
    });
    return urls;
}

// ===== Wait for NEW Images =====
async function waitForNewImages(imagesBefore, timeout = 120000) {
    const startTime = Date.now();
    log('info', 'Waiting for new images to appear...');

    let lastNewCount = 0;
    let stableCount = 0;

    while (Date.now() - startTime < timeout) {
        if (shouldStop) {
            return null;
        }

        // Get current images
        const currentUrls = getAllImageUrls();

        // Find NEW URLs (not in imagesBefore)
        const newUrls = [];
        currentUrls.forEach(url => {
            if (!imagesBefore.has(url)) {
                newUrls.push(url);
            }
        });

        // Meta AI typically generates 4 images at once
        // Wait for count to stabilize (same count for 3 checks)
        if (newUrls.length >= 4) {
            if (newUrls.length === lastNewCount) {
                stableCount++;
                if (stableCount >= 2) {
                    // Count is stable, images are ready
                    log('success', `Found ${newUrls.length} NEW images!`);
                    // Only return first 4 (the actual new generation)
                    return newUrls.slice(0, 4);
                }
            } else {
                stableCount = 0;
            }
            lastNewCount = newUrls.length;
        }

        await delay(1500);
    }

    // Timeout - return whatever we found
    const finalUrls = getAllImageUrls();
    const newUrls = [];
    finalUrls.forEach(url => {
        if (!imagesBefore.has(url)) {
            newUrls.push(url);
        }
    });

    if (newUrls.length > 0) {
        log('warn', `Timeout, but found ${newUrls.length} new images`);
        return newUrls.slice(0, 4);
    }

    throw new Error('Generation timeout - no new images appeared');
}

// ===== Download Only New Images =====
async function downloadNewImages(imageUrls) {
    if (!imageUrls || imageUrls.length === 0) {
        log('error', 'No new images to download');
        return;
    }

    log('info', `Downloading ${imageUrls.length} new images...`);

    let count = 0;
    for (const url of imageUrls) {
        if (shouldStop) break;

        try {
            notifyPanel('log', { type: 'info', message: `Downloading image ${count + 1}/${imageUrls.length}` });

            chrome.runtime.sendMessage({
                action: 'downloadImage',
                url: url,
                filename: `meta-ai-${Date.now()}-${count + 1}.jpg`
            });

            count++;
            await delay(500);

        } catch (e) {
            log('error', `Failed to download: ${e.message}`);
        }
    }

    log('success', `Downloaded ${count}/${imageUrls.length} images!`);
}

// ===== Count Videos on Page =====
function countVideos() {
    const videos = document.querySelectorAll('video');
    let count = 0;
    videos.forEach(video => {
        const width = video.videoWidth || video.clientWidth || video.offsetWidth || 0;
        const height = video.videoHeight || video.clientHeight || video.offsetHeight || 0;
        // Count videos larger than 100px (not UI elements)
        if (width > 100 || height > 100) {
            count++;
        }
    });
    return count;
}

// ===== Get Video URLs (ordered by position in DOM) =====
function getVideoUrls() {
    const videos = document.querySelectorAll('video');
    const urls = [];

    videos.forEach(video => {
        // Get src from video element
        let src = video.src || video.currentSrc;

        // If no src on video tag, check source child element
        if (!src || src === '') {
            const source = video.querySelector('source');
            if (source) src = source.src;
        }

        if (src && src.length > 0) {
            const width = video.videoWidth || video.clientWidth || video.offsetWidth || 0;
            const height = video.videoHeight || video.clientHeight || video.offsetHeight || 0;

            if (width > 100 || height > 100) {
                urls.push(src);
            }
        }
    });

    return urls;
}

// ===== Wait for New Videos by Count =====
async function waitForNewVideosByCount(countBefore, timeout = 180000) {
    const startTime = Date.now();
    log('info', 'Waiting for new videos to appear...');

    let stableCount = 0;
    let lastCount = countBefore;

    while (Date.now() - startTime < timeout) {
        if (shouldStop) {
            return null;
        }

        const currentCount = countVideos();
        const newCount = currentCount - countBefore;

        // Log progress every 10 seconds
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        if (elapsed % 10 === 0 && elapsed > 0) {
            log('info', `[${elapsed}s] Videos: ${currentCount} (was ${countBefore}, new: ${newCount})`);
        }

        // Check if count increased
        if (currentCount > countBefore) {
            if (currentCount === lastCount) {
                stableCount++;
                // Wait for stable count for 3 checks (6 seconds)
                if (stableCount >= 3) {
                    const numNew = currentCount - countBefore;
                    log('success', `Found ${numNew} NEW video(s)!`);

                    // Get the FIRST N video URLs (Meta AI inserts new videos at the beginning)
                    const allUrls = getVideoUrls();
                    const newUrls = allUrls.slice(0, numNew); // Get first N

                    await delay(2000); // Wait for videos to fully load
                    return newUrls;
                }
            } else {
                stableCount = 0;
            }
            lastCount = currentCount;
        }

        await delay(2000);
    }

    // Timeout - return whatever new videos we can find
    const finalCount = countVideos();
    const numNew = finalCount - countBefore;

    if (numNew > 0) {
        log('warn', `Timeout, but found ${numNew} new video(s)`);
        const allUrls = getVideoUrls();
        return allUrls.slice(0, numNew); // Get first N
    }

    throw new Error('Generation timeout - no new video appeared');
}

// ===== Wait for NEW Videos =====
async function waitForNewVideos(videosBefore, timeout = 180000) {
    const startTime = Date.now();
    log('info', 'Waiting for new videos to appear...');

    let stableCount = 0;
    let lastNewCount = 0;
    let checkCount = 0;

    while (Date.now() - startTime < timeout) {
        if (shouldStop) {
            return null;
        }

        // Get current videos
        const currentUrls = getAllVideoUrls();
        checkCount++;

        // Find NEW URLs (not in videosBefore)
        const newUrls = [];
        currentUrls.forEach(url => {
            if (!videosBefore.has(url)) {
                newUrls.push(url);
            }
        });

        // Log progress every 5 checks
        if (checkCount % 5 === 0) {
            log('info', `Check #${checkCount}: Total=${currentUrls.size}, New=${newUrls.length}`);
        }

        // Video mode: wait for at least 1 new video
        // Meta AI may generate 1-4 videos depending on mode
        if (newUrls.length >= 1) {
            if (newUrls.length === lastNewCount) {
                stableCount++;
                // Wait for count to be stable for 3 checks (6 seconds)
                if (stableCount >= 3) {
                    // Wait extra time for videos to fully load
                    await delay(3000);
                    log('success', `Found ${newUrls.length} NEW video(s)!`);
                    return newUrls; // Return all new videos found
                }
            } else {
                stableCount = 0;
            }
            lastNewCount = newUrls.length;
        }

        await delay(2000); // Check every 2 seconds
    }

    // Timeout - return whatever we found
    const finalUrls = getAllVideoUrls();
    const newUrls = [];
    finalUrls.forEach(url => {
        if (!videosBefore.has(url)) {
            newUrls.push(url);
        }
    });

    if (newUrls.length > 0) {
        log('warn', `Timeout, but found ${newUrls.length} new video(s)`);
        return newUrls;
    }

    throw new Error('Generation timeout - no new video appeared');
}

// ===== Download Only New Videos =====
async function downloadNewVideos(videoUrls) {
    if (!videoUrls || videoUrls.length === 0) {
        log('error', 'No new videos to download');
        return;
    }

    log('info', `Downloading ${videoUrls.length} new video(s)...`);

    let count = 0;
    for (const url of videoUrls) {
        if (shouldStop) break;

        try {
            notifyPanel('log', { type: 'info', message: `Downloading video ${count + 1}/${videoUrls.length}` });

            chrome.runtime.sendMessage({
                action: 'downloadVideo',
                url: url,
                filename: `meta-ai-video-${Date.now()}-${count + 1}.mp4`
            });

            count++;
            await delay(1000);

        } catch (e) {
            log('error', `Failed to download video: ${e.message}`);
        }
    }

    log('success', `Downloaded ${count}/${videoUrls.length} video(s)!`);
}

// ===== Utility =====
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

