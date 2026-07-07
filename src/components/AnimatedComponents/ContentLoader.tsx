import { motion } from 'framer-motion';
import React from 'react';
import AnimatedPreseceWrapper from '../Layouts/AnimatePresenceWrapper';

const PageLoader = (): JSX.Element => {
  const loadingContainerVariants = {
    animate: {
      transition: {
        staggerChildren: 0.2,
      },
    },
  };

  const loadingCircleVariants = {
    initial: { y: '0%' },
    animate: {
      y: ['0%', '100%', '0%'],
      transition: {
        duration: 1,
        repeat: Infinity,
        ease: 'easeInOut',
      },
    },
  };
  //   const progressBarVariants = {
  //     initial: { x: '-100%' },
  //     animate: {
  //       x: '100%',
  //       transition: {
  //         duration: 1,
  //         repeat: Infinity,
  //         ease: 'linear',
  //       },
  //     },
  //   };
  //   <motion.div
  //   variants={progressBarVariants}
  //   initial="initial"
  //   animate="animate"
  //   className="h-1 w-full bg-gray-900 dark:bg-gray-100 mb-8"
  // />
  return (
    <div
      className="flex min-h-[16rem] w-full flex-col items-center justify-center bg-gray-100 dark:bg-gray-900"
      aria-label="Loading content"
      role="status"
    >
      <AnimatedPreseceWrapper>
        <motion.div
          variants={loadingContainerVariants}
          initial="initial"
          animate="animate"
          className="w-20 h-20 flex justify-around"
        >
          <motion.span
            className="w-5 h-5 bg-gray-900 dark:bg-gray-100 rounded-full"
            variants={loadingCircleVariants}
          />
          <motion.span
            className="w-5 h-5 bg-gray-900 dark:bg-gray-100 rounded-full"
            variants={loadingCircleVariants}
          />
          <motion.span
            className="w-5 h-5 bg-gray-900 dark:bg-gray-100 rounded-full"
            variants={loadingCircleVariants}
          />
        </motion.div>
      </AnimatedPreseceWrapper>
    </div>
  );
};
export default PageLoader;
