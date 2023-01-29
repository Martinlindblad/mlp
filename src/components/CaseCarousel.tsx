import { AnimatePresence, motion } from 'framer-motion';
import React, { useCallback, useMemo, useState } from 'react';
import CaseItem from './CaseItem';
import AnimatedFadeInContainer from './Layouts/AnimatedFadeInContainer';

export default function CaseCarousel() {
  const [[page, direction], setPage] = useState([0, 0]);

  const items = useMemo(() => {
    return [
      {
        title: 'Project x',
        description: 'A very cool project Ive been working on',
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

  const swipeConfidenceThreshold = 10000;
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
    <AnimatedFadeInContainer>
      <div className="relative container h-2/3 flex justify-center items-center">
        <AnimatePresence initial={false} custom={direction}>
          <motion.div
            className=" w-full h-full absolute "
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
            dragElastic={1}
            onDragEnd={(e: any, { offset, velocity }: any) => {
              const swipe = swipePower(offset.x, velocity.x);

              if (swipe < -swipeConfidenceThreshold) {
                paginate(1);
              } else if (swipe > swipeConfidenceThreshold) {
                paginate(-1);
              }
            }}
          >
            <CaseItem
              title={items[page].title}
              description={items[page].description}
            />
          </motion.div>
        </AnimatePresence>
        <div className="absolute bottom-0 itmes-center justify-between w-2/5  pb-20 self-center  flex-row flex">
          <div
            className="bg-sky-900 rounded-full w-10 h-10 flex justify-center items-center select-none cursor-pointer font-black font-xl z-10  rotate-180"
            onClick={() => handlePagination('prev')}
          >
            {'‣'}
          </div>
          <p className="leading-10 flex-1 hidden lg:visible lg:display-flex text-center">
            Previous Case
          </p>
          <p className="leading-10 flex-1  hidden lg:visible text-center">
            Next Case
          </p>
          <div
            className=" bg-sky-900 rounded-full w-10 h-10 flex justify-center items-center select-none cursor-pointer font-black font-xl z-10  "
            onClick={() => handlePagination('next')}
          >
            {'‣'}
          </div>
        </div>
      </div>
    </AnimatedFadeInContainer>
  );
}
