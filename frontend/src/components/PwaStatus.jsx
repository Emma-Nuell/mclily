import { useSyncExternalStore } from 'react';
import { useLocation } from 'react-router-dom';
import {
  getPwaSnapshot,
  subscribePwa,
  applyPwaUpdate,
  protectedPage,
  retryBagSave,
} from '../pwa/client';
export default function PwaStatus() {
  const state = useSyncExternalStore(subscribePwa, getPwaSnapshot);
  const { pathname } = useLocation();
  const offline = !state.online || !state.apiReachable || state.catalogSavedAt;
  if (!offline && !state.updateReady && !state.storageFailed) return null;
  return (
    <aside
      className="pwa-notice"
      aria-label="McLily connection and updates"
      aria-live="polite"
    >
      {offline && (
        <p>
          {!state.online
            ? 'You’re offline.'
            : !state.apiReachable
              ? 'We can’t reach the store right now.'
              : 'Showing saved products.'}{' '}
          You can view saved finds and your bag. Prices, stock, account access
          and payment need an online check.
        </p>
      )}
      {state.storageFailed && (
        <div className="pwa-update">
          <p>
            Your bag could not be saved on this device. Keep this page open and
            try again before refreshing.
          </p>
          <button type="button" onClick={retryBagSave}>
            Retry saving bag
          </button>
        </div>
      )}
      {state.updateReady && (
        <div className="pwa-update">
          <p>
            {state.updateMessage ||
              (protectedPage(pathname)
                ? 'An update is ready. Finish this step, then return to the shop to refresh.'
                : 'A McLily update is ready. Your saved bag stays with you.')}
          </p>
          <button
            type="button"
            disabled={
              state.updateBusy ||
              !state.online ||
              protectedPage(pathname) ||
              state.storageFailed
            }
            onClick={applyPwaUpdate}
          >
            {state.updateBusy ? 'Updating…' : 'Refresh app'}
          </button>
        </div>
      )}
    </aside>
  );
}
