export interface ServiceWorkerRegistrationEnvironment {
  document: Document;
  navigator: Navigator;
  nodeEnv: string | undefined;
  onError?: (error: unknown) => void;
  window: Window;
}

export function setupServiceWorkerRegistration(
  environment: ServiceWorkerRegistrationEnvironment,
): () => void;
