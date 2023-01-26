import { motion } from 'framer-motion';
import React from 'react';
import { IconProps } from './Home';

const FrameworksIcon: React.FC<IconProps> = ({ width, height, fill }) => {
  return (
    <motion.svg
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
      fill={fill}
      viewBox="0 0 24 24"
      stroke={''}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="feather feather-layers"
      whileHover={{ scale: 1.1 }}
    >
      <motion.path
        d="M11.99 18.54l-7.37-5.73L3 14.07l9 7 9-7-1.63-1.27-7.38 5.74zM12 16l7.36-5.73L21 9l-9-7-9 7 1.63 1.27L12 16z"
        variants={{
          open: {
            rotate: 0,
            transition: {
              duration: 0.5,
              ease: 'easeOut',
            },
          },
          closed: {
            rotate: 360,
            transition: {
              duration: 0.5,
              ease: 'easeOut',
            },
          },
        }}
        initial="closed"
        animate="open"
      />
    </motion.svg>
  );
};

export default FrameworksIcon;
