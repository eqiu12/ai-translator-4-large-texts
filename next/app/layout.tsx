export const metadata = {
  title: 'WP HTML Translator',
  description: 'Translate WordPress HTML with retries and caching',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, sans-serif' }}>
        {children}
      </body>
    </html>
  );
}

