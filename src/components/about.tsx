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
          <h1 className="p-1 text-start md:text-7xl text-2xl font-weight:7rem uppercase fw tracking-widest ">
            {aboutData?.name + ' ' + aboutData?.surname}
          </h1>
        </div>

        <h2 className="text-3xl font-extrabold px-8 md:text-5xl lg:text-6xl text-center lg:mt-8">
          <span className="text-transparent bg-clip-text bg-gradient-to-r to-sky-600 from-gold-400 ">
            {aboutData?.title}
          </span>
        </h2>
        <p className="text-lg font-normal lg:text-xl px-8  text-center lg:w-2/3 mx-auto py-8">
          {aboutData?.info}
        </p>
        <div className="flex flex-row justify-center ">
          <div className="relative flex items-center flex-col justify-center ">
            <div className="object-fill h-12 w-12 rounded-full bg-cover bg-center absolute mix-blend-multiple" />
            <div className=" bg-[url('../../assets/profilepicture.png')] rounded-full shadow-indigo-200 dark:shadow-sky-300 opacity-90 shadow-md bg-cover h-12 w-12 object-fill mix-blend-lighten" />
            <div className=" bg-[url('../../assets/profilepicture.png')] rounded-full  absolute mix-blend-multiply dark:bg-gray-900 opacity-80 bg-gray-400  scale-105 bg-cover h-12 w-12 object-fill" />
          </div>
          <AboutCard />
        </div>
        <div className="pt-20">
          <Skills />
        </div>
      </div>
    </main>
  );
}
