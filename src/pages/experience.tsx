import React from 'react';
import AnimatedFadeInContainer from 'src/components/Layouts/AnimatedFadeInContainer';
import Layout from 'src/components/Layouts/layout';
import Navbar from 'src/sections/navigation/navbar';

const Experience = (): JSX.Element => {
  return (
    <Layout className="bg-gray-100 dark:bg-gray-900 min-h-screen relative">
      <Navbar />
      <AnimatedFadeInContainer type="FadeInBottom">
        <h1 className="text-lg font-normal lg:text-xl px-8  text-center lg:w-2/3 mx-auto flex pt-32 lg:pt-10 lg:items-center lg:justify-center w-full lg:container min-h-screen">
          Experience
        </h1>
      </AnimatedFadeInContainer>
    </Layout>
  );
};

export default Experience;
