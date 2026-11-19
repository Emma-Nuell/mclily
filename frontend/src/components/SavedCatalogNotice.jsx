import { useSyncExternalStore } from 'react';
import { subscribePwa, getPwaSnapshot } from '../pwa/client';
export default function SavedCatalogNotice() {
  const state = useSyncExternalStore(subscribePwa, getPwaSnapshot);
  return !state.online || !state.apiReachable || state.catalogSavedAt ? (
    <p role="status" className="text-xs leading-relaxed text-text-secondary">
      Saved prices and availability may have changed. Your bag can be edited
      here; connect before checkout.
    </p>
  ) : null;
}
