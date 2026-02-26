import type { Metadata, Viewport } from 'next';
import './globals.css';
import '../legacy/styles.css';

export const metadata: Metadata = {
  title: 'Animus Web',
  description: 'Animus Engine bridge UI powered by Vercel AI SDK',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
