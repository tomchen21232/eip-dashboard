import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Patch performance.measure to prevent DataCloneError out of memory from React profiling huge props
const originalMeasure = performance.measure;
performance.measure = function (...args: any[]) {
    try {
        return originalMeasure.apply(this, args);
    } catch (err: any) {
        if (err.name === 'DataCloneError') {
            if (args.length > 1 && typeof args[1] === 'object') {
                const safeOptions = { ...args[1] };
                delete safeOptions.detail;
                try {
                    return originalMeasure.call(this, args[0], safeOptions);
                } catch (e) {
                     return originalMeasure.call(this, args[0]);
                }
            }
            return originalMeasure.call(this, args[0]);
        }
        throw err;
    }
};

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