import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

export interface Message {
    role: "user" | "assistant";
    content: string;
    rawHtml?: string;
    timestamp: string;
}

export interface Conversation {
    id: string;
    url?: string;
    messages: Message[];
    rawHtml?: string;
    createdAt: string;
    updatedAt: string;
}

export interface Database {
    conversations: Conversation[];
}

const DATA_DIR = join(process.cwd(), "data");
const DATA_FILE = join(DATA_DIR, "conversations.json");

/**
 * Simple in-process lock to serialize file read-modify-write operations.
 * Prevents concurrent API requests from clobbering each other's writes.
 */
let lockPromise: Promise<void> = Promise.resolve();

export async function withDatabase<T>(
    fn: (db: Database) => { result: T; save: boolean }
): Promise<T> {
    let release: () => void;
    const nextLock = new Promise<void>((resolve) => {
        release = resolve;
    });
    const previousLock = lockPromise;
    lockPromise = nextLock;

    await previousLock;

    try {
        const db = loadDatabase();
        const { result, save } = fn(db);
        if (save) {
            saveDatabase(db);
        }
        return result;
    } finally {
        release!();
    }
}

function loadDatabase(): Database {
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

function saveDatabase(db: Database): void {
    if (!existsSync(DATA_DIR)) {
        mkdirSync(DATA_DIR, { recursive: true });
    }
    writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

export function messageHash(role: string, content: string): string {
    const key = `${role}:${content.substring(0, 100)}`;
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
        hash = ((hash << 5) - hash) + key.charCodeAt(i);
        hash = hash & hash;
    }
    return hash.toString(36);
}

/**
 * Convert raw HTML to text with preserved line breaks.
 */
export function htmlToText(html: string): string {
    if (!html) return "";

    return html
        .replace(/<\/p>/gi, "\n\n")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/div>/gi, "\n")
        .replace(/<\/h[1-6]>/gi, "\n\n")
        .replace(/<\/li>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\n{4,}/g, "\n\n\n")
        .trim();
}
