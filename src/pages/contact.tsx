import React from 'react';
import AnimatedFadeInContainer from 'src/components/Layouts/AnimatedFadeInContainer';
import Layout from 'src/components/Layouts/Layout';
import Navbar from 'src/sections/Navigation/Navbar';

const Contact = (): JSX.Element => {
  return (
    <Layout className="bg-gray-100 dark:bg-gray-900 min-h-screen relative">
      <AnimatedFadeInContainer type="FadeInBottom">
        <h1 className="text-lg font-normal lg:text-xl px-8  text-center lg:w-2/3 mx-auto flex pt-32 lg:pt-10 lg:items-center lg:justify-center w-full lg:container min-h-screen">
          Contact
        </h1>
      </AnimatedFadeInContainer>
      <Navbar />
    </Layout>
  );
};

export default Contact;
