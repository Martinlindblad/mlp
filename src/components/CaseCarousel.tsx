// import React, { useState, useRef } from 'react';
// import { motion, AnimatePresence, AnimateSharedLayout } from 'framer-motion';
// import { wrap } from '@popmotion/popcorn';
// import CaseItem from './CaseItem';

// // Constants
// const xOffset = 100;
// const variants = {
//   enter: (direction: number) => ({
//     x: direction > 0 ? xOffset : -xOffset,
//     opacity: 0,
//   }),
//   active: {
//     x: 0,
//     opacity: 1,
//     transition: { delay: 0.2 },
//   },
//   exit: (direction: number) => ({
//     x: direction > 0 ? -xOffset : xOffset,
//     opacity: 0,
//   }),
// };

// // Dot Component
// function Dot({ isSelected, onClick }) {
//   return (
//     <div className="dot-container" onClick={onClick}>
//       <div className="dot">
//         {isSelected && (
//           <motion.div className="dot-highlight" layoutId="highlight" />
//         )}
//       </div>
//     </div>
//   );
// }

// // Pagination Component
// function Pagination({ items, currentPage, setPage }) {
//   return (
//     <AnimateSharedLayout>
//       <div className="dots">
//         {items.map((item: any, index: React.Key | null | undefined) => (
//           <Dot
//             key={index}
//             onClick={() => setPage(index)}
//             isSelected={index === currentPage}
//           />
//         ))}
//       </div>
//     </AnimateSharedLayout>
//   );
// }

// // Slides Component
// function Slides({ items, currentPage, setPage, direction }) {
//   const hasPaginated = useRef(false);

//   function detectPaginationGesture(e: any, { offset }: any) {
//     if (hasPaginated.current) return;
//     let newPage = currentPage;
//     const threshold = xOffset / 2;

//     if (offset.x < -threshold) {
//       newPage = currentPage + 1;
//     } else if (offset.x > threshold) {
//       newPage = currentPage - 1;
//     }

//     if (newPage !== currentPage) {
//       hasPaginated.current = true;
//       newPage = wrap(0, items.length, newPage);
//       setPage(newPage);
//     }
//   }

//   return (
//     <div className="slider-container">
//       <AnimatePresence initial={false} custom={direction}>
//         <motion.div
//           key={currentPage}
//           className="slide"
//           data-page={currentPage}
//           variants={variants}
//           initial="enter"
//           animate="active"
//           exit="exit"
//           drag="x"
//           onDrag={detectPaginationGesture}
//           onDragStart={() => (hasPaginated.current = false)}
//           onDragEnd={() => (hasPaginated.current = true)}
//           dragConstraints={{ left: 0, right: 0 }}
//           custom={direction}
//         >
//           <CaseItem
//             title={items[currentPage].title}
//             description={items[currentPage].description}
//             imageSource={items[currentPage].imageSource}
//           />
//         </motion.div>
//       </AnimatePresence>
//     </div>
//   );
// }

// // Main Carousel Component
// export default function CaseCarousel() {
//   const [items, setItems] = useState(/* Retrieve your items here */);
//   const [[currentPage, direction], setCurrentPage] = useState([0, 0]);

//   function setPage(newPage: number) {
//     const newDirection = newPage - currentPage;
//     setCurrentPage([newPage, newDirection]);
//   }

//   return (
//     <>
//       <Slides
//         items={items}
//         currentPage={currentPage}
//         setPage={setPage}
//         direction={direction}
//       />
//       <Pagination items={items} currentPage={currentPage} setPage={setPage} />
//     </>
//   );
// }
import React, { useMemo } from 'react';
import { useState, useRef } from 'react';
import {
  motion,
  AnimatePresence,
  AnimateSharedLayout,
  LayoutGroup,
} from 'framer-motion';
import { wrap } from '@popmotion/popcorn';
import AnimatedFadeInContainer from './Layouts/AnimatedFadeInContainer';
import { ProjectsAndCases } from 'src/types/DBTypes';
import useProjectsAndCasesQuery from '../hooks/useProjectsAndCasesQuery';
import CaseItem from './CaseItem';

function Dot({
  isSelected,
  onClick,
}: {
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <div className="p-5 cursor-pointer" onClick={onClick}>
      <div className="w-2.5 h-2.5 bg-white bg-opacity-50 rounded-full relative">
        {isSelected && (
          <motion.div
            className="absolute w-3.5 h-3.5 bg-white rounded-full top-[-0.5] left-[-0.5]"
            layoutId="highlight"
          />
        )}
      </div>
    </div>
  );
}

