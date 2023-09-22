import '../styles/global.css';
import type { AppProps } from 'next/app';
import { ThemeProvider } from 'next-themes';
import { QueryClient, QueryClientProvider } from 'react-query';
import Navbar from '../sections/Navigation/Navbar';

function MyApp({ Component, pageProps, router }: AppProps) {
  const queryClient = new QueryClient();
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
