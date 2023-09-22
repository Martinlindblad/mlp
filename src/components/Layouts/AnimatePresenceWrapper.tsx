import { AnimatePresence } from 'framer-motion';
import React from 'react';

const AnimatedPreseceWrapper = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  return (
    <AnimatePresence mode="wait" initial={false}>
      {children}
    </AnimatePresence>
  );
};
export default AnimatedPreseceWrapper;
