import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
    title: "Copiloter - Captured Conversations",
    description: "View captured Microsoft Copilot conversations",
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="en">
            <body className="antialiased">{children}</body>
        </html>
    );
}
