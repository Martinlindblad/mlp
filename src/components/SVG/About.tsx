import * as React from 'react';
import { motion } from 'framer-motion';
import { IconProps } from './Home';

const AboutIcon: React.FC<IconProps> = ({ width, height, fill }) => {
  const pathVariants = {
    hover: {
      scale: 1.2,
      transition: { duration: 0.5 },
    },
    tap: {
      scale: 0.9,
      transition: { duration: 0.2 },
    },
    initial: {
      scale: 1,
    },
  };
  return (
    <motion.svg
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
      viewBox="0 0 30 30"
    >
      <motion.path
        fill={fill}
        d="M15 1c8.284 0 15 6.716 15 15s-6.716 15-15 15S0 23.284 0 15 6.716 0 15 0zm0 2C8.373 3 3 8.373 3 15s5.373 12 12 12 12-5.373 12-12S21.627 3 15 3zm-1.5 7a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm3 0a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm3 0a1.5 1.5 0 100 3 1.5 1.5 0 000-3z"
        variants={pathVariants}
        initial="initial"
        whileHover="hover"
        whileTap="tap"
      />
    </motion.svg>
  );
};
export default AboutIcon;
