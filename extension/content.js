/**
 * Copiloter Content Script v15 - With Sync Response
 * Captures HTML + can receive messages from server to inject into Copilot
 * Returns Copilot's response synchronously
 */

const SERVER_URL = "http://localhost:3001";
let lastSentHtml = '';
let streamingCheckTimer = null;
let pollTimer = null;

function getConversationId() {
    const match = window.location.pathname.match(/\/chats\/([^/]+)/);
    return match ? match[1] : null;
}

function isStreaming() {
    const stopButton = document.querySelector(
        '[aria-label*="Stop"], [aria-label*="停止"], [data-testid*="stop"]'
    );
    if (stopButton) return true;

    const typingIndicator = document.querySelector(
        '.animate-pulse, [aria-busy="true"], [class*="generating"]'
    );
    if (typingIndicator) return true;

    return false;
}

/**
 * Get the last AI message content
 */
function getLastAiMessage() {
    const aiMessages = document.querySelectorAll('[data-content="ai-message"]');
    if (aiMessages.length === 0) return null;

    const lastAiMessage = aiMessages[aiMessages.length - 1];
    const content = lastAiMessage.textContent?.trim() || "";
    const rawHtml = lastAiMessage.innerHTML || "";

    return { content, rawHtml };
}

/**
 * Count current message count
 */
function getMessageCount() {
    const userMessages = document.querySelectorAll('[data-content="user-message"]');
    const aiMessages = document.querySelectorAll('[data-content="ai-message"]');
    return userMessages.length + aiMessages.length;
}

/**
 * Send a message by typing into Copilot's input and clicking send
 * Returns the Copilot response
 */
async function sendMessageToCopilot(message, requestId) {
    console.log(`[Copiloter] Sending message to Copilot: "${message.substring(0, 50)}..."`);

    const initialMessageCount = getMessageCount();

    // Find the textarea/input
    const textarea = document.querySelector(
        'textarea[placeholder*="Message"], textarea[data-testid*="composer"], ' +
        'textarea[aria-label*="Message"], [contenteditable="true"][data-testid*="composer"]'
    );

    if (!textarea) {
        console.error("[Copiloter] Could not find input textarea");
        return { error: "Could not find input textarea" };
    }

    // Focus and set value
    textarea.focus();

    // For contenteditable divs
    if (textarea.getAttribute('contenteditable') === 'true') {
        textarea.innerText = message;
        textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    } else {
        // For regular textareas
        textarea.value = message;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // Wait a moment for the UI to update
    await new Promise(r => setTimeout(r, 100));

    // Find and click the send button
    const sendButton = document.querySelector(
        'button[aria-label*="Send"], button[aria-label*="送信"], ' +
        'button[data-testid*="send"], button[type="submit"]'
    );

    if (!sendButton || sendButton.disabled) {
        console.error("[Copiloter] Could not find/click send button");
        return { error: "Could not find send button" };
    }

    sendButton.click();
    console.log("[Copiloter] ✓ Message sent, waiting for response...");

    // Wait for the AI to start responding
    await new Promise(r => setTimeout(r, 1000));

    // Wait for streaming to complete (max 60 seconds)
    let waitTime = 0;
    const maxWait = 60000;

    while (waitTime < maxWait) {
        // Check if we have a new message
        const currentCount = getMessageCount();
        if (currentCount > initialMessageCount + 1) {
            // New AI message appeared, wait for streaming to stop
            if (!isStreaming()) {
                break;
            }
        }

        await new Promise(r => setTimeout(r, 500));
        waitTime += 500;
    }

    // Small delay to ensure content is fully rendered
    await new Promise(r => setTimeout(r, 500));

    // Get the response
    const response = getLastAiMessage();

    if (response) {
        console.log(`[Copiloter] ✓ Got response (${response.content.length} chars)`);
        return response;
    } else {
        return { error: "No response received" };
    }
}

/**
 * Poll server for pending messages and send responses back
 */
async function pollForMessages() {
    const conversationId = getConversationId();

    // Don't poll while streaming
    if (isStreaming()) return;

    try {
        // Always poll for "new" session messages first (to catch new session requests)
        const newSessionResponse = await fetch(
            `${SERVER_URL}/api/send?conversationId=new`
        );

        if (newSessionResponse.ok) {
            const newData = await newSessionResponse.json();

            for (const item of newData.messages || []) {
                const { requestId, message, newSession } = item;

                // If newSession requested and we're in an existing conversation, navigate to root
                if (newSession && conversationId) {
                    console.log("[Copiloter] New session requested, navigating to root...");
                    // Store the pending message to send after navigation
                    sessionStorage.setItem('pendingMessage', JSON.stringify({ requestId, message }));
                    window.location.href = "https://copilot.microsoft.com/";
                    return; // Will re-poll after page loads
                }

                // If we're on the root page (no conversationId), send the message now
                if (!conversationId && message) {
                    console.log(`[Copiloter] Sending message in new session: "${message.substring(0, 30)}..."`);
                    const copilotResponse = await sendMessageToCopilot(message, requestId);

                    if (requestId) {
                        await fetch(`${SERVER_URL}/api/send`, {
                            method: "PUT",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                requestId,
                                response: copilotResponse,
                            }),
                        });
                        console.log(`[Copiloter] ✓ Response sent back to server`);
                    }
                }
            }
        }

        // Also poll for the current conversation's messages if we have one
        if (conversationId) {
            const response = await fetch(
                `${SERVER_URL}/api/send?conversationId=${conversationId}`
            );

            if (response.ok) {
                const data = await response.json();

                for (const item of data.messages || []) {
                    const { requestId, message } = item;

                    if (!message) continue;

                    // Send message and get response
                    const copilotResponse = await sendMessageToCopilot(message, requestId);

                    // Send response back to server
                    if (requestId) {
                        try {
                            await fetch(`${SERVER_URL}/api/send`, {
                                method: "PUT",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                    requestId,
                                    response: copilotResponse,
                                }),
                            });
                            console.log(`[Copiloter] ✓ Response sent back for ${requestId}`);
                        } catch (e) {
                            console.error("[Copiloter] Failed to send response:", e);
                        }
                    }

                    // Wait before processing next message
                    await new Promise(r => setTimeout(r, 1000));
                }
            }
        }
    } catch (error) {
        // Silent fail on poll errors
    }
}

