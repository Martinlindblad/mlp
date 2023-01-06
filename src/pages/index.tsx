import Head from 'next/head';
import About from 'src/components/about';
import DevCard from 'src/components/devcard';
import Navbar from 'src/components/navbar';

export default function Home() {
  return (
    <div className="bg-gray-100 dark:bg-gray-900 min-h-screen">
      <Head>
        <title>Martin Lindblad</title>
        <meta name="description" content="Generated by create next app" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <Navbar />
      <About />
      {/* <Collection /> */}
      <DevCard />
    </div>
  );
}
