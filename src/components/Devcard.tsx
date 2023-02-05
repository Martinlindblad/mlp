import { motion } from 'framer-motion';
import Link from 'next/link';
import React, { useCallback, useMemo } from 'react';
import { PageCardType } from 'src/../types/DBTypes';
import BackgroundAndBorder from './BackgroundAndBorder';
import AnimatedItem from './Layouts/AnimatedItem';
import ContactIcon from './SVG/Contact';
import ExperienceIcon from './SVG/Experience';
import FrameworksIcon from './SVG/Frameworks';

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

  const renderIcon = useCallback(() => {
    switch (data.key) {
      case 'experience':
        return <ExperienceIcon width="35px" height="35px" fill={'white'} />;
      case 'frameworks':
        return <FrameworksIcon width="25px" height="25px" fill={'white'} />;
      case 'contact':
        return <ContactIcon width="25px" height="25px" fill={'white'} />;
    }
  }, [data.key]);

  return (
    <Link
      href={data.link}
      className={`cursor-pointer hover:scale-105 relative hover:bg-nav-${index} transition duration-200 ease-in-out rounded-2xl p-1 2xl:h-64 2xl:w-96`}
    >
      <BackgroundAndBorder customStyle=" rounded-2xl" />
      <AnimatedItem
        className=" relative rounded-2xl h-full w-full flex first-letter dark:bg-transparent  bg-transparent  overflow-hidden"
        itemVariant={itemVariant}
      >
        <div className="flex flex-col  w-full py-6 leading-normal backdrop-blur-xl  px-8">
          <div className="w-12 h-12  relative bg-gradient-to-tr mb-4 to-sky-500 from-transparent rounded-full opacity-50 shadow-sky-900 flex justify-center items-center">
            {renderIcon()}
            <div className="custom-border w-14 h-14 opacity-80  absolute rounded-full -top-1 -left-1" />
          </div>
          <h5 className="text-lg font-extrabold  text-left ">{data.title}</h5>
          <p className="text-sm font-normal  lg:text-sm text-left  mx-auto py-3 text-gray-300">
            {data.description}
          </p>
        </div>
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
          className="w-60 h-full -z-10 absolute rounded-full rotate-12 bg-gradient-to-r dark:bg-gray-600 opacity-20"
        />
      </AnimatedItem>
    </Link>
  );
};
export default DevCard;
