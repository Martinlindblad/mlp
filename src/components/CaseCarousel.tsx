import React, { useState, useRef } from 'react';
import { motion, AnimatePresence, AnimateSharedLayout } from 'framer-motion';
import { wrap } from '@popmotion/popcorn';
import CaseItem from './CaseItem';

// Constants
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

// Dot Component
function Dot({ isSelected, onClick }) {
  return (
    <div className="dot-container" onClick={onClick}>
      <div className="dot">
        {isSelected && (
          <motion.div className="dot-highlight" layoutId="highlight" />
        )}
      </div>
    </div>
  );
}

// Pagination Component
function Pagination({ items, currentPage, setPage }) {
  return (
    <AnimateSharedLayout>
      <div className="dots">
        {items.map((item: any, index: React.Key | null | undefined) => (
          <Dot
            key={index}
            onClick={() => setPage(index)}
            isSelected={index === currentPage}
          />
        ))}
      </div>
    </AnimateSharedLayout>
  );
}

// Slides Component
function Slides({ items, currentPage, setPage, direction }) {
  const hasPaginated = useRef(false);

  function detectPaginationGesture(e: any, { offset }: any) {
    if (hasPaginated.current) return;
    let newPage = currentPage;
    const threshold = xOffset / 2;

    if (offset.x < -threshold) {
      newPage = currentPage + 1;
    } else if (offset.x > threshold) {
      newPage = currentPage - 1;
    }

    if (newPage !== currentPage) {
      hasPaginated.current = true;
      newPage = wrap(0, items.length, newPage);
      setPage(newPage);
    }
  }

  return (
    <div className="slider-container">
      <AnimatePresence initial={false} custom={direction}>
        <motion.div
          key={currentPage}
          className="slide"
          data-page={currentPage}
          variants={variants}
          initial="enter"
          animate="active"
          exit="exit"
          drag="x"
          onDrag={detectPaginationGesture}
          onDragStart={() => (hasPaginated.current = false)}
          onDragEnd={() => (hasPaginated.current = true)}
          dragConstraints={{ left: 0, right: 0 }}
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
  );
}

// Main Carousel Component
export default function CaseCarousel() {
  const [items, setItems] = useState(/* Retrieve your items here */);
  const [[currentPage, direction], setCurrentPage] = useState([0, 0]);

  function setPage(newPage: number) {
    const newDirection = newPage - currentPage;
    setCurrentPage([newPage, newDirection]);
  }

  return (
    <>
      <Slides
        items={items}
        currentPage={currentPage}
        setPage={setPage}
        direction={direction}
      />
      <Pagination items={items} currentPage={currentPage} setPage={setPage} />
    </>
  );
}
