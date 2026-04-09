import type { Metadata, Viewport } from 'next';
import { Cormorant_Garamond, Manrope } from 'next/font/google';
import './globals.css';

const headingFont = Cormorant_Garamond({
  subsets: ['latin'],
  variable: '--font-heading',
  weight: ['500', '600', '700'],
});

const bodyFont = Manrope({
  subsets: ['latin'],
  variable: '--font-body',
  weight: ['400', '500', '600', '700'],
});

export const metadata: Metadata = {
  title: 'Nova Class',
  description: 'Nova Class portal for secure, token-based classroom tracking',
  icons: {
    icon: '/images/nova-class-logo.png',
    shortcut: '/images/nova-class-logo.png',
    apple: '/images/nova-class-logo.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${headingFont.variable} ${bodyFont.variable}`}>
        <div id="app-root">{children}</div>
      </body>
    </html>
  );
}
