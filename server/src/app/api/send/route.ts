import { NextRequest, NextResponse } from "next/server";

// Store pending messages for the extension to poll
const pendingMessages: Map<string, string[]> = new Map();

// Store responses from the extension (keyed by request ID)
const pendingResponses: Map<string, {
    resolve: (value: any) => void;
    timeout: NodeJS.Timeout;
}> = new Map();

// Store captured responses
const capturedResponses: Map<string, any> = new Map();

// POST /api/send - Send a message to Copilot and wait for response
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { conversationId, message, timeout = 60000 } = body;

        if (!message) {
            return NextResponse.json(
                { error: "Missing message" },
                { status: 400 }
            );
        }

        // Use "new" for new session (no conversationId), otherwise use the provided ID
        const isNewSession = !conversationId;
        const id = conversationId || "new";
        const requestId = `${id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

        // Queue the message for the extension
        if (!pendingMessages.has(id)) {
            pendingMessages.set(id, []);
        }

        // Store message with request ID and newSession flag for tracking
        const messageWithId = JSON.stringify({ requestId, message, newSession: isNewSession });
        pendingMessages.get(id)!.push(messageWithId);

        console.log(`[API] Queued message for ${id} (requestId: ${requestId}): "${message.substring(0, 50)}..."`);

        // Wait for the response from the extension
        const response = await new Promise((resolve, reject) => {
            const timeoutHandle = setTimeout(() => {
                pendingResponses.delete(requestId);
                reject(new Error("Timeout waiting for Copilot response"));
            }, timeout);

            pendingResponses.set(requestId, {
                resolve: (value: any) => {
                    clearTimeout(timeoutHandle);
                    pendingResponses.delete(requestId);
                    resolve(value);
                },
                timeout: timeoutHandle,
            });
        });

        return NextResponse.json({
            success: true,
            response,
        });
    } catch (error: any) {
        console.error("Error:", error);
        return NextResponse.json({
            success: false,
            error: error.message || "Failed"
        }, { status: 500 });
    }
}

// GET /api/send - Extension polls for pending messages
export async function GET(request: NextRequest) {
    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    };

    const searchParams = request.nextUrl.searchParams;
    const conversationId = searchParams.get("conversationId") || "current";

    const messages = pendingMessages.get(conversationId) || [];

    // Also check "current" queue if they're asking for a specific conversation
    const currentMessages = conversationId !== "current"
        ? (pendingMessages.get("current") || [])
        : [];

    const allMessages = [...currentMessages, ...messages];

    // Parse messages and extract the actual message text
    const parsedMessages = allMessages.map(msg => {
        try {
            const parsed = JSON.parse(msg);
            return { requestId: parsed.requestId, message: parsed.message, newSession: parsed.newSession };
        } catch {
            return { requestId: null, message: msg };
        }
    });

    // Clear the queues
    if (messages.length > 0) {
        pendingMessages.set(conversationId, []);
    }
    if (currentMessages.length > 0) {
        pendingMessages.set("current", []);
    }

    return NextResponse.json({
        messages: parsedMessages,
    }, { headers: corsHeaders });
}

// PUT /api/send - Extension sends back the Copilot response
export async function PUT(request: NextRequest) {
    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    };

    try {
        const body = await request.json();
        const { requestId, response, error } = body;

        if (!requestId) {
            return NextResponse.json(
                { error: "Missing requestId" },
                { status: 400, headers: corsHeaders }
            );
        }

        console.log(`[API] Received response for requestId: ${requestId}`);

        const pending = pendingResponses.get(requestId);
        if (pending) {
            if (error) {
                pending.resolve({ error });
            } else {
                pending.resolve(response);
            }
            return NextResponse.json({ success: true }, { headers: corsHeaders });
        } else {
            // Store it in case the waiting request hasn't started yet
            capturedResponses.set(requestId, response || { error });
            return NextResponse.json({
                success: true,
                note: "No pending request found, response cached"
            }, { headers: corsHeaders });
        }
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
            "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        },
    });
}
