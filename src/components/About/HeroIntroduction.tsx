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

  return isLoading ? (
    <ContentLoader />
  ) : (
    <main className="lg:container grid grid-cols-12  pb-12 lg:pb-0 h-screen ">
      <img
        alt="content"
        className="object-cover absolute z-10 object-left h-full opacity-60 right-0 grayscale contrast-200 shadow-lg"
        src="/images/profilepicture.webp"
      />

      <div className="col-span-10 col-start-2 lg:col-span-12">
        <div className="pt-24 lg:pt-6 lg:pb-0 lg:flex-row flex-col flex flex-wrap justify-center relative ">
          <h1
            className="xl:text-3xl lg:text-lg pb-4 lg:pb-0 text-lg md:text-lg
             tracking-wider dark:text-gray-100 "
          >
            <AnimatedContainer
              key={'IntroductionNameContainer'}
              containerVariant={container}
              className="flex-row flex w-full flex-wrap "
            >
              <Logo containerStyle="w-10 h-10 mr-4" />
              {CharacterString.map((character, index) => (
                <motion.span
                  className={` ${
                    theme === 'dark'
                      ? 'animate-[darkColors_3s_ease-in-out]'
                      : 'animate-[lightColors_3s_ease-in-out]'
                  } ${
                    index > 6
                      ? 'text-3xl text-blue-500 font-thin'
                      : 'text-3xl font-extrabold'
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
      <div className="flex-col col-span-12  ">
        <div className=" rounded-2xl flex flex-row justify-center items-center relative">
          <div className="grid grid-cols-12 items-center justify-center">
            <AnimatedFadeInContainer
              type="FadeInBottom"
              className="relative col-span-10 col-start-2 lg:col-span-5 lg:col-start-2 "
            >
              <div className="flex flex-col py-10 justify-center items-start">
                <div className=" flex flex-row justify-start items-start ">
                  {/* <Avatar />
                  <h2 className="text-lg pt-1 font-extrabold lg:text-sm md:text-xl pl-4">
                  <p>Hi!, {"I'm a"}</p>
                  <span className="opacity-30">{aboutData?.title}</span>
                  </h2> */}
                  <h2 className="text-lg pt-1 font-extrabold lg:text-sm md:text-xl pr-6">
                    <span className="lg:text-4xl md:text-3xl text-2xl font-bold ">
                      Front-end Developer
                    </span>
                    <br />
                    <span className="lg:text-4xl md:text-3xl text-2xl font-bold ">
                      Design Meets Functionality
                    </span>
                  </h2>
                </div>
                <p className="text-sm  font-normal lg:text-xl opacity-60 md:text-xl md:py-6 py-2 pr-4 md:pr-24 lg:pr-12">
                  {aboutData?.info}
                </p>
                <Link
                  href="/about"
                  className="flex items-center bg-transparent border border-white text-white hover:bg-opacity-10 px-10 py-3 transition duration-300 ease-in-out"
                >
                  <span className="text-sm uppercase"> About Me</span>
                </Link>
              </div>
              <SocialMediaLinks />
            </AnimatedFadeInContainer>
            {/* <AnimatedFadeInContainer
              type="FadeInBottom"
              className="col-span-10 col-start-4 lg:col-start-9 lg:col-span-3"
            >
              <div className="w-full inline-flex items-center justify-center relative overflow-hidden rounded-full">
                <img
                  alt="content"
                  className="object-cover relative z-10 object-left "
                  src="/images/profilepicture.webp"
                />

              </div>
            </AnimatedFadeInContainer> */}
          </div>
        </div>
      </div>
    </main>
  );
}
