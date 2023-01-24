import { motion } from 'framer-motion';
import { useTheme } from 'next-themes';
import { useEffect, useMemo, useState } from 'react';

import useIntroductionQuery from 'src/hooks/useAboutQuery';
import Skills from '../../sections/skills';
import PageLoader from '../animatedComponents/PageLoader';
import AnimatedContainer from '../Layouts/animatedContainer';
import AnimatedFadeInContainer from '../Layouts/AnimatedFadeInContainer';
import AboutCard from './aboutCard';

export default function About() {
  const { data: aboutData } = useIntroductionQuery();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const CharacterString = useMemo(() => {
    if (aboutData) {
      const nameString = aboutData?.name + ' ' + aboutData?.surname;
      const stringArr = Array.from(nameString);
      return stringArr;
    }
    return [];
  }, [aboutData]);

  const container = useMemo(
    () => ({
      hidden: {
        opacity: 0,
        scale: 0,
      },
      visible: {
        opacity: 1,
        scale: 1,
        visible: {
          opacity: 1,
          transition: {
            delay: 0.4,
            duration: 0.5,
          },
        },
      },
    }),
    [],
  );

  const { theme } = useTheme();

  if (!mounted) return null;
  return (
    <main className="flex pt-32 lg:p-60 lg:justify-center w-full lg:container min-h-screen">
      {aboutData ? (
        <div className="min-w-full">
          <div className="flex justify-center min-w-full flex-col items-center">
            <h1
              style={{ fontWeight: '1000' }}
              className=" text-start md:text-7xl text-3xl font-weight:7rem uppercase pb-3 md:pb-0
             tracking-widest dark:shadow-emerald-900 dark:text-slate-200 text-left "
            >
              <AnimatedContainer
                containerVariant={container}
                className="flex-row flex w-full"
              >
                {CharacterString.map((character, index) => (
                  <motion.span
                    className={`${
                      theme === 'dark'
                        ? 'animate-[darkColors_3s_ease-in-out]'
                        : 'animate-[lightColors_3s_ease-in-out]'
                    }`}
                    variants={{
                      hidden: {
                        opacity: 0,
                      },
                      visible: {
                        opacity: 1,
                        transition: {
                          delay: index * 0.1,
                          duration: 0.7,
                        },
                      },
                    }}
                    key={index}
                  >
                    {character === ' ' ? '\u00A0' : character}
                  </motion.span>
                ))}
              </AnimatedContainer>
            </h1>
          </div>
          <AnimatedFadeInContainer
            type="FadeInTop"
            className="flex-col flex w-full"
          >
            <div className="flex flex-row justify-center pt-2 md:pt-5">
              <AboutCard />
            </div>
            <h2 className="text-lg font-extrabold px-2 md:text-5xl lg:text-6xl text-center lg:mt-8">
              <span className="text-transparent bg-clip-text bg-gradient-to-r to-sky-600 from-yellow-400 ">
                {aboutData?.title}
              </span>
            </h2>
            <p className="text-sm font-normal lg:text-xl opacity-60 px-8 text-center lg:w-2/3 mx-auto md:py-6 py-2">
              {aboutData?.info}
            </p>
          </AnimatedFadeInContainer>
          <div className="pt-16">
            <Skills />
          </div>
        </div>
      ) : (
        <PageLoader />
      )}
    </main>
  );
}
