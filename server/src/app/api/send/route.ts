import { NextRequest, NextResponse } from "next/server";

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
};

const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_TIMEOUT_MS = 60_000;

// Pending messages queued for the extension to poll
const pendingMessages = new Map<string, string[]>();

// Pending response resolvers keyed by requestId
const pendingResponses = new Map<
    string,
    { resolve: (value: unknown) => void; timeout: NodeJS.Timeout }
>();

function clampTimeout(value: unknown): number {
    const num = typeof value === "number" ? value : DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(num) || num <= 0) return DEFAULT_TIMEOUT_MS;
    return Math.min(num, MAX_TIMEOUT_MS);
}

// POST /api/send - Send a message to Copilot and wait for response
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { conversationId, message, timeout } = body;

        if (!message || typeof message !== "string") {
            return NextResponse.json(
                { error: "Missing or invalid message" },
                { status: 400, headers: CORS_HEADERS }
            );
        }

        const effectiveTimeout = clampTimeout(timeout);
        const isNewSession = !conversationId;
        const id = conversationId || "new";
        const requestId = `${id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

        // Queue the message for the extension
        const queue = pendingMessages.get(id) ?? [];
        queue.push(JSON.stringify({ requestId, message, newSession: isNewSession }));
        pendingMessages.set(id, queue);

        console.log(
            `[API] Queued message for ${id} (requestId: ${requestId}): "${message.substring(0, 50)}..."`
        );

        // Wait for the response from the extension
        const response = await new Promise((resolve, reject) => {
            const timeoutHandle = setTimeout(() => {
                pendingResponses.delete(requestId);
                reject(new Error("Timeout waiting for Copilot response"));
            }, effectiveTimeout);

            pendingResponses.set(requestId, {
                resolve: (value: unknown) => {
                    clearTimeout(timeoutHandle);
                    pendingResponses.delete(requestId);
                    resolve(value);
                },
                timeout: timeoutHandle,
            });
        });

        return NextResponse.json(
            { success: true, response },
            { headers: CORS_HEADERS }
        );
    } catch (error: unknown) {
        const message =
            error instanceof Error ? error.message : "Failed";
        console.error("[API send POST] Error:", message);
        return NextResponse.json(
            { success: false, error: message },
            { status: 500, headers: CORS_HEADERS }
        );
    }
}

// GET /api/send - Extension polls for pending messages
export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const conversationId = searchParams.get("conversationId") || "current";

    const messages = pendingMessages.get(conversationId) ?? [];
    const currentMessages =
        conversationId !== "current"
            ? (pendingMessages.get("current") ?? [])
            : [];

    const allMessages = [...currentMessages, ...messages];

    const parsedMessages = allMessages.map((msg) => {
        try {
            const parsed = JSON.parse(msg);
            return {
                requestId: parsed.requestId,
                message: parsed.message,
                newSession: parsed.newSession,
            };
        } catch {
            return { requestId: null, message: msg };
        }
    });

    // Delete consumed queues instead of leaving empty arrays
    if (messages.length > 0) {
        pendingMessages.delete(conversationId);
    }
    if (currentMessages.length > 0) {
        pendingMessages.delete("current");
    }

    return NextResponse.json(
        { messages: parsedMessages },
        { headers: CORS_HEADERS }
    );
}

// PUT /api/send - Extension sends back the Copilot response
export async function PUT(request: NextRequest) {
    try {
        const body = await request.json();
        const { requestId, response, error } = body;

        if (!requestId || typeof requestId !== "string") {
            return NextResponse.json(
                { error: "Missing or invalid requestId" },
                { status: 400, headers: CORS_HEADERS }
            );
        }

        console.log(`[API] Received response for requestId: ${requestId}`);

        const pending = pendingResponses.get(requestId);
        if (pending) {
            pending.resolve(error ? { error } : response);
            return NextResponse.json(
                { success: true },
                { headers: CORS_HEADERS }
            );
        }

        // No pending resolver -- the POST request already timed out
        console.warn(
            `[API] No pending request for ${requestId} (likely timed out)`
        );
        return NextResponse.json(
            { success: false, error: "No pending request (likely timed out)" },
            { status: 404, headers: CORS_HEADERS }
        );
    } catch (error) {
        console.error("[API send PUT] Error:", error);
        return NextResponse.json(
            { error: "Failed to process response" },
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
