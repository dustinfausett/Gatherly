import {initializeNative} from './native/bootstrap';
import {isNative} from './native/runtime';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';
import './churp.css';
initializeNative().catch(()=>{}).finally(()=>createRoot(document.getElementById('root')).render(<App />));
if (!isNative()&&'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).catch(() => {});
