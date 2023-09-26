import '../styles/global.css';
import type { AppProps } from 'next/app';
import { ThemeProvider } from 'next-themes';
import { QueryClient, QueryClientProvider } from 'react-query';
import Navbar from '../sections/Navigation/Navbar';
import { useEffect } from 'react';

function MyApp({ Component, pageProps, router }: AppProps) {
  const queryClient = new QueryClient();

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
        <Component {...pageProps} key={router.asPath} />
        <Navbar />
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default MyApp;
