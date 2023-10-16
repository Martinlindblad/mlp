import React, { useState } from 'react';
import AnimatedFadeInContainer from '../components/Layouts/AnimatedFadeInContainer';
import Layout from '../components/Layouts/Layout';
import Link from 'next/link';
import WorkShowcase from '../components/WorkShowcase';
import { motion } from 'framer-motion';

const AboutPage = (): JSX.Element => {
  const [isOpen, setIsOpen] = useState(false);

  const toggleContent = () => {
    setIsOpen(!isOpen);
  };

  return (
    <Layout className="w-full flex-col ">
      <section className="text-gray-400 lg:h-screen  dark:text-gray-100 body-font ">
        <div className="px-5 mx-auto flex flex-col justify-center align-center h-full">
          <AnimatedFadeInContainer type="FadeInBottom ">
            <div className="lg:w-4/6 mx-auto">
              <div className="rounded-lg h-64 overflow-hidden">
                <img
                  alt="content"
                  className="object-cover object-center h-full w-full shadow-lg"
                  src="/images/meeting.webp"
                />
              </div>
              <div className="flex flex-col sm:flex-row mt-10">
                <div className="sm:w-1/3 text-center sm:pr-8 sm:py-8">
                  <div className="w-28 h-28 rounded-full inline-flex items-center justify-center relative overflow-hidden">
                    <img
                      alt="content"
                      className="object-cover object-left h-full w-full opacity-85"
                      src="/images/profilbild2.jpg"
                    />
                  </div>
                  <div className="flex flex-col items-center text-center justify-center">
                    <h2 className="font-medium title-font mt-4 text-gray-900 dark:text-gray-200 text-lg">
                      Martin Lindblad
                    </h2>
                    <div className="w-12 h-1 bg-blue-500 dark:bg-blue-500 rounded mt-2 mb-4"></div>
                    <p className="text-base text-gray-600 dark:text-gray-300 ">
                      I am a Front-end developer based in Stockholm, Sweden.
                    </p>
                  </div>
                </div>
                <div className="sm:w-2/3 sm:pl-8 sm:py-8 sm:border-l border-gray-800 sm:border-t-0 border-t mt-4 pt-4 sm:mt-0 text-center sm:text-left">
                  <p className="text-gray-700 dark:text-gray-200 leading-relaxed text-lg mb-4">
                    Hello there! I am Martin, a Front-end developer with 3 years
                    of working experience in the industry. I am currently
                    working at{' '}
                    <Link
                      href={'https://pija.se/'}
                      className="text-blue-400 dark:text-blue-300 inline-flex items-center cursor-pointer hover:underline"
                      about="PiJa Media & Management AB"
                    >
                      PiJa Media & Management AB
                    </Link>
                    . I am passionate about developing products and improving
                    myself because there is always another step ahead, a new
                    goal to pursue, or a challenge to overcome. <br />
                    <br />I firmly believe in the power of continuous learning
                    and remain an ever-curious student of life and the vast
                    digital world that surrounds us.
                  </p>
                </div>
              </div>
            </div>
          </AnimatedFadeInContainer>
        </div>
      </section>

      <motion.button
        onClick={toggleContent}
        className="bg-blue-500 text-white py-2 px-4 rounded-md focus:outline-none"
        whileHover={{
          scale: 1.05,
          boxShadow: '0px 0px 8px rgba(0, 0, 255, 0.6)',
        }}
        transition={{ duration: 0.3 }}
      >
        {isOpen ? 'Hide work' : 'See more about me'}
      </motion.button>

      {isOpen && (
        <motion.div animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
          <WorkShowcase />
        </motion.div>
      )}
    </Layout>
  );
};

export default AboutPage;
