/**
 * Hot Reload Server for Chrome Extension
 * Run with: node reload-server.js
 *
 * Watches for file changes and notifies the extension to reload
 */

const WebSocket = require("ws");
const chokidar = require("chokidar");
const path = require("path");

const PORT = 8089;
const EXTENSION_DIR = path.join(__dirname, "extension");

const wss = new WebSocket.Server({ port: PORT });
const clients = new Set();

wss.on("connection", (ws) => {
    clients.add(ws);
    console.log(`[HMR] Extension connected (${clients.size} clients)`);

    ws.on("close", () => {
        clients.delete(ws);
        console.log(`[HMR] Extension disconnected (${clients.size} clients)`);
    });

    ws.on("error", (err) => {
        console.error(`[HMR] Client WebSocket error: ${err.message}`);
        clients.delete(ws);
    });
});

wss.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
        console.error(`[HMR] Port ${PORT} is already in use. Is another instance running?`);
        process.exit(1);
    }
    console.error(`[HMR] WebSocket server error: ${err.message}`);
});

// Watch extension files
const watcher = chokidar.watch(EXTENSION_DIR, {
    ignored: /node_modules/,
    persistent: true,
});

let debounceTimer = null;

watcher.on("change", (filePath) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        console.log(`[HMR] File changed: ${path.basename(filePath)}`);
        clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send("reload");
            }
        });
    }, 300);
});

watcher.on("error", (err) => {
    console.error(`[HMR] File watcher error: ${err.message}`);
});

console.log(`[HMR] Reload server running on ws://localhost:${PORT}`);
console.log(`[HMR] Watching: ${EXTENSION_DIR}`);
