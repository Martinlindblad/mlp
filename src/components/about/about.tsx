import { useEffect, useState } from 'react';

import useIntroductionQuery from 'src/hooks/useAboutQuery';
import Skills from 'src/sections/skills';
import AboutCard from './aboutCard';
export default function About() {
  const { data: aboutData } = useIntroductionQuery();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;
  return (
    <main className="flex pt-32 lg:p-60 lg:justify-center w-full lg:container min-h-screen">
      <div className="min-w-full">
        <div className="flex justify-center min-w-full flex-col items-center">
          <h1
            style={{ fontWeight: '1000' }}
            className="p-1 text-start md:text-7xl text-3xl font-weight:7rem uppercase
             tracking-widest dark:shadow-emerald-900 dark:text-slate-200 "
          >
            {aboutData?.name + ' ' + aboutData?.surname}
          </h1>
        </div>

        <h2 className="text-2xl py-2 font-extrabold px-2 md:text-5xl lg:text-6xl text-center lg:mt-8">
          <span className="text-transparent bg-clip-text bg-gradient-to-r to-sky-600 from-yellow-400 ">
            {aboutData?.title}
          </span>
        </h2>
        <p className="text-lg font-normal lg:text-xl px-8 text-center lg:w-2/3 mx-auto md:py-8 py-2">
          {aboutData?.info}
        </p>
        <div className="flex flex-row justify-center pt-8 md:pt-2">
          <AboutCard />
        </div>
        <div className="pt-16">
          <Skills />
        </div>
      </div>
    </main>
  );
}
