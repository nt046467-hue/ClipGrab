
import type {Metadata} from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ClipGrab — Multi-Platform Video Downloader',
  description: 'Paste. Pick format. Download. That\'s it. Download videos from YouTube, TikTok, Instagram, and more.',
  manifest: '/site.webmanifest',
  icons: {
    icon: '/favicon.svg',
    apple: '/icon-192.png',
    shortcut: '/favicon.svg',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet" />
      </head>
      <body className="font-body antialiased selection:bg-primary selection:text-white">
        {children}
      </body>
    </html>
  );
}
