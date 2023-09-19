import { AnimatePresence, motion } from 'framer-motion';
import React, { useCallback, useMemo, useState } from 'react';
import CaseItem from './CaseItem';
import AnimatedFadeInContainer from './Layouts/AnimatedFadeInContainer';
import useWindowDimensions from '../hooks/useWindowDimensions';

export default function CaseCarousel() {
  const [[page, direction], setPage] = useState([0, 0]);

  const { width } = useWindowDimensions();

  const items = useMemo(() => {
    return [
      {
        title: 'ImagineCare',
        description: 'One of the most intresting projects Ive worked on',
      },
      {
        title: 'Project x',
        description: 'A very cool project Ive been working on',
      },
      {
        title: 'Project x',
        description: 'A very cool project Ive been working on',
      },
    ];
  }, []);

  const swipeConfidenceThreshold = width;
  const swipePower = (offset: number, velocity: number) => {
    return Math.abs(offset) * velocity;
  };

  const paginate = useCallback(
    (newDirection: number) => {
      setPage([page + newDirection, newDirection]);
    },
    [page],
  );

  const variants = {
    enter: (dir: number) => {
      return {
        x: dir > 0 ? 2000 : -2000,
        opacity: 0,
      };
    },
    center: {
      zIndex: 1,
      x: 0,
      opacity: 1,
    },
    exit: (dir: number) => {
      return {
        zIndex: 0,
        x: dir < 0 ? 2000 : -2000,
        opacity: 0,
      };
    },
  };

  const handlePagination = useCallback(
    (type: string) => {
      if (type === 'prev' && page !== 0) {
        return paginate(-1);
      }

      if (type === 'next' && page !== items.length - 1) {
        return paginate(1);
      }
    },
    [items.length, page, paginate],
  );

  return (
    <AnimatedFadeInContainer className="h-full align-center justify-center self-center flex">
      <div className="relative w-full h-full flex justify-center  w-5/6 items-center overflow-hidden  bg-gray-900">
        <AnimatePresence initial={false} custom={direction}>
          <motion.div
            className="w-full top-20 absolute"
            key={page}
            custom={direction}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{
              x: { type: 'spring', stiffness: 300, damping: 40 },
              opacity: { duration: 1.5 },
            }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragTransition={{ bounceStiffness: 300, bounceDamping: 14 }}
            dragElastic={1}
            onDragEnd={(e: any, { offset, velocity }: any) => {
              const swipe = swipePower(offset.x, velocity.x);

              if (swipe < -swipeConfidenceThreshold) {
                handlePagination('next');
              } else if (swipe > swipeConfidenceThreshold) {
                handlePagination('prev');
              }
            }}
          >
            <CaseItem
              title={items[page].title}
              description={items[page].description}
            />
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="absolute bottom-20 xl:bottom-40  w-full z-50 flex items-center justify-center ">
        <div className="justify-between flex items-center ">
          <div className="flex flex-col items-center">
            <span className="text-sm text-gray-700 dark:text-gray-400">
              Showing{' '}
              <span className="font-semibold text-gray-900 dark:text-white">
                {page + 1}
              </span>{' '}
              of{' '}
              <span className="font-semibold text-gray-900 dark:text-white">
                {items.length}
              </span>{' '}
              Cases/Projects
            </span>
            <div className="inline-flex mt-2 xs:mt-0">
              <button
                onClick={() => handlePagination('prev')}
                className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-gray-800 rounded-l hover:bg-gray-900 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-white"
              >
                <svg
                  aria-hidden="true"
                  className="w-5 h-5 mr-2"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    fillRule="evenodd"
                    d="M7.707 14.707a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l2.293 2.293a1 1 0 010 1.414z"
                    clipRule="evenodd"
                  ></path>
                </svg>
                Prev
              </button>
              <button
                onClick={() => handlePagination('next')}
                className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-gray-800 border-0 border-l border-gray-700 rounded-r hover:bg-gray-900 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-white"
              >
                Next
                <svg
                  aria-hidden="true"
                  className="w-5 h-5 ml-2"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    fillRule="evenodd"
                    d="M12.293 5.293a1 1 0 011.414 0l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-2.293-2.293a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  ></path>
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </AnimatedFadeInContainer>
  );
}
