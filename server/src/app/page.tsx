"use client";

import { useEffect, useState } from "react";

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

export default function Home() {
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [showRawHtml, setShowRawHtml] = useState(true);

    useEffect(() => {
        fetchConversations();
    }, []);

    async function fetchConversations() {
        try {
            const res = await fetch("/api/conversations");
            const data = await res.json();
            setConversations(data.conversations || []);
        } catch (error) {
            console.error("Failed to fetch conversations:", error);
        } finally {
            setLoading(false);
        }
    }

    const totalMessages = conversations.reduce(
        (sum, c) => sum + c.messages.length,
        0
    );

    const selectedConversation = conversations.find((c) => c.id === selectedId);

    if (loading) {
        return (
            <div className="container">
                <div className="loading">
                    <div className="spinner"></div>
                </div>
            </div>
        );
    }

    return (
        <div className="container">
            <header>
                <h1>🤖 Copiloter</h1>
                <div className="stats">
                    <div className="stat">
                        <div className="stat-value">{conversations.length}</div>
                        <div className="stat-label">Conversations</div>
                    </div>
                    <div className="stat">
                        <div className="stat-value">{totalMessages}</div>
                        <div className="stat-label">Messages</div>
                    </div>
                </div>
            </header>

            {selectedConversation ? (
                <div>
                    <div style={{ display: "flex", gap: "1rem", marginBottom: "1rem" }}>
                        <button
                            onClick={() => setSelectedId(null)}
                            style={{
                                background: "var(--bg-secondary)",
                                border: "1px solid var(--border)",
                                color: "var(--text-primary)",
                                padding: "0.5rem 1rem",
                                borderRadius: "6px",
                                cursor: "pointer",
                            }}
                        >
                            ← Back
                        </button>
                        <button
                            onClick={() => setShowRawHtml(!showRawHtml)}
                            style={{
                                background: showRawHtml ? "var(--accent)" : "var(--bg-secondary)",
                                border: "1px solid var(--border)",
                                color: "var(--text-primary)",
                                padding: "0.5rem 1rem",
                                borderRadius: "6px",
                                cursor: "pointer",
                            }}
                        >
                            {showRawHtml ? "📄 Raw HTML" : "📝 Plain Text"}
                        </button>
                    </div>
                    <div className="conversation-card">
                        <div className="conversation-header">
                            <span className="conversation-id">{selectedConversation.id}</span>
                            <span className="conversation-time">
                                {new Date(selectedConversation.updatedAt).toLocaleString()}
                            </span>
                        </div>
                        <div className="conversation-preview">
                            {selectedConversation.messages.map((msg, i) => (
                                <div
                                    key={i}
                                    className={`message-preview ${msg.role === "user" ? "user" : "ai"}`}
                                >
                                    <strong>{msg.role === "user" ? "You" : "Copilot"}:</strong>
                                    {showRawHtml && msg.rawHtml ? (
                                        <div
                                            className="raw-html-content"
                                            dangerouslySetInnerHTML={{ __html: msg.rawHtml }}
                                        />
                                    ) : (
                                        <div
                                            style={{ whiteSpace: "pre-wrap" }}
                                            dangerouslySetInnerHTML={{
                                                __html: msg.content
                                                    .replace(/&/g, '&amp;')
                                                    .replace(/</g, '&lt;')
                                                    .replace(/>/g, '&gt;')
                                                    .replace(/\n/g, '<br/>')
                                            }}
                                        />
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            ) : conversations.length === 0 ? (
                <div className="empty-state">
                    <h2>No conversations yet</h2>
                    <p>
                        Install the Chrome extension and start chatting with Microsoft
                        Copilot to capture conversations.
                    </p>
                </div>
            ) : (
                <div className="conversations-grid">
                    {conversations.map((conv) => (
                        <div
                            key={conv.id}
                            className="conversation-card"
                            onClick={() => setSelectedId(conv.id)}
                        >
                            <div className="conversation-header">
                                <span className="conversation-id">{conv.id}</span>
                                <span className="conversation-time">
                                    {new Date(conv.updatedAt).toLocaleString()}
                                </span>
                            </div>
                            <div className="conversation-preview">
                                {conv.messages.slice(0, 2).map((msg, i) => (
                                    <div
                                        key={i}
                                        className={`message-preview ${msg.role === "user" ? "user" : "ai"}`}
                                    >
                                        {msg.content.substring(0, 100)}
                                        {msg.content.length > 100 ? "..." : ""}
                                    </div>
                                ))}
                            </div>
                            {conv.messages.length > 2 && (
                                <div className="message-count">
                                    +{conv.messages.length - 2} more messages
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
