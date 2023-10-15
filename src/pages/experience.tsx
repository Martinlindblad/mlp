import HeroRollingBanner from '../components/HeroRollingBanner';
import AnimatedFadeInContainer from '../components/Layouts/AnimatedFadeInContainer';
import Layout from '../components/Layouts/Layout';
import React, { useMemo } from 'react';

export function ExperienceComponent() {
  const experiences = useMemo(
    () => [
      { title: 'Print & Web Designer', duration: 'X years' },
      { title: 'UI/UX Designer & Developer', duration: 'X years' },
      { title: 'Web Developer', duration: 'X years' },
      //... Add more as needed
    ],
    [],
  );

  return (
    <div className="bg-gray-900 text-white p-12">
      <h1 className="text-4xl font-bold mb-10 text-center">My Experience</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
        {experiences.map((experience, idx) => (
          <div key={idx} className="bg-gray-800 p-6 rounded-lg shadow-md">
            <h2 className="text-xl font-semibold mb-2">{experience.title}</h2>
            <div className="text-gray-500 mb-4">
              <span className="font-bold">Duration:</span> {experience.duration}
            </div>
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
  return (
    <Layout className="w-full lg:py-24 flex-col">
      <div className="w-full h-full rounded-2xl flex justify-center items-center relative">
        <AnimatedFadeInContainer type="FadeInBottom">
          <ExperienceComponent />
          <HeroRollingBanner />
        </AnimatedFadeInContainer>
      </div>
    </Layout>
  );
};

export default Experience;
