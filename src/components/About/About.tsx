import { motion } from 'framer-motion';
import { useTheme } from 'next-themes';
import { useMemo } from 'react';

import AnimatedContainer from '../Layouts/AnimatedContainer';
import AnimatedFadeInContainer from '../Layouts/AnimatedFadeInContainer';

import SocialMediaLinks from '../SocialMediaLinks';
import useIntroductionQuery from 'src/src/hooks/useIntroductiontQuery';
import MultiSwiper from '../MultiSwiper';

export default function Biography() {
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
    <p>Loading content...</p>
  ) : (
    <main className="lg:container lg:pt-0 ">
      <div className="md:pl-20 pt-24 pl-4 lg:pt-6 pb-10 flex-row flex w-full flex-wrap justify-between">
        <h1
          className="xl:text-3xl lg:text-lg  pb-4 lg:pb-0 text-lg md:text-lg
             tracking-wider dark:text-gray-100 "
        >
          <AnimatedContainer
            key={'IntroductionNameContainer'}
            containerVariant={container}
            className="flex-row flex w-full flex-wrap "
          >
            {CharacterString.map((character, index) => (
              <motion.span
                className={` ${
                  theme === 'dark'
                    ? 'animate-[darkColors_3s_ease-in-out]'
                    : 'animate-[lightColors_3s_ease-in-out]'
                } ${
                  index > 6
                    ? 'text-3xl text-[#0ea5e9] font-thin'
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
      <div className="w-full lg:py-24 flex-col ">
        <div className="w-full h-full rounded-2xl flex justify-center items-center relative">
          <AnimatedFadeInContainer
            type="FadeInBottom"
            className="grid grid-cols-12 w-full h-4/6 "
          >
            <div className="relative w-full h-full lg:col-span-6 col-span-12">
              <div className="flex-col flex w-full pl-4 md:pl-20 py-10 justify-center h-80 align-center ">
                <div className=" flex flex-row justify-start items-start ">
                  {/* <Avatar />
                  <h2 className="text-lg pt-1 font-extrabold lg:text-sm md:text-xl pl-4">
                    <p>Hi!, {"I'm a"}</p>
                    <span className="opacity-30">{aboutData?.title}</span>
                  </h2> */}
                  <h2 className="text-lg pt-1 font-extrabold lg:text-sm md:text-xl pr-6">
                    <span className="text-4xl font-bold ">
                      Front-end Developer
                    </span>
                    <br />
                    <span className="text-4xl font-bold ">
                      Design Meets Functionality
                    </span>
                  </h2>
                </div>

                <p className="text-sm lg:pr-32 font-normal lg:text-xl opacity-60 md:text-2xl md:py-6 py-2">
                  {aboutData?.info}
                </p>
              </div>
            </div>
            <div className="relative h-56 sm:h-96 w-full lg:h-full lg:col-span-6 col-span-12 flex justify-center backdrop-blur-sm contrast-125 bg-gradient-to-r from-blue-500 to-purple-500 rounded-xl shadow-lg hover:scale-105 transition-transform duration-300 ease-in-out">
              <MultiSwiper />
            </div>
          </AnimatedFadeInContainer>
        </div>
      </div>
    </main>
  );
}
