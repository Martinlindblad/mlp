import React from 'react';
import AnimatedFadeInContainer from '../components/Layouts/AnimatedFadeInContainer';
import Layout from '../components/Layouts/Layout';

const Frameworks = (): JSX.Element => {
  return (
    <Layout className="bg-slate-100 justify-center align-center flex-col dark:bg-gray-900 min-h-screen relative">
      <div className="realative overflow-hidden ">
        <AnimatedFadeInContainer type="FadeInBottom">
          <h1 className="text-lg font-normal lg:text-xl px-8  text-center lg:w-2/3 mx-auto flex pt-32 lg:pt-10 lg:items-center lg:justify-center w-full lg:container min-h-screen">
            Frameworks
          </h1>
        </AnimatedFadeInContainer>
      </div>
    </Layout>
  );
};

export default Frameworks;
