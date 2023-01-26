import * as React from 'react';
import { motion } from 'framer-motion';

type IconProps = {
  width: number | string;
  height: number | string;
  fill: string;
};

const ExperienceIcon: React.FC<IconProps> = ({ width, height, fill }) => {
  const pathVariants = {
    hover: {
      scale: 1.2,
      transition: { duration: 0.3 },
    },
    tap: {
      scale: 0.8,
      transition: { duration: 0.1 },
    },
  };

  return (
    <motion.svg
      width={width}
      height={height}
      fill={fill}
      viewBox="0 0 100 100"
      whileHover="hover"
      whileTap="tap"
    >
      <motion.path
        d="M50,20 C50,20 70,35 70,50 C70,65 50,80 50,80 C50,80 30,65 30,50 C30,35 50,20 50,20"
        variants={pathVariants}
        strokeWidth="6"
        strokeLinecap="round"
      />
      <motion.path
        d="M50,50 L50,70"
        variants={pathVariants}
        strokeWidth="6"
        strokeLinecap="round"
      />
      <motion.path
        d="M50,50 L70,70"
        variants={pathVariants}
        strokeWidth="6"
        strokeLinecap="round"
      />
    </motion.svg>
  );
};

export default ExperienceIcon;
