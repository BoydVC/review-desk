import type { Metadata } from "next";
import { Fraunces, Public_Sans } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const publicSans = Public_Sans({
  subsets: ["latin"],
  variable: "--font-public",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
});

export const metadata: Metadata = {
  title: "Review Desk",
  description:
    "A code-review pipeline for agent-written pull requests: parallel hunters, a quorum, risk tiers, and a three-round cap.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${publicSans.variable} ${fraunces.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <header className="border-b border-border bg-card/80 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4">
            <Link href="/" className="font-heading text-xl text-foreground">
              Review Desk
            </Link>
            <nav className="flex items-center gap-4 text-sm">
              <Link href="/" className="hover:underline">
                Desk
              </Link>
              <Link href="/score" className="hover:underline">
                Score
              </Link>
              <Link href="/experts" className="hover:underline">
                Lenses
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
