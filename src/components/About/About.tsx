import { motion } from 'framer-motion';
import { useTheme } from 'next-themes';
import { useEffect, useMemo, useState } from 'react';

import useIntroductionQuery from 'src/hooks/useAboutQuery';
import Skills from '../../sections/Skills';
import PageLoader from '../AnimatedComponents/PageLoader';
import BackgroundAndBorder from '../BackgroundAndBorder';
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
      <div className="w-full lg:w-10/12">
        <div className="flex justify-center min-w-full flex-col items-center pb-10">
          <div className="grid grid-cols-12 w-full h-full gap-4">
            <AnimatedFadeInContainer
              type="FadeInRight"
              className="relative p-14 rounded-sm rounded-tl-[56px]  col-span-8"
            >
              <BackgroundAndBorder
                customStyle={'rounded-sm rounded-tl-[56px] '}
              />
              <AnimatedFadeInContainer
                type="FadeInLeft"
                className="flex-col flex w-full"
              >
                <h1
                  className=" text-start xl:text-4xl lg:text-xl font-extrabold text-lg md:text-lg uppercase pb-3 lg:pb-0
             tracking-wider  dark:text-gray-100 text-left "
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
                <h2 className="text-1xl font-extrabold  lg:text-2xl  md:text-xl lg:mt-4">
                  <span className="text-transparent bg-clip-text bg-gradient-to-r to-sky-600 from-yellow-400 ">
                    {aboutData?.title}
                  </span>
                </h2>
                <p className="text-sm font-normal lg:text-xl opacity-60  md:text-2xl lg:w-2/3 lg:py-6 py-2">
                  {aboutData?.info}
                </p>
              </AnimatedFadeInContainer>
            </AnimatedFadeInContainer>

            <AnimatedFadeInContainer
              type="FadeInLeft"
              className="relative p-14  rounded-sm rounded-tr-[56px]  col-span-4  bg-blue-400"
            >
              <BackgroundAndBorder
                customStyle={'rounded-sm rounded-tr-[56px] '}
              />
            </AnimatedFadeInContainer>

            <AnimatedFadeInContainer
              type="FadeInRight"
              className="relative col-span-4  h-52 rounded-bl-sm shadow-sm shadow-white  overflow-hidden"
            >
              <video
                autoPlay
                loop
                muted
                playsInline
                className="absolute -z-50 object-fill bottom-0 left-0 opacity-40"
              >
                <source src="/assets/background2.webm" type="video/webm" />
              </video>
              <img
                src="/assets/pb.png"
                className="h-42  mx-auto md:h-full md:w-42 scale-150"
              />
              {/* <div className="bg-[url('/assets/pb.png')] h-40 w-40  rounded-3xl  " /> */}
              <BackgroundAndBorder customStyle={'-z-10 opacity-30'} />
            </AnimatedFadeInContainer>

            <AnimatedFadeInContainer className="relative p-14  rounded-sm col-span-8">
              <BackgroundAndBorder customStyle={'rounded-sm'} />
              <AnimatedFadeInContainer
                type="FadeInRight"
                className="flex-col flex w-full"
              ></AnimatedFadeInContainer>
            </AnimatedFadeInContainer>
            <AnimatedFadeInContainer className="relative p-14  rounded-b-[56px] col-span-12 ">
              <BackgroundAndBorder customStyle={'rounded-b-[56px]'} />
              <AnimatedFadeInContainer
                type="FadeInRight"
                className="flex-col flex w-full"
              ></AnimatedFadeInContainer>
            </AnimatedFadeInContainer>
          </div>
        </div>

        <Stepper step={1} stepperTitle={'My Journey'} />
        <Skills />
      </div>
    </main>
  );
}
