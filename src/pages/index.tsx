import Head from 'next/head';
import Layout from '../components/Layouts/Layout';
import dynamic from 'next/dynamic';

import MainPageShortcuts from '../sections/MainPage/FrontendDeveloperPursuit';
import Hero from '../components/About/HeroIntroduction';
import AllShowcasesSection from '../sections/Cases/AllShowcasesSection';
import CentralContentPageLinks from '../sections/CentralContentPageLinks';

const Cases = dynamic(() => import('../sections/Cases/CaseCarouselBlock'));

export default function Home() {
  return (
    <Layout className="bg-gray-100 dark:bg-gray-900 justify-center align-center flex-col min-h-screen relative">
      <Head>
        <title>Martin Lindblad</title>
        <meta charSet="UTF-8" />
        <meta name="theme-color" content="#000000" />
        <meta
          name="description"
          content="Martin Lindblad's personal website showcasing his work and projects."
        />
        <link rel="manifest" href="/manifest.json" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <div className="relative">
        <Hero />
      </div>
      <Cases />
      <CentralContentPageLinks />
      <AllShowcasesSection />
      <MainPageShortcuts />
    </Layout>
  );
}
