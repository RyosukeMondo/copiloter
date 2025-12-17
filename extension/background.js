/**
 * Extension Hot Reload - Background Script
 * Watches for file changes via a local server and reloads the extension
 */

const RELOAD_SERVER = "ws://localhost:8089";
let socket = null;

function connect() {
    try {
        socket = new WebSocket(RELOAD_SERVER);

        socket.onopen = () => {
            console.log("[HMR] Connected to reload server");
        };

        socket.onmessage = (event) => {
            if (event.data === "reload") {
                console.log("[HMR] Reloading extension...");
                chrome.runtime.reload();
            }
        };

        socket.onclose = () => {
            console.log("[HMR] Disconnected, reconnecting in 3s...");
            setTimeout(connect, 3000);
        };

        socket.onerror = () => {
            socket.close();
        };
    } catch (e) {
        console.log("[HMR] Server not running");
        setTimeout(connect, 5000);
    }
}

// Start connection
connect();
