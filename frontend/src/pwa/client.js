let snapshot = {
  online: typeof navigator === 'undefined' || navigator.onLine,
  apiReachable: true,
  updateReady: false,
  updateBusy: false,
  updateMessage: '',
  checkMessage: '',
  installAvailable: false,
  installed: false,
  storageFailed: false,
  catalogSavedAt: null,
  supported: false,
};
const listeners = new Set();
export const subscribePwa = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const getPwaSnapshot = () => snapshot;
function publish(values) {
  snapshot = { ...snapshot, ...values };
  for (const listener of listeners) listener();
}
let registration,
  deferredInstall,
  cartSaved = false,
  reloadPending = false,
  initialized = false,
  lastCheck = 0;
export function cartPersistencePending() {
  cartSaved = false;
}
export function cartPersistenceFinished(saved) {
  cartSaved = saved;
  publish({ storageFailed: !saved });
}
const savedCatalog = new Map();
export function markSavedCatalog(key, savedAt) {
  savedCatalog.set(key, savedAt);
  publish({ catalogSavedAt: Math.min(...savedCatalog.values()) });
}
export function markFreshCatalog(key) {
  savedCatalog.delete(key);
  if (snapshot.catalogSavedAt)
    publish({
      catalogSavedAt: savedCatalog.size
        ? Math.min(...savedCatalog.values())
        : null,
    });
}
export function retryBagSave() {
  window.dispatchEvent(new Event('mcl:retry-bag-save'));
}
export function markApiReachable(value) {
  if (snapshot.apiReachable !== value) publish({ apiReachable: value });
}
export const protectedPage = (path) =>
  /^\/(checkout|account|login|signup|forgot-password|reset-password)(\/|$)/.test(
    path
  );
function safeToRefresh() {
  const focus = document.activeElement;
  return (
    cartSaved &&
    navigator.onLine &&
    !protectedPage(location.pathname) &&
    !focus?.matches('input, select, textarea, [contenteditable="true"]')
  );
}
export async function checkPwaUpdate(force = false) {
  if (
    !registration ||
    !navigator.onLine ||
    (!force && Date.now() - lastCheck < 10000)
  )
    return;
  lastCheck = Date.now();
  publish({ checkMessage: 'Checking for updates…' });
  try {
    await registration.update();
    if (registration.waiting)
      publish({ updateReady: true, checkMessage: 'An update is ready.' });
    else
      publish({
        checkMessage: registration.installing
          ? 'Preparing the latest app…'
          : 'McLily is up to date.',
      });
  } catch {
    publish({
      checkMessage: 'Couldn’t check for updates. Try again when connected.',
    });
  }
}
export async function applyPwaUpdate() {
  if (!safeToRefresh()) {
    publish({
      updateMessage: snapshot.storageFailed
        ? 'Your bag could not be saved. Keep this page open and try again.'
        : 'Finish checkout or account changes, then return to the shop to refresh.',
    });
    return false;
  }
  if (reloadPending) {
    location.reload();
    return true;
  }
  const waiting = registration?.waiting;
  if (!waiting) {
    await checkPwaUpdate(true);
    return false;
  }
  publish({ updateBusy: true, updateMessage: '' });
  const accepted = await new Promise((resolve) => {
    const channel = new MessageChannel(),
      timer = setTimeout(() => resolve(false), 5000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(event.data?.accepted === true);
    };
    waiting.postMessage({ type: 'MCL_ACTIVATE_UPDATE' }, [channel.port2]);
  });
  publish({
    updateBusy: false,
    updateMessage: accepted
      ? 'Refreshing McLily…'
      : 'Another McLily tab may be busy. Finish checkout or account changes in other tabs, then try again.',
  });
  return accepted;
}
export async function installPwa() {
  if (!deferredInstall) return false;
  const prompt = deferredInstall;
  deferredInstall = null;
  publish({ installAvailable: false });
  await prompt.prompt();
  const result = await prompt.userChoice;
  if (result.outcome !== 'accepted') deferredInstall = null;
  return result.outcome === 'accepted';
}
export function startPwa() {
  if (initialized) return;
  initialized = true;
  const installed =
    window.matchMedia('(display-mode: standalone)').matches ||
    navigator.standalone === true;
  publish({ installed });
  window.addEventListener('online', () => {
    publish({ online: true });
    void checkPwaUpdate(true);
  });
  window.addEventListener('offline', () => publish({ online: false }));
  if (
    !import.meta.env.PROD ||
    !window.isSecureContext ||
    !('serviceWorker' in navigator)
  )
    return;
  publish({ supported: true });
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstall = event;
    publish({ installAvailable: true });
  });
  window.addEventListener('appinstalled', () => {
    deferredInstall = null;
    publish({ installed: true, installAvailable: false });
  });
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'MCL_CHECK_UPDATE')
      event.ports[0]?.postMessage({
        safe: safeToRefresh(),
        build: document.querySelector('meta[name="mclily-build"]')?.content,
      });
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!registration || !document.querySelector('meta[name="mclily-build"]'))
      return;
    // Initial installation only gains control. Only a replacement is an update/reload.
    if (!snapshot.updateReady) return;
    if (safeToRefresh()) location.reload();
    else {
      reloadPending = true;
      publish({
        updateReady: true,
        updateMessage:
          'The update is ready. Finish your current task, then refresh from the shop.',
      });
    }
  });
  const attach = (value) => {
    if (registration === value) return;
    registration = value;
    if (value.waiting) publish({ updateReady: true });
    const watchInstalling = () => {
      const worker = value.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed')
          publish({
            updateReady: Boolean(navigator.serviceWorker.controller),
            checkMessage: navigator.serviceWorker.controller
              ? 'An update is ready.'
              : 'McLily is ready.',
          });
        if (worker.state === 'redundant')
          publish({
            checkMessage:
              'The update could not be downloaded. Your current app is still available.',
          });
      });
    };
    watchInstalling();
    value.addEventListener('updatefound', watchInstalling);
    void checkPwaUpdate(true);
  };
  navigator.serviceWorker
    .getRegistration('/')
    .then((existing) => {
      if (existing) attach(existing);
      return navigator.serviceWorker.register('/sw.js', {
        scope: '/',
        updateViaCache: 'none',
      });
    })
    .then(attach)
    .catch(() => {
      /* An offline reopen keeps its existing registration and retries on reconnection. */
    });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkPwaUpdate();
  });
  window.addEventListener('focus', () => void checkPwaUpdate());
  window.addEventListener('pageshow', () => void checkPwaUpdate());
  setInterval(
    () => {
      if (document.visibilityState === 'visible') void checkPwaUpdate();
    },
    5 * 60 * 1000
  );
}
