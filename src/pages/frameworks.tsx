import { motion } from 'framer-motion';
import React from 'react';
import AnimatedFadeInContainer from 'src/components/Layouts/AnimatedFadeInContainer';
import Layout from 'src/components/Layouts/layout';
import Navbar from 'src/sections/navigation/navbar';

const Frameworks = (): JSX.Element => {
  return (
    <Layout className="bg-gray-100 dark:bg-gray-900 min-h-screen relative">
      <Navbar />
      <AnimatedFadeInContainer type="FadeInBottom">
        <h1 className="text-lg font-normal lg:text-xl px-8  text-center lg:w-2/3 mx-auto flex pt-32 lg:pt-10 lg:items-center lg:justify-center w-full lg:container min-h-screen">
          Frameworks
        </h1>
        <div className="w-40 h-full -z-10 absolute top-0 left-1/2">
          <motion.div
            animate={{
              rotate: [40, 90, 180, 180, 40],
              borderRadius: ['10%', '10%', '10%', '10%', '10%'],
            }}
            transition={{
              duration: 16,
              ease: 'easeInOut',
              times: [0, 0.2, 0.5, 0.8, 1],
              repeat: Infinity,
              repeatDelay: 2,
            }}
            className="w-40 h-40 -z-10 absolute top-1/3 -right-20 rounded-full rotate-12 bg-gradient-to-r dark:bg-gray-600 opacity-20"
          />
        </div>
      </AnimatedFadeInContainer>
    </Layout>
  );
};

export default Frameworks;