function Pagination({
  currentPage,
  setPage,
  items,
}: {
  currentPage: number;
  setPage: (number: number) => void;
  items: ProjectsAndCases[];
}) {
  return (
    <div className="flex justify-center mt-7.5">
      <LayoutGroup>
        {items.map((page, index) => (
          <Dot
            // eslint-disable-next-line no-underscore-dangle
            key={`${page._id}`}
            onClick={() => setPage(index)}
            isSelected={index === currentPage}
          />
        ))}
      </LayoutGroup>
    </div>
  );
}
const xOffset = 100;
const variants = {
  enter: (direction: number) => ({
    x: direction > 0 ? xOffset : -xOffset,
    opacity: 0,
  }),
  active: {
    x: 0,
    opacity: 1,
    transition: { delay: 0.2 },
  },
  exit: (direction: number) => ({
    x: direction > 0 ? -xOffset : xOffset,
    opacity: 0,
  }),
};

function Slides({
  currentPage,
  setPage,
  direction,
  items,
}: {
  currentPage: number;
  setPage: (number: number, direction?: number) => void;
  direction: number;
  items: ProjectsAndCases[];
}) {
  const hasPaginated = useRef(false);

  function detectPaginationGesture(e: any, { offset }: { offset: any }) {
    if (hasPaginated.current) return;
    let newPage = currentPage;

    if (offset.x < -xOffset / 2) {
      newPage = currentPage + 1;
    } else if (offset.x > xOffset / 2) {
      newPage = currentPage - 1;
    }

    if (newPage !== currentPage) {
      hasPaginated.current = true;
      newPage = wrap(0, items.length, newPage);
      setPage(newPage, offset.x < 0 ? 1 : -1);
    }
  }

  function handlePagination(type: 'next' | 'prev') {
    let newPage = currentPage;

    if (type === 'next' && currentPage < items.length - 1) {
      newPage = currentPage + 1;
    } else if (type === 'prev' && currentPage > 0) {
      newPage = currentPage - 1;
    }

    if (newPage !== currentPage) {
      setPage(newPage, type === 'next' ? 1 : -1);
    }
  }

  return (
    <AnimatedFadeInContainer className="h-full align-center justify-center self-center flex">
      <div className="relative h-full flex justify-center w-full md:w-5/6 items-center overflow-hidden dark:bg-gray-900  bg-gray-200">
        <AnimatePresence initial={false} custom={direction}>
          <motion.div
            key={currentPage}
            className="w-full lg:top-20 top-0 absolute"
            data-page={currentPage}
            variants={variants}
            initial="enter"
            animate="active"
            exit="exit"
            drag="x"
            onDrag={detectPaginationGesture}
            onDragStart={() => (hasPaginated.current = false)}
            onDragEnd={() => (hasPaginated.current = true)}
            dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
            custom={direction}
          >
            <CaseItem
              title={items[currentPage].title}
              description={items[currentPage].description}
              imageSource={items[currentPage].imageSource}
            />
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="absolute bottom-16 xl:bottom-24  w-full z-50 flex items-center justify-center ">
        <div className="justify-between flex items-center ">
          <div className="flex flex-col items-center">
            <span className="text-sm text-gray-700 dark:text-gray-400">
              Showing{' '}
              <span className="font-semibold text-gray-900 dark:text-white">
                {currentPage + 1}
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
                className={`
                ${currentPage === 0 && 'opacity-50 cursor-not-allowed'}
                inline-flex items-center px-4 py-2 text-sm font-medium text-white
                bg-gray-800 border-0 border-l border-gray-700 rounded-l hover:bg-gray-900 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-white`}
              >
                <svg
                  aria-hidden="true"
                  className="w-5 h-5 mr-2"
                  aria-label="previous"
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
                className={`
                ${
                  currentPage === items.length - 1 &&
                  'opacity-50 cursor-not-allowed'
                }
                inline-flex items-center px-4 py-2 text-sm font-medium text-white
                bg-gray-800 border-0 border-l border-gray-700 rounded-r hover:bg-gray-900 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-white`}
              >
                Next
                <svg
                  aria-hidden="true"
                  className="w-5 h-5 ml-2"
                  fill="currentColor"
                  aria-label="Next"
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

export default function CaseCarousel() {
  const [[currentPage, direction], setCurrentPage] = useState<[number, number]>(
    [0, 0],
  );
  const { data, isLoading } = useProjectsAndCasesQuery();
  const items = useMemo(() => {
    if (!data) return [];
    return data?.filter((item: ProjectsAndCases) => item != null);
  }, [data]);

  function setPage(newPage: number, newDirection?: number) {
    if (!newDirection) newDirection = newPage - currentPage;
    setCurrentPage([newPage, newDirection]);
  }

  return (
    <>
      {isLoading ? (
        <></>
      ) : (
        <>
          <Slides
            currentPage={currentPage}
            direction={direction}
            setPage={setPage}
            items={items}
          />
          <Pagination
            currentPage={currentPage}
            items={items}
            setPage={setPage}
          />
        </>
      )}
    </>
  );
}