async function sendToServer() {
    const conversationId = getConversationId();
    if (!conversationId) return;

    if (isStreaming()) {
        clearTimeout(streamingCheckTimer);
        streamingCheckTimer = setTimeout(sendToServer, 1000);
        return;
    }

    const chatContainer = document.querySelector('[data-testid="chat-page"]') ||
        document.querySelector('[class*="@container/chat"]');

    if (!chatContainer) return;

    const rawHtml = chatContainer.innerHTML;

    if (rawHtml === lastSentHtml) return;

    console.log(`[Copiloter] Sending HTML (${rawHtml.length} chars)...`);

    try {
        const response = await fetch(`${SERVER_URL}/api/capture`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                conversationId,
                url: window.location.href,
                rawHtml,
                timestamp: new Date().toISOString(),
            }),
        });

        if (response.ok) {
            lastSentHtml = rawHtml;
            const data = await response.json();
            console.log(`[Copiloter] ✓ Captured ${data.messageCount || 0} messages`);
        }
    } catch (error) {
        console.error("[Copiloter] Error:", error.message);
    }
}

function setupObserver() {
    const target = document.querySelector('[data-testid="chat-page"]') ||
        document.querySelector('[class*="@container/chat"]') ||
        document.body;

    new MutationObserver(() => {
        clearTimeout(window.copiloterTimeout);
        window.copiloterTimeout = setTimeout(sendToServer, 2500);
    }).observe(target, { childList: true, subtree: true, characterData: true });

    console.log("[Copiloter] Observer active");
}

function startPolling() {
    // Poll every 2 seconds for pending messages
    pollTimer = setInterval(pollForMessages, 2000);
    console.log("[Copiloter] Polling for messages...");
}

/**
 * Check for pending message from sessionStorage (set when navigating to new session)
 */
async function checkPendingMessage() {
    const pendingData = sessionStorage.getItem('pendingMessage');
    if (!pendingData) return;

    // Clear it immediately to prevent duplicate sends
    sessionStorage.removeItem('pendingMessage');

    const conversationId = getConversationId();

    // Only process if we're on the root page (new session)
    if (conversationId) {
        console.log("[Copiloter] Not on root page, skipping pending message");
        return;
    }

    try {
        const { requestId, message } = JSON.parse(pendingData);
        console.log(`[Copiloter] 📬 Processing pending new session message: "${message.substring(0, 30)}..."`);

        // Wait for the page to be fully ready
        await new Promise(r => setTimeout(r, 3000));

        // Send the message
        const copilotResponse = await sendMessageToCopilot(message, requestId);

        // Send response back to server
        if (requestId) {
            await fetch(`${SERVER_URL}/api/send`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    requestId,
                    response: copilotResponse,
                }),
            });
            console.log(`[Copiloter] ✓ New session response sent back to server`);
        }
    } catch (e) {
        console.error("[Copiloter] Failed to process pending message:", e);
    }
}

function init() {
    console.log("[Copiloter] === v16 (new session support) ===");
    console.log("[Copiloter] Server:", SERVER_URL);
    console.log("[Copiloter] Conv:", getConversationId());

    setTimeout(sendToServer, 2000);
    setupObserver();
    startPolling();

    // Check for pending message from new session navigation
    checkPendingMessage();

    let lastUrl = location.href;
    new MutationObserver(() => {
        if (location.href !== lastUrl) {
            lastUrl = location.href;
            lastSentHtml = '';
            setTimeout(sendToServer, 2000);
        }
    }).observe(document, { subtree: true, childList: true });
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}
