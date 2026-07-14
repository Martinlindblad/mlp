import '../styles/global.css';
import type { AppProps } from 'next/app';
import { ThemeProvider } from 'next-themes';
import { QueryClient, QueryClientProvider } from 'react-query';
import Navbar from '../sections/Navigation/Navbar';
import { useEffect, useState } from 'react';
import Footer from '../sections/Footer/Footer';
// Keep one explicit ESM path for both the browser bundle and Node contract tests.
// eslint-disable-next-line import/extensions
import { setupServiceWorkerRegistration } from '../service-worker-registration.mjs';

function MyApp({ Component, pageProps, router }: AppProps) {
  const [queryClient] = useState(() => new QueryClient());

  useEffect(
    () =>
      setupServiceWorkerRegistration({
        document,
        navigator,
        nodeEnv: process.env.NODE_ENV,
        window,
      }),
    [],
  );

  return (
    <ThemeProvider enableSystem={true} attribute="class">
      <QueryClientProvider client={queryClient}>
        <>
          <Component {...pageProps} key={router.asPath} />
          <Navbar />
          <Footer />
        </>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default MyApp;
