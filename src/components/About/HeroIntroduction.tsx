import { motion } from 'framer-motion';
import { useTheme } from 'next-themes';
import { useMemo } from 'react';

import AnimatedContainer from '../Layouts/AnimatedContainer';
import AnimatedFadeInContainer from '../Layouts/AnimatedFadeInContainer';

import SocialMediaLinks from '../SocialMediaLinks';
import useIntroductionQuery from 'src/src/hooks/useIntroductiontQuery';

import ContentLoader from '../AnimatedComponents/ContentLoader';

import Logo from '../SVG/Logo';
import Link from 'next/link';

export default function Hero() {
  const { data: aboutData, isLoading } = useIntroductionQuery();
  const { theme } = useTheme();

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

  return isLoading ? (
    <ContentLoader />
  ) : (
    <main className="lg:container grid grid-cols-12 pb-12 lg:pb-0 h-screen">
      <img
        alt="content"
        className="object-cover absolute z-0 object-left h-full opacity-60 right-0 grayscale contrast-200 shadow-lg"
        src="/images/profilepicture.webp"
      />

      <div className="col-span-10 col-start-2 lg:col-span-12">
        <div className="pt-96 sm:pt-6 lg:pb-0 sm:pl-32 lg:flex-row flex-col flex flex-wrap justify-center relative">
          <h1 className="text-2xl sm:text-3xl md:text-4xl lg:text-4xl xl:text-4xl  font-bold tracking-wider dark:text-gray-100">
            <AnimatedContainer
              key={'IntroductionNameContainer'}
              containerVariant={container}
              className="flex-row flex w-full flex-wrap "
            >
              <Logo containerStyle="w-10 mr-4" />
              {CharacterString.map((character, index) => (
                <motion.span
                  className={`${
                    theme === 'dark'
                      ? 'animate-[darkColors_3s_ease-in-out]'
                      : 'animate-[lightColors_3s_ease-in-out]'
                  } ${
                    index > 6 ? 'text-blue-500 font-thin' : 'font-extrabold'
                  } `}
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
                  key={`IntroductionName${index}_${character}`}
                >
                  {character === ' ' ? '\u00A0' : character}
                </motion.span>
              ))}
            </AnimatedContainer>
          </h1>
        </div>
      </div>
      <div className="flex-col col-span-12">
        <div className="rounded-2xl flex flex-row justify-center items-center relative">
          <div className="grid grid-cols-12 items-center justify-center">
            <AnimatedFadeInContainer
              type="FadeInBottom"
              className="relative col-span-10 col-start-2 lg:col-span-6 lg:col-start-2 xl:col-start-2 2xl:col-span-6"
            >
              <div className="flex flex-col py-4 sm:py-6 md:py-10 justify-center items-start">
                <div className="flex flex-row justify-start items-start">
                  <h1 className="text-lg md:text-xl lg:text-2xl xl:text-3xl font-bold pr-6">
                    Front-end Developer
                    <br />
                    Where design Meets Functionality
                  </h1>
                </div>
                <p className="text-sm sm:text-sm md:text-base lg:text-lg font-normal opacity-60 py-4 pr-4 md:pr-12 lg:pr-24">
                  {aboutData?.info}
                </p>
                <Link
                  href="/about"
                  className="flex items-center bg-transparent border border-white text-white px-4 sm:px-6 md:px-10 mt-4 py-2 sm:py-2 md:py-3 transition duration-300 ease-in-out text-xs sm:text-sm md:text-base hover:bg-[#desiredColor] hover:scale-105"
                >
                  About Me
                </Link>
              </div>
              <SocialMediaLinks />
            </AnimatedFadeInContainer>
          </div>
        </div>
      </div>
    </main>
  );
}
