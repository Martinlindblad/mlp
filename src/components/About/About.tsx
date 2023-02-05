import { motion } from 'framer-motion';
import { useTheme } from 'next-themes';
import { useEffect, useMemo, useState } from 'react';

import useIntroductionQuery from 'src/hooks/useAboutQuery';
import Skills from '../../sections/Skills';
import PageLoader from '../AnimatedComponents/PageLoader';
import AnimatedContainer from '../Layouts/AnimatedContainer';
import AnimatedFadeInContainer from '../Layouts/AnimatedFadeInContainer';
import Stepper from '../Stepper';

export default function About() {
  const { data: aboutData, isLoading } = useIntroductionQuery();
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

  return isLoading || !mounted ? (
    <PageLoader />
  ) : (
    <main className="flex items-center lg:justify-center pt-32 lg:pt-24 w-full lg:container min-h-screen pb-10 lg:pb-0">
      <div className="w-full lg:w-3/4">
        <div className="flex justify-center min-w-full flex-col items-center ">
          <h1
            style={{ textShadow: '0 2px 10px rgba(0, 0, 0, 0.5)' }}
            className=" text-start xl:text-8xl lg:text-6xl font-black text-3xl md:text-4xl uppercase pb-3 lg:pb-0
             tracking-wider  dark:text-yellow-100 text-left "
          >
            <AnimatedContainer
              containerVariant={container}
              className="flex-row flex w-full"
            >
              {CharacterString.map((character, index) => (
                <motion.span
                  className={` ${
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
          type="FadeInLeft"
          className="flex-col flex w-full"
        >
          <h2
            style={{ textShadow: '0 2px 5px rgba(0, 0, 0, 0.2)' }}
            className="text-2xl font-extrabold px-2 lg:text-6xl  text-center md:text-3xl lg:mt-4"
          >
            <span className="text-transparent bg-clip-text bg-gradient-to-r to-sky-600 from-yellow-400 ">
              {aboutData?.title}
            </span>
          </h2>
          <p
            style={{ textShadow: '0 2px 10px rgba(255, 255, 255, 255.5)' }}
            className="text-sm font-normal lg:text-2xl opacity-60 px-8 text-center md:text-2xl lg:w-2/3 mx-auto lg:py-6 py-2"
          >
            {aboutData?.info}
          </p>
        </AnimatedFadeInContainer>
        <Stepper step={1} stepperTitle={'My Journey'} />
        <Skills />
      </div>
    </main>
  );
}
