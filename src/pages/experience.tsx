import AnimatedName from '../components/AnimatedComponents/AnimatedName';
import HeroRollingBanner from '../components/HeroRollingBanner';
import AnimatedFadeInContainer from '../components/Layouts/AnimatedFadeInContainer';
import Layout from '../components/Layouts/Layout';
import React, { useMemo } from 'react';
import useAboutQuery from '../hooks/useAboutQuery';
import { ProfessionalProfileintroduction } from 'src/types/DBTypes';

export function ExperienceComponent() {
  const experiences = useMemo(
    () => [
      { title: 'Print & Web Designer', duration: 'X years' },
      { title: 'UI/UX Designer & Developer', duration: 'X years' },
      { title: 'Web Developer', duration: 'X years' },
    ],
    [],
  );

  return (
    <div className="text-white p-12 lg:container">
      <h1 className="text-4xl font-bold mb-10 text-center">My Experience</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
        {experiences.map((experience, idx) => (
          <div key={idx} className="bg-gray-800 p-6 rounded-lg shadow-md">
            <h1 className="mb-4 text-4xl font-extrabold leading-none tracking-tight text-gray-900 md:text-5xl lg:text-6xl dark:text-white">
              {experience.title}
              <span className="text-blue-600 dark:text-blue-500"></span> CRM.
            </h1>
            <p className="text-lg font-normal text-gray-500 lg:text-xl dark:text-gray-400">
              {experience.duration}
            </p>

            <button className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded font-semibold">
              Details
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

const Experience = (): JSX.Element => {
  const { data: personalInfo } = useAboutQuery('introduction');
  const personalInfoData =
    personalInfo as unknown as ProfessionalProfileintroduction;

  return (
    <Layout className="w-full  flex-col">
      <div className="pt-20 sm:pt-10 pb-6 sm:pb-10 justify-center align-center flex">
        <AnimatedName personalInfo={personalInfoData} />
      </div>
      <div className="w-full lg:py-24 h-full rounded-2xl flex justify-center items-center relative">
        <AnimatedFadeInContainer type="FadeInBottom">
          <ExperienceComponent />
        </AnimatedFadeInContainer>
        <HeroRollingBanner />
      </div>
    </Layout>
  );
};

export default Experience;
