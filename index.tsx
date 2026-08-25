import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initializeBehaviorTracking } from './services/behaviorLogger';
import { installLongTaskObserver } from './services/perf';

if (typeof window !== 'undefined') {
  const mutedConsole = console as Console & Record<string, (...args: unknown[]) => void>;
  ['log', 'info', 'warn', 'error', 'debug', 'trace'].forEach((method) => {
    mutedConsole[method] = () => undefined;
  });
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

initializeBehaviorTracking();
installLongTaskObserver();

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
