import '../styles/global.css';
import type { AppProps } from 'next/app';
import { ThemeProvider } from 'next-themes';
import { QueryClient, QueryClientProvider } from 'react-query';
import Navbar from '../sections/Navigation/Navbar';
import { useEffect, useState } from 'react';
import Footer from '../sections/Footer/Footer';
import { SpeedInsights } from '@vercel/speed-insights/next';

function MyApp({ Component, pageProps, router }: AppProps) {
  const [queryClient] = useState(() => new QueryClient());

  useEffect(() => {
    if (!('serviceWorker' in navigator)) {
      return undefined;
    }

    const registerServiceWorker = () => {
      void navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.error('Service Worker registration failed:', err);
      });
    };

    window.addEventListener('load', registerServiceWorker);

    return () => window.removeEventListener('load', registerServiceWorker);
  }, []);

  return (
    <ThemeProvider enableSystem={true} attribute="class">
      <QueryClientProvider client={queryClient}>
        <>
          <Component {...pageProps} key={router.asPath} />
          <Navbar />
          <Footer />
          <SpeedInsights />
        </>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default MyApp;
