import React from 'react';
import AnimatedFadeInContainer from '../components/Layouts/AnimatedFadeInContainer';
import Layout from '../components/Layouts/Layout';

const Frameworks = (): JSX.Element => {
  return (
    <Layout className="bg-slate-100 justify-center align-center flex-col dark:bg-gray-900 min-h-screen relative">
      <div className="realative overflow-hidden ">
        <main className="lg:container pt-24 lg:pt-0 ">
          <div className="w-full lg:py-24 flex-col">
            <div className="w-full h-full flex justify-center items-center relative">
              <AnimatedFadeInContainer type="FadeInBottom">
                <h1 className="text-lg font-normal lg:text-xl px-8  text-center lg:w-2/3 mx-auto flex pt-32 lg:pt-10 lg:items-center lg:justify-center w-full lg:container min-h-screen">
                  Frameworks
                </h1>
              </AnimatedFadeInContainer>
            </div>
          </div>
        </main>
      </div>
    </Layout>
  );
};

export default Frameworks;
