import './globals.css';

export const metadata = {
  title: 'WP HTML Translator',
  description: 'Translate WordPress HTML with retries and caching',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}

