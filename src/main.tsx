import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

console.log('main.tsx - Module loaded');

// Global event interceptor to prevent PowerPoint from swallowing keyboard events in input fields
const preventPowerPointKeyboardSwallowing = () => {
  const handleKeyboardEvent = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable)
    ) {
      // Allow key events to reach the input field but stop them from bubbling up to the document level
      // where PowerPoint's event listeners are intercepting keys.
      e.stopPropagation();
    }
  };

  document.addEventListener('keydown', handleKeyboardEvent, true);
  document.addEventListener('keyup', handleKeyboardEvent, true);
  document.addEventListener('keypress', handleKeyboardEvent, true);
};

// Run the focus protection immediately
preventPowerPointKeyboardSwallowing();

const renderApp = () => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
};

// Ensure Office.js is fully initialized before rendering
const Office = (window as any).Office;
if (Office) {
  Office.onReady((info: any) => {
    console.log('main.tsx - Office.js ready, Host:', info.host, 'Platform:', info.platform);
    renderApp();
  });
} else {
  console.log('main.tsx - Office.js not found, rendering App standalone');
  renderApp();
}
