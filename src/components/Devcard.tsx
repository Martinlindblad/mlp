import { motion } from 'framer-motion';
import Link from 'next/link';
import React, { useMemo } from 'react';
import { PageCardType } from 'src/../types/DBTypes';
import AnimatedItem from './Layouts/AnimatedItem';

const DevCard = ({
  data,
  index,
}: {
  data: PageCardType;
  index: number;
}): JSX.Element => {
  const itemVariant = useMemo(() => {
    return {
      hidden: {
        opacity: 0,
        y: -40,
        x: -30,
      },
      visible: {
        opacity: 1,
        x: 0,
        y: 0,
        transition: {
          delay: index * 0.4,
          duration: 0.5,
        },
      },
    };
  }, [index]);

  return (
    <Link
      href={data.link}
      className=" cursor-pointer hover:scale-105  transition duration-300 ease-in-out  rounded-lg hover:shadow-lg shadow-md hover:dark:shadow-red-400 shadow-gray-900   "
    >
      <AnimatedItem
        className="relative rounded-lg  h-full flex first-letter dark:bg-transparent  bg-transparent dark:shadow-gray-100 shadow-gray-800 shadow-md overflow-hidden "
        itemVariant={itemVariant}
      >
        <div className="flex flex-col justify-center w-full py-6 leading-normal backdrop-blur-xl ">
          <h5 className="text-lg font-extrabold px-3 text-center ">
            {data.title}
          </h5>
          <p className="text-sm font-normal px-5 lg:text-sm text-center  mx-auto py-3 text-gray-300">
            {data.description}
          </p>
        </div>
        <motion.div className="w-full h-full -z-10 absolute rounded-sm gradientContainer animate-[gradient_16s_ease-in-out_infinite] opacity-70" />
        <motion.div
          animate={{
            scale: [1.5, 2, 2, 1.7, 1.5],
            rotate: [40, 90, 180, 180, 40],
            borderRadius: ['40%', '20%', '100%', '60%', '40%'],
          }}
          transition={{
            duration: 16,
            ease: 'easeInOut',
            times: [0, 0.2, 0.5, 0.8, 1],
            repeat: Infinity,
            repeatDelay: 2,
          }}
          className="w-40 h-full -z-10 absolute rounded-full rotate-12 bg-gradient-to-r dark:bg-gray-600 opacity-20"
        />
      </AnimatedItem>
    </Link>
  );
};
export default DevCard;
