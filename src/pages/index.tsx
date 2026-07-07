import Layout from '../components/Layouts/Layout';
import dynamic from 'next/dynamic';

import MainPageShortcuts from '../sections/MainPage/FrontendDeveloperPursuit';
import Hero from '../components/About/HeroIntroduction';
import AllShowcasesSection from '../sections/Cases/AllShowcasesSection';
import CentralContentPageLinks from '../sections/CentralContentPageLinks';
import SEO from '../components/SEO';

const Cases = dynamic(() => import('../sections/Cases/CaseCarouselBlock'));

export default function Home() {
  return (
    <Layout className="bg-gray-100 dark:bg-gray-900 justify-center align-center flex-col min-h-screen relative">
      <SEO
        description="Martin Lindblad is a Stockholm-based front-end developer focused on React, React Native, Next.js, TypeScript, and accessible product experiences."
        path="/"
      />
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
