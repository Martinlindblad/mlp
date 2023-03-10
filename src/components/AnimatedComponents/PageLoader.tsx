import { motion } from 'framer-motion';
import React from 'react';

const PageLoader = (): JSX.Element => {
  const loadingContainerVariants = {
    start: {
      transition: {
        staggerChildren: 0.2,
      },
    },
    end: {
      transition: {
        staggerChildren: 0.2,
      },
    },
  };

  const loadingCircleVariants = {
    start: {
      y: '0%',
    },
    end: {
      y: '100%',
    },
  };
  const loadingCircleTransition = {
    duration: 0.5,
    yoyo: Infinity,
    ease: 'easeInOut',
  };

  return (
    <div className="w-full h-full flex fixed z-50 justify-center items-center dark:bg-gray-900 bg-blue-200">
      <motion.div
        variants={loadingContainerVariants}
        initial="start"
        animate="end"
        className="w-20 h-20 flex justify-around"
      >
        <motion.span
          className="w-5 h-5 bg-gray-900 dark:bg-blue-100 rounded-full"
          variants={loadingCircleVariants}
          transition={loadingCircleTransition}
        />
        <motion.span
          className="w-5 h-5 bg-gray-900 dark:bg-blue-100 rounded-full"
          variants={loadingCircleVariants}
          transition={loadingCircleTransition}
        />
        <motion.span
          className="w-5 h-5 bg-gray-900 dark:bg-blue-100 rounded-full"
          variants={loadingCircleVariants}
          transition={loadingCircleTransition}
        />
      </motion.div>
    </div>
  );
};
export default PageLoader;
