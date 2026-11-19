import { useState, useSyncExternalStore } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import {
  subscribePwa,
  getPwaSnapshot,
  installPwa,
  checkPwaUpdate,
} from '../pwa/client';
export default function InstallApp() {
  const state = useSyncExternalStore(subscribePwa, getPwaSnapshot);
  const [instructions, setInstructions] = useState(false);
  if (!state.supported) return null;
  return (
    <section className="install-app" aria-label="Install McLily">
      <h2>{state.installed ? 'McLily on your device' : 'Keep McLily close'}</h2>
      <p>
        {state.installed
          ? 'The app checks for updates when you open it or return to it.'
          : 'Add McLily to your home screen for quick access. Your saved bag stays on this device.'}
      </p>
      <div className="install-actions">
        {!state.installed && (
          <button
            type="button"
            onClick={() =>
              state.installAvailable
                ? installPwa()
                : setInstructions(!instructions)
            }
          >
            <Download size={16} />
            {state.installAvailable ? 'Install McLily' : 'How to install'}
          </button>
        )}
        <button
          type="button"
          disabled={!state.online}
          onClick={() => checkPwaUpdate(true)}
        >
          <RefreshCw size={15} />
          Check for updates
        </button>
      </div>
      {instructions && (
        <p>
          On iPhone or iPad, open McLily in Safari, tap Share, then Add to Home
          Screen. On Android or desktop, look in your browser menu for Install
          app or Add to Home screen. The option depends on your browser.
        </p>
      )}
      {state.checkMessage && <p role="status">{state.checkMessage}</p>}
    </section>
  );
}
