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

  return (
    <div className="fixed top-0 left-0 w-full h-screen flex justify-center items-center dark:bg-gray-900 bg-slate-100 z-50">
      <AnimatedPreseceWrapper>
        <motion.div
          variants={loadingContainerVariants}
          initial="initial"
          animate="animate"
          className="w-20 h-20 flex justify-around"
        >
          <motion.span
            className="w-5 h-5 bg-gray-900 dark:bg-slate-100 rounded-full"
            variants={loadingCircleVariants}
          />
          <motion.span
            className="w-5 h-5 bg-gray-900 dark:bg-slate-100 rounded-full"
            variants={loadingCircleVariants}
          />
          <motion.span
            className="w-5 h-5 bg-gray-900 dark:bg-slate-100 rounded-full"
            variants={loadingCircleVariants}
          />
        </motion.div>
      </AnimatedPreseceWrapper>
    </div>
  );
};
export default PageLoader;
