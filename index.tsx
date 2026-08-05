import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Prevent third-party polyfills from throwing when setting window.fetch in restricted sandboxes
try {
  if (typeof window !== 'undefined') {
    const desc = Object.getOwnPropertyDescriptor(window, 'fetch') || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(window), 'fetch');
    if (desc && !desc.writable && !desc.set) {
      const originalFetch = window.fetch.bind(window);
      Object.defineProperty(window, 'fetch', {
        get() { return originalFetch; },
        set() { /* ignore attempt to overwrite read-only fetch in iframe */ },
        configurable: true,
      });
    }
  }
} catch (e) {}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);