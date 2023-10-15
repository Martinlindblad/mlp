import { motion } from 'framer-motion';
import { useTheme } from 'next-themes';
import { useMemo } from 'react';

import AnimatedContainer from '../Layouts/AnimatedContainer';
import AnimatedFadeInContainer from '../Layouts/AnimatedFadeInContainer';

import SocialMediaLinks from '../SocialMediaLinks';
import useIntroductionQuery from 'src/src/hooks/useIntroductiontQuery';
import HeroRollingBanner from '../HeroRollingBanner';
import ContentLoader from '../AnimatedComponents/ContentLoader';
import Link from 'next/link';
import Logo from '../SVG/Logo';

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
    <main className="lg:container grid grid-cols-12 h-full pb-12">
      <div className="col-span-10 col-start-2 lg:col-span-12">
        <div className="pt-24 lg:pt-6 lg:pb-10 lg:flex-row flex-col flex w-full flex-wrap justify-between relative ">
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

          <SocialMediaLinks />
        </div>
      </div>
      <div className="w-full lg:py-24 flex-col col-span-12 ">
        <div className="w-full lg:h-full rounded-2xl flex flex-row justify-center items-center relative">
          <div className="grid grid-cols-12 w-full h-4/6 ">
            <AnimatedFadeInContainer
              type="FadeInBottom"
              className="relative w-full h-full col-span-10 col-start-2 lg:col-span-5 lg:col-start-2 "
            >
              <div className="flex-col flex w-full py-10 justify-center align-center ">
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
              </div>
            </AnimatedFadeInContainer>
            <AnimatedFadeInContainer
              type="FadeInBottom"
              className="col-span-10 col-start-2 lg:col-span-6"
            >
              <Link
                href={'/frameworks'}
                className="relative hover:cursor-pointer h-56
            w-full lg:h-full
            flex justify-center backdrop-blur-sm contrast-125
            bg-gradient-to-r from-blue-500 to-purple-500 rounded-xl
            shadow-lg hover:scale-105 transition-transform duration-300
            ease-in-out"
              >
                <HeroRollingBanner />
              </Link>
            </AnimatedFadeInContainer>
          </div>
        </div>
      </div>
    </main>
  );
}
