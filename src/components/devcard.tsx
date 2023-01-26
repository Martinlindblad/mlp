import { motion } from 'framer-motion';
import Link from 'next/link';
import React, { useMemo } from 'react';
import { PageCardType } from 'src/../types/DBTypes';
import AnimatedItem from './Layouts/animatedItem';

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
      className="hover:scale-105 cursor-pointer rounded-lg hover:shadow-lg shadow-md dark:shadow-red-400 shadow-gray-900  dark:hover:shadow-gray-100 hover:shadow-gray-100 transition duration-300 ease-in-out"
    >
      <AnimatedItem
        className="relative rounded-lg border h-full flex first-letter dark:bg-transparent  bg-transparent dark:shadow-gray-100 shadow-gray-800 shadow overflow-hidden "
        itemVariant={itemVariant}
      >
        <div className="flex  flex-col justify-between py-6 leading-normal  ">
          <h5 className="text-md font-extrabold px-3 text-center ">
            {data.title}
          </h5>
          <p className="text-sm font-normal px-5 lg:text-sm text-center  mx-auto py-3">
            {data.description}
          </p>
          <div className=" inline-flex items-center  py-2 text-sm font-medium text-center mx-auto  rounded-lg   ">
            <span className="  ">Read more</span>
            <svg
              aria-hidden="true"
              className="w-4 h-4 ml-2 -mr-1"
              fill="currentColor"
              viewBox="0 0 20 20"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" />
            </svg>
          </div>
        </div>
        <motion.div className="w-full h-full -z-10 absolute rounded-sm gradientContainer animate-[gradient_16s_ease-in-out_infinite] opacity-30" />
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
