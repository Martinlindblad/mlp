import '../styles/global.css';
import type { AppProps } from 'next/app';
import { ThemeProvider } from 'next-themes';
import { QueryClient, QueryClientProvider } from 'react-query';
import Navbar from '../sections/Navigation/Navbar';
import { useEffect } from 'react';
import { useLoading, LoadingProvider } from '../contexts/LoadingContext';
import PageLoader from '../components/AnimatedComponents/PageLoader';

function MyApp({ Component, pageProps, router }: AppProps) {
  const queryClient = new QueryClient();
  const loading = useLoading();

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('/sw.js').then(
          function (registration) {
            console.log(
              'Service Worker registration successful with scope:',
              registration.scope,
            );
          },
          function (err) {
            console.log('Service Worker registration failed:', err);
          },
        );
      });
    }
  }, []);

  return (
    <ThemeProvider enableSystem={true} attribute="class">
      <QueryClientProvider client={queryClient}>
        <LoadingProvider>
          {loading ? (
            <PageLoader />
          ) : (
            <>
              <Component {...pageProps} key={router.asPath} />
              <Navbar />
            </>
          )}
        </LoadingProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default MyApp;
