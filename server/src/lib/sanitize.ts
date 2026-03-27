/**
 * Allowlist-based HTML sanitizer for rendering captured conversation HTML.
 * Strips all tags/attributes not on the allowlist, preventing XSS.
 */

const ALLOWED_TAGS = new Set([
    "p", "br", "div", "span", "strong", "b", "em", "i", "u", "s",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "li",
    "pre", "code", "blockquote",
    "table", "thead", "tbody", "tr", "th", "td",
    "a", "img", "hr", "sup", "sub",
]);

const ALLOWED_ATTRS: Record<string, Set<string>> = {
    a: new Set(["href", "title"]),
    img: new Set(["src", "alt", "width", "height"]),
    td: new Set(["colspan", "rowspan"]),
    th: new Set(["colspan", "rowspan"]),
    code: new Set(["class"]),
    pre: new Set(["class"]),
    span: new Set(["class"]),
    div: new Set(["class"]),
};

/**
 * Sanitize HTML string by parsing through the DOM and only keeping
 * allowed tags and attributes. Runs client-side only.
 */
export function sanitizeHtml(dirty: string): string {
    if (typeof window === "undefined") return "";

    const parser = new DOMParser();
    const doc = parser.parseFromString(dirty, "text/html");
    return sanitizeNode(doc.body);
}

function sanitizeNode(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) {
        return escapeText(node.textContent || "");
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
        return "";
    }

    const el = node as Element;
    const tag = el.tagName.toLowerCase();

    // Recursively sanitize children
    const childrenHtml = Array.from(el.childNodes)
        .map((child) => sanitizeNode(child))
        .join("");

    if (!ALLOWED_TAGS.has(tag)) {
        // Strip the tag but keep its children
        return childrenHtml;
    }

    // Build allowed attributes
    const allowedAttrsForTag = ALLOWED_ATTRS[tag];
    let attrs = "";
    if (allowedAttrsForTag) {
        for (const attr of Array.from(el.attributes)) {
            if (!allowedAttrsForTag.has(attr.name)) continue;
            const value = attr.value;
            // Block javascript: URLs
            if (
                (attr.name === "href" || attr.name === "src") &&
                /^\s*javascript:/i.test(value)
            ) {
                continue;
            }
            attrs += ` ${attr.name}="${escapeAttr(value)}"`;
        }
    }

    // Force external links to open safely
    if (tag === "a") {
        attrs += ' target="_blank" rel="noopener noreferrer"';
    }

    // Self-closing tags
    if (tag === "br" || tag === "hr" || tag === "img") {
        return `<${tag}${attrs} />`;
    }

    return `<${tag}${attrs}>${childrenHtml}</${tag}>`;
}

function escapeText(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function escapeAttr(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}
