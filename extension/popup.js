const SERVER_URL = "http://localhost:3001";

async function checkServerStatus() {
    const statusDot = document.getElementById("statusDot");
    const statusText = document.getElementById("statusText");

    try {
        const response = await fetch(`${SERVER_URL}/api/conversations`);
        if (response.ok) {
            const data = await response.json();
            const count = data.conversations?.length || 0;
            statusDot.classList.remove("inactive");
            statusText.textContent = `Connected • ${count} conversation${count !== 1 ? "s" : ""} captured`;
        } else {
            throw new Error("Server error");
        }
    } catch (error) {
        statusDot.classList.add("inactive");
        statusText.textContent = "Server not reachable";
    }
}

async function getCurrentConversationId() {
    const convIdEl = document.getElementById("convId");
    const endpointBox = document.getElementById("endpointBox");
    const copyIdBtn = document.getElementById("copyIdBtn");

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        if (tab && tab.url) {
            const match = tab.url.match(/copilot\.microsoft\.com\/chats\/([^/?#]+)/);
            if (match) {
                const convId = match[1];
                convIdEl.innerHTML = `<strong>${convId}</strong>`;
                convIdEl.dataset.convId = convId;
                copyIdBtn.style.display = "block";

                // Update endpoint with conversation ID
                const curlCmd = `curl -X POST ${SERVER_URL}/api/send \\
  -H "Content-Type: application/json" \\
  -d '{"conversationId": "${convId}", "message": "Hello!"}'`;

                endpointBox.textContent = curlCmd;
                endpointBox.dataset.curl = curlCmd;
                return;
            }
        }

        convIdEl.innerHTML = '<span class="no-conv">Not on a Copilot chat page</span>';
        copyIdBtn.style.display = "none";

        // Generic endpoint
        const genericCmd = `curl -X POST ${SERVER_URL}/api/send \\
  -H "Content-Type: application/json" \\
  -d '{"message": "Hello!"}'`;

        endpointBox.textContent = genericCmd;
        endpointBox.dataset.curl = genericCmd;
    } catch (error) {
        console.error("Error getting tab:", error);
    }
}

function setupCopyButton() {
    const copyBtn = document.getElementById("copyBtn");
    const endpointBox = document.getElementById("endpointBox");
    const copyIdBtn = document.getElementById("copyIdBtn");
    const convIdEl = document.getElementById("convId");

    copyBtn.addEventListener("click", async () => {
        const text = endpointBox.dataset.curl || endpointBox.textContent;
        try {
            await navigator.clipboard.writeText(text);
            copyBtn.textContent = "✓ Copied!";
            copyBtn.classList.add("copied");
            setTimeout(() => {
                copyBtn.textContent = "📋 Copy";
                copyBtn.classList.remove("copied");
            }, 2000);
        } catch (err) {
            console.error("Failed to copy:", err);
        }
    });

    copyIdBtn.addEventListener("click", async () => {
        const convId = convIdEl.dataset.convId;
        if (convId) {
            try {
                await navigator.clipboard.writeText(convId);
                copyIdBtn.textContent = "✓";
                copyIdBtn.classList.add("copied");
                setTimeout(() => {
                    copyIdBtn.textContent = "📋";
                    copyIdBtn.classList.remove("copied");
                }, 2000);
            } catch (err) {
                console.error("Failed to copy:", err);
            }
        }
    });
}

document.getElementById("viewBtn").addEventListener("click", () => {
    chrome.tabs.create({ url: SERVER_URL });
});

document.getElementById("refreshBtn").addEventListener("click", () => {
    checkServerStatus();
    getCurrentConversationId();
});

// Initialize
checkServerStatus();
getCurrentConversationId();
setupCopyButton();
