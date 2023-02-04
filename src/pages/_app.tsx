import '../styles/global.css';
import type { AppProps } from 'next/app';
import { ThemeProvider } from 'next-themes';
import { QueryClient, QueryClientProvider } from 'react-query';
import { AnimatePresence } from 'framer-motion';
import Navbar from 'src/sections/Navigation/Navbar';

function MyApp({ Component, pageProps, router }: AppProps) {
  const queryClient = new QueryClient();
  return (
    <ThemeProvider enableSystem={true} attribute="class">
      <QueryClientProvider client={queryClient}>
        <AnimatePresence presenceAffectsLayout mode="wait" initial={false}>
          <Component {...pageProps} key={router.asPath} />
          <Navbar />
        </AnimatePresence>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default MyApp;
