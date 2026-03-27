/**
 * Copiloter Content Script v16 - With Sync Response
 * Captures HTML + can receive messages from server to inject into Copilot
 * Returns Copilot's response synchronously
 */

(function () {
    "use strict";

    const SERVER_URL = "http://localhost:3001";
    let lastSentHtml = "";
    let streamingCheckTimer = null;
    let pollTimer = null;
    let debounceTimer = null;
    let polling = false;

    function getConversationId() {
        const match = window.location.pathname.match(/\/chats\/([^/]+)/);
        return match ? match[1] : null;
    }

    function isStreaming() {
        const stopButton = document.querySelector(
            '[aria-label*="Stop"], [aria-label*="\u505C\u6B62"], [data-testid*="stop"]'
        );
        if (stopButton) return true;

        const typingIndicator = document.querySelector(
            '.animate-pulse, [aria-busy="true"], [class*="generating"]'
        );
        if (typingIndicator) return true;

        return false;
    }

    function getLastAiMessage() {
        const aiMessages = document.querySelectorAll(
            '[data-content="ai-message"]'
        );
        if (aiMessages.length === 0) return null;

        const lastAiMessage = aiMessages[aiMessages.length - 1];
        const content = lastAiMessage.textContent?.trim() || "";
        const rawHtml = lastAiMessage.innerHTML || "";

        return { content, rawHtml };
    }

    function getMessageCount() {
        const userMessages = document.querySelectorAll(
            '[data-content="user-message"]'
        );
        const aiMessages = document.querySelectorAll(
            '[data-content="ai-message"]'
        );
        return userMessages.length + aiMessages.length;
    }

    /**
     * Send response back to server for a given requestId.
     */
    async function sendResponseToServer(requestId, copilotResponse) {
        if (!requestId) return;

        try {
            await fetch(`${SERVER_URL}/api/send`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    requestId,
                    response: copilotResponse,
                }),
            });
            console.log(
                `[Copiloter] Response sent back for ${requestId}`
            );
        } catch (e) {
            console.error(
                "[Copiloter] Failed to send response:",
                e
            );
        }
    }

    /**
     * Send a message by typing into Copilot's input and clicking send.
     * Returns the Copilot response.
     */
    async function sendMessageToCopilot(message) {
        console.log(
            `[Copiloter] Sending message to Copilot: "${message.substring(0, 50)}..."`
        );

        const initialMessageCount = getMessageCount();

        const textarea = document.querySelector(
            'textarea[placeholder*="Message"], textarea[data-testid*="composer"], ' +
                'textarea[aria-label*="Message"], [contenteditable="true"][data-testid*="composer"]'
        );

        if (!textarea) {
            console.error("[Copiloter] Could not find input textarea");
            return { error: "Could not find input textarea" };
        }

        textarea.focus();

        if (textarea.getAttribute("contenteditable") === "true") {
            textarea.innerText = message;
            textarea.dispatchEvent(
                new InputEvent("input", { bubbles: true })
            );
        } else {
            textarea.value = message;
            textarea.dispatchEvent(
                new Event("input", { bubbles: true })
            );
        }

        await new Promise((r) => setTimeout(r, 100));

        const sendButton = document.querySelector(
            'button[aria-label*="Send"], button[aria-label*="\u9001\u4FE1"], ' +
                'button[data-testid*="send"], button[type="submit"]'
        );

        if (!sendButton || sendButton.disabled) {
            console.error("[Copiloter] Could not find/click send button");
            return { error: "Could not find send button" };
        }

        sendButton.click();
        console.log("[Copiloter] Message sent, waiting for response...");

        await new Promise((r) => setTimeout(r, 1000));

        let waitTime = 0;
        const maxWait = 60000;

        while (waitTime < maxWait) {
            const currentCount = getMessageCount();
            if (currentCount > initialMessageCount + 1) {
                if (!isStreaming()) {
                    break;
                }
            }

            await new Promise((r) => setTimeout(r, 500));
            waitTime += 500;
        }

        await new Promise((r) => setTimeout(r, 500));

        const response = getLastAiMessage();

        if (response) {
            console.log(
                `[Copiloter] Got response (${response.content.length} chars)`
            );
            return response;
        }
        return { error: "No response received" };
    }

    /**
     * Poll server for pending messages and send responses back.
     */
    async function pollForMessages() {
        if (polling) return;
        polling = true;

        const conversationId = getConversationId();

        if (isStreaming()) {
            polling = false;
            return;
        }

        try {
            const newSessionResponse = await fetch(
                `${SERVER_URL}/api/send?conversationId=new`
            );

            if (newSessionResponse.ok) {
                const newData = await newSessionResponse.json();

                for (const item of newData.messages || []) {
                    const { requestId, message, newSession } = item;

                    if (!message) continue;

                    if (newSession && conversationId) {
                        console.log(
                            "[Copiloter] New session requested, navigating to root..."
                        );
                        sessionStorage.setItem(
                            "pendingMessage",
                            JSON.stringify({ requestId, message })
                        );
                        window.location.href =
                            "https://copilot.microsoft.com/";
                        polling = false;
                        return;
                    }

                    if (!conversationId) {
                        console.log(
                            `[Copiloter] Sending message in new session: "${message.substring(0, 30)}..."`
                        );
                        const copilotResponse =
                            await sendMessageToCopilot(message);
                        await sendResponseToServer(
                            requestId,
                            copilotResponse
                        );
                    }
                }
            }

            if (conversationId) {
                const response = await fetch(
                    `${SERVER_URL}/api/send?conversationId=${encodeURIComponent(conversationId)}`
                );

                if (response.ok) {
                    const data = await response.json();

                    for (const item of data.messages || []) {
                        const { requestId, message } = item;

                        if (!message) continue;

                        const copilotResponse =
                            await sendMessageToCopilot(message);
                        await sendResponseToServer(
                            requestId,
                            copilotResponse
                        );

                        await new Promise((r) => setTimeout(r, 1000));
                    }
                }
            }
        } catch (error) {
            // Log poll errors at debug level to aid troubleshooting
            console.debug("[Copiloter] Poll error:", error);
        } finally {
            polling = false;
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

        const chatContainer =
            document.querySelector('[data-testid="chat-page"]') ||
            document.querySelector('[class*="@container/chat"]');

        if (!chatContainer) return;

        const rawHtml = chatContainer.innerHTML;

        if (rawHtml === lastSentHtml) return;

        console.log(
            `[Copiloter] Sending HTML (${rawHtml.length} chars)...`
        );

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
                console.log(
                    `[Copiloter] Captured ${data.messageCount || 0} messages`
                );
            }
        } catch (error) {
            console.error(
                "[Copiloter] Capture error:",
                error instanceof Error ? error.message : error
            );
        }
    }

    function setupObserver() {
        const target =
            document.querySelector('[data-testid="chat-page"]') ||
            document.querySelector('[class*="@container/chat"]') ||
            document.body;

        new MutationObserver(() => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(sendToServer, 2500);
        }).observe(target, {
            childList: true,
            subtree: true,
            characterData: true,
        });

        console.log("[Copiloter] Observer active");
    }

    function startPolling() {
        stopPolling();
        pollTimer = setInterval(pollForMessages, 2000);
        console.log("[Copiloter] Polling for messages...");
    }

    function stopPolling() {
        if (pollTimer !== null) {
            clearInterval(pollTimer);
            pollTimer = null;
        }
    }

    async function checkPendingMessage() {
        const pendingData = sessionStorage.getItem("pendingMessage");
        if (!pendingData) return;

        sessionStorage.removeItem("pendingMessage");

        const conversationId = getConversationId();

        if (conversationId) {
            console.log(
                "[Copiloter] Not on root page, skipping pending message"
            );
            return;
        }

        try {
            const { requestId, message } = JSON.parse(pendingData);
            console.log(
                `[Copiloter] Processing pending new session message: "${message.substring(0, 30)}..."`
            );

            await new Promise((r) => setTimeout(r, 3000));

            const copilotResponse =
                await sendMessageToCopilot(message);
            await sendResponseToServer(requestId, copilotResponse);
        } catch (e) {
            console.error(
                "[Copiloter] Failed to process pending message:",
                e
            );
        }
    }

    function init() {
        console.log("[Copiloter] === v16 (new session support) ===");
        console.log("[Copiloter] Server:", SERVER_URL);
        console.log("[Copiloter] Conv:", getConversationId());

        setTimeout(sendToServer, 2000);
        setupObserver();
        startPolling();
        checkPendingMessage();

        let lastUrl = location.href;
        new MutationObserver(() => {
            if (location.href !== lastUrl) {
                lastUrl = location.href;
                lastSentHtml = "";
                setTimeout(sendToServer, 2000);
            }
        }).observe(document, { subtree: true, childList: true });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
