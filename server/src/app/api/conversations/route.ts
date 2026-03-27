import { NextRequest, NextResponse } from "next/server";
import {
    withDatabase,
    messageHash,
    htmlToText,
} from "@/lib/database";

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
};

// GET /api/conversations
export async function GET() {
    const db = await withDatabase((db) => ({
        result: db,
        save: false,
    }));
    return NextResponse.json(db, { headers: CORS_HEADERS });
}

// POST /api/conversations
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { conversationId, role, content, rawHtml } = body;

        if (!conversationId || !role || !content) {
            return NextResponse.json(
                { error: "Missing required fields" },
                { status: 400, headers: CORS_HEADERS }
            );
        }

        const result = await withDatabase((db) => {
            const now = new Date().toISOString();

            let conversation = db.conversations.find(
                (c) => c.id === conversationId
            );

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
                return { result: { duplicate: true }, save: false };
            }

            const processedContent = rawHtml ? htmlToText(rawHtml) : content;

            conversation.messages.push({
                role,
                content: processedContent,
                rawHtml,
                timestamp: now,
            });
            conversation.updatedAt = now;

            console.log(
                `[API] Saved ${role} message (${processedContent.length} chars)`
            );

            return { result: { duplicate: false }, save: true };
        });

        return NextResponse.json(
            { success: true, ...result },
            { headers: CORS_HEADERS }
        );
    } catch (error) {
        console.error("[API conversations] Error:", error);
        return NextResponse.json(
            { error: "Failed to save message" },
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
