import AnimatedFadeInContainer from '../Layouts/AnimatedFadeInContainer';

import SocialMediaLinks from '../SocialMediaLinks';

import ContentLoader from '../AnimatedComponents/ContentLoader';

import Link from 'next/link';
import Image from 'next/image';
import AnimatedName from '../AnimatedComponents/AnimatedName';
import useAboutQuery from 'src/src/hooks/useAboutQuery';
import { ProfessionalProfileintroduction } from 'src/types/DBTypes';

export default function Hero() {
  const { data: personalInfo, isLoading } = useAboutQuery('introduction');
  const personalInfoData =
    personalInfo as unknown as ProfessionalProfileintroduction;
  return isLoading ? (
    <ContentLoader />
  ) : (
    <main className="lg:container grid grid-cols-12 pb-12 lg:pb-0 h-screen">
      <Image
        alt="Profile Picture"
        className="object-cover absolute z-0 object-right h-full dark:opacity-60 opacity-70 right-0 grayscale contrast-200 shadow-lg"
        src="/images/profilepicture.webp"
        layout="fill"
        objectFit="contain"
      />

      <div className="col-span-10 col-start-2 lg:col-span-12">
        <div className="pt-60 sm:pt-6 lg:pb-0 sm:pl-32 lg:flex-row flex-col flex flex-wrap justify-center relative">
          <AnimatedName personalInfo={personalInfoData} />
        </div>
      </div>
      <div className="flex-col col-span-12">
        <div className="rounded-2xl flex flex-row justify-center items-center relative">
          <div className="grid grid-cols-12 items-center justify-center">
            <AnimatedFadeInContainer
              type="FadeInBottom"
              className="relative col-span-10 col-start-2 lg:col-span-6 lg:col-start-2 xl:col-start-2 2xl:col-span-6"
            >
              <div className="flex flex-col py-4 sm:py-0 md:py-10 justify-center items-start">
                <div className="flex flex-row justify-start items-start">
                  <h1 className="text-lg md:text-xl lg:text-2xl xl:text-3xl font-bold pr-6">
                    Front-end Developer
                    <br />
                    Where design Meets Functionality
                  </h1>
                </div>
                <p className="text-sm sm:text-sm md:text-base lg:text-lg font-normal opacity-60 py-4 pr-4 md:pr-12 lg:pr-24">
                  {personalInfoData?.info}
                </p>
                <Link
                  href="/about"
                  className="flex items-center bg-transparent border  px-4 sm:px-6 md:px-10 mt-4 sm:mt-0 py-2 sm:py-0 md:py-3 transition duration-300 ease-in-out text-xs sm:text-sm md:text-base hover:bg-[#desiredColor] hover:scale-105"
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
