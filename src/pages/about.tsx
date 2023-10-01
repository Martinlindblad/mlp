import React from 'react';
import AnimatedFadeInContainer from '../components/Layouts/AnimatedFadeInContainer';
import Layout from '../components/Layouts/Layout';

const About = (): JSX.Element => {
  return (
    <Layout className="w-full lg:py-24 flex-col">
      <div className="w-full h-full rounded-2xl flex justify-center items-center relative">
        <AnimatedFadeInContainer type="FadeInBottom">
          <div className="relative w-full h-full col-span-12">
            <div className="flex-col flex w-full pl-4 md:pl-20 py-10 justify-center align-center dark:bg-slate-700 bg-slate-300 h-full">
              <div className=" pb-2 flex flex-row justify-start items-start ">
                <p className="text-lg font-normal lg:text-xl px-8  text-center lg:w-2/3 mx-auto flex pt-32 lg:pt-10 lg:items-center lg:justify-center w-full lg:container min-h-screen">
                  {"I'm"} based in Stockholm, Sweden.
                  <br /> With two years experience as a developer my passion
                  lies in beautiful creation and fresh innovation.
                  {" I'm"} always thrilled to gain new experience and strive to
                  become the best version of myself.
                </p>
              </div>
            </div>
          </div>
        </AnimatedFadeInContainer>
      </div>
    </Layout>
  );
};

export default About;
