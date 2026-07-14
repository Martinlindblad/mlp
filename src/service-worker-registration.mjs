const noCleanup = () => {};

export function setupServiceWorkerRegistration({
  document: documentObject,
  navigator: navigatorObject,
  nodeEnv,
  onError = () => {},
  window: windowObject,
}) {
  if (
    nodeEnv !== 'production' ||
    !navigatorObject?.serviceWorker ||
    typeof navigatorObject.serviceWorker.register !== 'function'
  ) {
    return noCleanup;
  }

  const registerServiceWorker = () => {
    try {
      void Promise.resolve(
        navigatorObject.serviceWorker.register('/sw.js', {
          scope: '/',
          updateViaCache: 'none',
        }),
      ).catch(onError);
    } catch (error) {
      onError(error);
    }
  };

  if (documentObject.readyState === 'complete') {
    registerServiceWorker();
    return noCleanup;
  }

  windowObject.addEventListener('load', registerServiceWorker, { once: true });
  return () => windowObject.removeEventListener('load', registerServiceWorker);
}
