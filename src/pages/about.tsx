import React from 'react';
import AnimatedFadeInContainer from '../components/Layouts/AnimatedFadeInContainer';
import Layout from '../components/Layouts/Layout';

const About = (): JSX.Element => {
  return (
    <Layout className="w-full lg:py-24 flex-col ">
      <div className="w-full h-full rounded-2xl flex justify-center items-center relative">
        <AnimatedFadeInContainer type="FadeInBottom">
          <section className="text-gray-400   dark:text-gray-100 body-font">
            <div className="container px-5 py-24 mx-auto flex flex-col">
              <div className="lg:w-4/6 mx-auto">
                <div className="rounded-lg h-64 overflow-hidden">
                  <img
                    alt="content"
                    className="object-cover object-center h-full w-full"
                    src="/images/friends.png"
                  />
                </div>
                <div className="flex flex-col sm:flex-row mt-10">
                  <div className="sm:w-1/3 text-center sm:pr-8 sm:py-8">
                    <div className="w-28 h-28 rounded-full inline-flex items-center justify-center bg-sky-500 text-gray-600 dark:text-gray-900 overflow-hidden">
                      <img
                        alt="content"
                        className="object-cover object-center h-full w-full"
                        src="/images/profilepicture.webp"
                      />
                    </div>
                    <div className="flex flex-col items-center text-center justify-center">
                      <h2 className="font-medium title-font mt-4 text-white dark:text-gray-100 text-lg">
                        Phoebe Caulfield
                      </h2>
                      <div className="w-12 h-1 bg-blue-500 dark:bg-blue-400 rounded mt-2 mb-4"></div>
                      <p className="text-base text-gray-400 dark:text-gray-300">
                        Raclette knausgaard hella meggs normcore williamsburg
                        enamel pin sartorial venmo tbh hot chicken gentrify
                        portland.
                      </p>
                    </div>
                  </div>
                  <div className="sm:w-2/3 sm:pl-8 sm:py-8 sm:border-l border-gray-800 sm:border-t-0 border-t mt-4 pt-4 sm:mt-0 text-center sm:text-left">
                    <p className="leading-relaxed text-lg mb-4">
                      Meggings portland fingerstache lyft, post-ironic fixie man
                      bun banh mi umami everyday carry hexagon locavore direct
                      trade art party. Locavore small batch listicle gastropub
                      farm-to-table lumbersexual salvia messenger bag. Coloring
                      book flannel truffaut craft beer drinking vinegar
                      sartorial, disrupt fashion axe normcore meh butcher.
                      Portland scenester vexillologist forage post-ironic
                      asymmetrical, chartreuse disrupt butcher paleo
                      intelligentsia pabst before they sold out four loko. 3
                      wolf moon brooklyn.
                    </p>
                    <a className="text-blue-400 dark:text-blue-300 inline-flex items-center">
                      Learn More
                      <svg
                        fill="none"
                        stroke="currentColor"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        className="w-4 h-4 ml-2"
                        viewBox="0 0 24 24"
                      >
                        <path d="M5 12h14M12 5l7 7-7 7"></path>
                      </svg>
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </AnimatedFadeInContainer>
        {/* <Sakura /> */}
      </div>
    </Layout>
  );
};

export default About;
