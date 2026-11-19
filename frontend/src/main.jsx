import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import { startPwa } from './pwa/client';

startPwa();

createRoot(document.getElementById('root')).render(<App />);
