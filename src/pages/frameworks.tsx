import React from 'react';
import AnimatedFadeInContainer from '../components/Layouts/AnimatedFadeInContainer';
import Layout from '../components/Layouts/Layout';

const Frameworks = (): JSX.Element => {
  return (
    <Layout className="bg-slate-100 justify-center align-center flex-col dark:bg-gray-900 min-h-screen relative">
      <div className="w-full h-full rounded-2xl flex justify-center items-center relative">
        <AnimatedFadeInContainer
          type="FadeInBottom"
          className="grid grid-cols-12 w-full h-4/6 "
        >
          <div className="relative w-full h-full  col-span-12">
            <div className="flex-col flex w-full pl-4 md:pl-20 py-10 justify-center align-center dark:bg-slate-700 bg-slate-300 h-full">
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
