import React from 'react';
import '../../index.css';

export const metadata = {
  title: 'Ioncore CRM',
  description: 'Intelligent CRM for Ioncore SAS powered by Gemini',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body>
        <div id="root">{children}</div>
      </body>
    </html>
  );
}
