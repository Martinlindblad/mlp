import React from 'react';
import AnimatedFadeInContainer from 'src/components/Layouts/AnimatedFadeInContainer';
import Navbar from 'src/sections/navigation/navbar';

const About = (): JSX.Element => {
  return (
    <div className="bg-gray-100 dark:bg-gray-900 min-h-screen ">
      <Navbar />
      <AnimatedFadeInContainer type="FadeInBottom">
        <p className="text-lg font-normal lg:text-xl px-8  text-center lg:w-2/3 mx-auto flex pt-32 lg:pt-10 lg:items-center lg:justify-center w-full lg:container min-h-screen">
          {"I'm"} based in Stockholm, Sweden.
          <br /> With two years experience as a developer my passion lies in
          beautiful creation and fresh innovation.
          {" I'm"} always thrilled to gain new experience and strive to become
          the best version of myself.
        </p>
      </AnimatedFadeInContainer>
    </div>
  );
};

export default About;
