import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

interface Message {
    role: "user" | "assistant";
    content: string;
    rawHtml?: string;
    timestamp: string;
}

interface Conversation {
    id: string;
    messages: Message[];
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

function messageHash(role: string, content: string): string {
    const key = `${role}:${content.substring(0, 100)}`;
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
        hash = ((hash << 5) - hash) + key.charCodeAt(i);
        hash = hash & hash;
    }
    return hash.toString(36);
}

/**
 * Convert raw HTML to text with preserved line breaks
 */
function htmlToText(html: string): string {
    if (!html) return '';

    return html
        // Add newlines for block elements
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/div>/gi, '\n')
        .replace(/<\/h[1-6]>/gi, '\n\n')
        .replace(/<\/li>/gi, '\n')
        // Strip all remaining HTML tags
        .replace(/<[^>]+>/g, '')
        // Decode HTML entities
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        // Clean up whitespace
        .replace(/\n{4,}/g, '\n\n\n')
        .trim();
}

// GET /api/conversations
export async function GET() {
    const db = ensureDataFile();
    return NextResponse.json(db);
}

// POST /api/conversations
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { conversationId, role, content, rawHtml } = body;

        if (!conversationId || !role || !content) {
            return NextResponse.json(
                { error: "Missing required fields" },
                { status: 400 }
            );
        }

        const db = ensureDataFile();
        const now = new Date().toISOString();

        let conversation = db.conversations.find((c) => c.id === conversationId);

        if (!conversation) {
            conversation = {
                id: conversationId,
                messages: [],
                createdAt: now,
                updatedAt: now,
            };
            db.conversations.unshift(conversation);
        }

        // Dedup check
        const newHash = messageHash(role, content);
        const isDuplicate = conversation.messages.some(
            (msg) => messageHash(msg.role, msg.content) === newHash
        );

        if (isDuplicate) {
            return NextResponse.json({ success: true, duplicate: true });
        }

        // Process HTML to text with line breaks if rawHtml provided
        const processedContent = rawHtml ? htmlToText(rawHtml) : content;

        conversation.messages.push({
            role,
            content: processedContent,
            rawHtml,
            timestamp: now,
        });
        conversation.updatedAt = now;

        saveDatabase(db);

        console.log(`[API] Saved ${role} message (${processedContent.length} chars)`);

        return NextResponse.json({ success: true, duplicate: false });
    } catch (error) {
        console.error("Error:", error);
        return NextResponse.json({ error: "Failed" }, { status: 500 });
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
