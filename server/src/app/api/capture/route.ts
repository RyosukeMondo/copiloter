import { NextRequest, NextResponse } from "next/server";
import { JSDOM } from "jsdom";
import { withDatabase, Message } from "@/lib/database";

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
};

/**
 * Parse raw HTML and extract messages in order.
 */
function parseMessages(rawHtml: string): Message[] {
    const dom = new JSDOM(rawHtml);
    const doc = dom.window.document;
    const messages: Message[] = [];
    const now = new Date().toISOString();

    const allHeaders = doc.querySelectorAll(
        'h5[aria-label*="\u767A\u8A00"], h6[aria-label*="\u767A\u8A00"], ' +
        'h5[aria-label*="message"], h6[aria-label*="Copilot"]'
    );

    allHeaders.forEach((header) => {
        const ariaLabel = header.getAttribute("aria-label") || "";
        const isUser = header.tagName === "H5" || ariaLabel.includes("\u3042\u306A\u305F");
        const role: "user" | "assistant" = isUser ? "user" : "assistant";

        const parent = header.parentElement;
        if (!parent) return;

        let contentElement: Element | null = null;

        if (isUser) {
            contentElement = parent.querySelector('[data-content="user-message"]');
        } else {
            contentElement = parent.nextElementSibling;
        }

        if (contentElement) {
            const content = contentElement.textContent?.trim() || "";
            const msgHtml = contentElement.innerHTML || "";

            if (content.length > 0) {
                messages.push({
                    role,
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
    try {
        const body = await request.json();
        const { conversationId, url, rawHtml, timestamp } = body;

        if (!conversationId || !rawHtml) {
            return NextResponse.json(
                { error: "Missing conversationId or rawHtml" },
                { status: 400, headers: CORS_HEADERS }
            );
        }

        const messages = parseMessages(rawHtml);
        console.log(`[API] Parsed ${messages.length} messages from HTML`);

        const messageCount = await withDatabase((db) => {
            let conversation = db.conversations.find(
                (c) => c.id === conversationId
            );

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

            conversation.url = url || conversation.url;
            conversation.rawHtml = rawHtml;
            conversation.messages = messages;
            conversation.updatedAt = timestamp || new Date().toISOString();

            return { result: messages.length, save: true };
        });

        return NextResponse.json(
            { success: true, messageCount },
            { headers: CORS_HEADERS }
        );
    } catch (error) {
        console.error("[API capture] Error:", error);
        return NextResponse.json(
            { error: "Failed to capture conversation" },
            { status: 500, headers: CORS_HEADERS }
        );
    }
}

export async function OPTIONS() {
    return new NextResponse(null, {
        status: 200,
        headers: CORS_HEADERS,
    });
}
