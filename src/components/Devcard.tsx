import Link from 'next/link';
import React, { useCallback, useMemo } from 'react';
import BackgroundAndBorder from './BackgroundAndBorder';
import AnimatedItem from './Layouts/AnimatedItem';
import ContactIcon from './SVG/Contact';
import ExperienceIcon from './SVG/Experience';
import FrameworksIcon from './SVG/Frameworks';
import { PageCardType } from 'src/types/DBTypes';
import Colors from '../sections/Navigation/Colors';

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
  const whileHover = useMemo(
    () => ({
      scale: 1.05,
      backgroundColor: Colors[(index + 3) as keyof typeof Colors],
      transition: { duration: 0.2 },
    }),
    [index],
  );

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
    <AnimatedItem
      itemVariant={itemVariant}
      whileHover={whileHover}
      className={`cursor-pointer relative rounded-2xl p-1 2xl:h-64 2xl:w-96 my-3 lg:my-0`}
    >
      <BackgroundAndBorder customStyle="rounded-2xl opacity-40" />
      <Link
        className="relative rounded-2xl h-full w-full flex first-letter bg-transparent overflow-hidden"
        href={data.link}
      >
        <div className="flex flex-col w-full py-6 leading-normal backdrop-blur-lg  px-8">
          <div
            style={{
              backgroundColor: Colors[(index + 3) as keyof typeof Colors],
            }}
            className="w-12 h-12 relative bg-gradient-to-tr mb-4 to-transparent rounded-full opacity-80 shadow-sky-900 flex justify-center items-center"
          >
            {renderIcon()}
            <div className="custom-border w-14 h-14 opacity-80 absolute rounded-full -top-1 -left-1" />
          </div>
          <h5 className="text-lg font-extrabold  text-left ">{data.title}</h5>
          <p className="text-sm font-normal  lg:text-sm text-left  mx-auto py-3 dark:text-gray-300 text-gray-700">
            {data.description}
          </p>
        </div>
      </Link>
    </AnimatedItem>
  );
};
export default DevCard;
