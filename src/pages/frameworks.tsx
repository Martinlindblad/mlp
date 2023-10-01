import React from 'react';
import AnimatedFadeInContainer from '../components/Layouts/AnimatedFadeInContainer';
import Layout from '../components/Layouts/Layout';

const Frameworks = (): JSX.Element => {
  return (
    <Layout className="w-full lg:py-24 flex-col">
      <div className="w-full h-full rounded-2xl flex justify-center items-center relative">
        <AnimatedFadeInContainer type="FadeInBottom">
          <div className="relative w-full h-full  col-span-12">
            <div className="flex-col flex w-full pl-4 md:pl-20 py-10 justify-center align-center dark:bg-gray-700 bg-gray-300 h-full">
              <div className=" pb-2 flex flex-row justify-start items-start ">
                <h1 className="text-lg font-extrabold  lg:text-sm  md:text-xl pl-4">
                  Frameworks
                </h1>
              </div>
            </div>
          </div>
        </AnimatedFadeInContainer>
      </div>
    </Layout>
  );
};

export default Frameworks;
