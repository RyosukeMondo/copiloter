import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { JSDOM } from "jsdom";

interface Message {
    role: "user" | "assistant";
    content: string;
    rawHtml: string;
    timestamp: string;
}

interface Conversation {
    id: string;
    url: string;
    messages: Message[];
    rawHtml: string;
    createdAt: string;
    updatedAt: string;
}

interface Database {
    conversations: Conversation[];
}

const DATA_DIR = join(process.cwd(), "data");
const DATA_FILE = join(DATA_DIR, "conversations.json");

function ensureDataFile(): Database {
    if (!existsSync(DATA_DIR)) {
        mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!existsSync(DATA_FILE)) {
        const initial: Database = { conversations: [] };
        writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
        return initial;
    }
    return JSON.parse(readFileSync(DATA_FILE, "utf-8"));
}

function saveDatabase(db: Database) {
    writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

/**
 * Parse raw HTML and extract messages in order
 */
function parseMessages(rawHtml: string): Message[] {
    const dom = new JSDOM(rawHtml);
    const doc = dom.window.document;
    const messages: Message[] = [];
    const now = new Date().toISOString();

    // Find all header elements (H5=user, H6=AI) in DOM order
    const allHeaders = doc.querySelectorAll(
        'h5[aria-label*="発言"], h6[aria-label*="発言"], ' +
        'h5[aria-label*="message"], h6[aria-label*="Copilot"]'
    );

    allHeaders.forEach((header) => {
        const ariaLabel = header.getAttribute("aria-label") || "";
        const isUser = header.tagName === "H5" || ariaLabel.includes("あなた");
        const role = isUser ? "user" : "assistant";

        const parent = header.parentElement;
        if (!parent) return;

        let contentElement: Element | null = null;

        if (isUser) {
            // User: find [data-content="user-message"]
            contentElement = parent.querySelector('[data-content="user-message"]');
        } else {
            // AI: next sibling
            contentElement = parent.nextElementSibling;
        }

        if (contentElement) {
            const content = contentElement.textContent?.trim() || "";
            const msgHtml = contentElement.innerHTML || "";

            if (content.length > 0) {
                messages.push({
                    role: role as "user" | "assistant",
                    content,
                    rawHtml: msgHtml,
                    timestamp: now,
                });
            }
        }
    });

    return messages;
}

// POST /api/capture - Receive raw HTML and parse on server
export async function POST(request: NextRequest) {
    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    };

    try {
        const body = await request.json();
        const { conversationId, url, rawHtml, timestamp } = body;

        if (!conversationId || !rawHtml) {
            return NextResponse.json(
                { error: "Missing conversationId or rawHtml" },
                { status: 400, headers: corsHeaders }
            );
        }

        const db = ensureDataFile();

        // Parse messages from HTML
        const messages = parseMessages(rawHtml);
        console.log(`[API] Parsed ${messages.length} messages from HTML`);

        // Find or create conversation
        let conversation = db.conversations.find((c) => c.id === conversationId);

        if (!conversation) {
            conversation = {
                id: conversationId,
                url: url || "",
                messages: [],
                rawHtml: "",
                createdAt: timestamp || new Date().toISOString(),
                updatedAt: timestamp || new Date().toISOString(),
            };
            db.conversations.unshift(conversation);
        }

        // Update conversation
        conversation.url = url || conversation.url;
        conversation.rawHtml = rawHtml;
        conversation.messages = messages;
        conversation.updatedAt = timestamp || new Date().toISOString();

        saveDatabase(db);

        return NextResponse.json({
            success: true,
            messageCount: messages.length,
        }, { headers: corsHeaders });
    } catch (error) {
        console.error("Error:", error);
        return NextResponse.json({ error: "Failed" }, { status: 500, headers: corsHeaders });
    }
}

export async function OPTIONS() {
    return new NextResponse(null, {
        status: 200,
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        },
    });
}
