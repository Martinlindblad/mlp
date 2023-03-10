import React from 'react';
import AnimatedFadeInContainer from 'src/components/Layouts/AnimatedFadeInContainer';
import Layout from 'src/components/Layouts/Layout';

const Contact = (): JSX.Element => {
  return (
    <Layout className="bg-blue-100 dark:bg-gray-900 min-h-screen relative">
      <AnimatedFadeInContainer type="FadeInBottom">
        <h1 className="text-lg font-normal lg:text-xl px-8  text-center lg:w-2/3 mx-auto flex pt-32 lg:pt-10 lg:items-center lg:justify-center w-full lg:container min-h-screen">
          Contact
        </h1>
      </AnimatedFadeInContainer>
    </Layout>
  );
};

export default Contact;
