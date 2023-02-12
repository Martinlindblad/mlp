import { motion } from 'framer-motion';
import React from 'react';

export interface IconProps {
  width: string;
  height: string;
  fill: string;
}

const HomeIcon: React.FC<IconProps> = ({ width, height, fill }) => {
  const iconVariants = {
    hover: {
      scale: 1.2,
      transition: { duration: 0.2 },
    },
    tap: {
      scale: 0.9,
      transition: { duration: 0.2 },
    },
  };

  return (
    <motion.svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={width}
      height={height}
      whileHover="hover"
      variants={iconVariants}
      whileTap="tap"
      aria-hidden="true"
      fill={fill}
      stroke={fill}
      strokeWidth="1.5"
    >
      <motion.path
        d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"
        stroke-linecap="round"
        fill={fill}
        stroke-linejoin="round"
      />
    </motion.svg>
  );
};

export default HomeIcon;
