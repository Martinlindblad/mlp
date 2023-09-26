import Head from 'next/head';
import Layout from '../components/Layouts/Layout';
import dynamic from 'next/dynamic';

// Directly import components that will be immediately visible.
import Hero from '../sections/Hero/Hero';
import MainPageShortcuts from '../sections/MainPage/MainPageShortcuts';

// Dynamically import components that won't be immediately visible.
const Cases = dynamic(() => import('../sections/Cases/Cases'));

export default function Home() {
  return (
    <Layout className="bg-slate-100 justify-center align-center flex-col dark:bg-gray-900 min-h-screen relative">
      <Head>
        <title>Martin Lindblad</title>
        <meta charSet="UTF-8" />
        <meta name="theme-color" content="#000000" />
        <meta
          name="description"
          content="Martin Lindblad's personal website showcasing his work and projects."
        />
        <link rel="apple-touch-icon" href="/logo192.png" />
        <link rel="manifest" href="/manifest.json" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <Hero />
      <MainPageShortcuts />
      <Cases />
    </Layout>
  );
}
