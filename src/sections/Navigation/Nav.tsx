import React, { useMemo } from 'react';
import { Cycle, motion } from 'framer-motion';
import dynamic from 'next/dynamic';

// Dynamic import
const NavMenuItem = dynamic(() => import('./NavMenuItem'));

interface Item {
  id: number;
  text: string;
  path: string;
}

interface NavigationProps {
  toggleIsOpen: Cycle;
}

const variants = {
  open: {
    transition: { staggerChildren: 0.07, delayChildren: 0.2 },
  },
  closed: {
    transition: { staggerChildren: 0.05, staggerDirection: -1 },
  },
};

const Navigation: React.FC<NavigationProps> = ({ toggleIsOpen }) => {
  const Items: Item[] = useMemo(() => {
    return [
      { id: 0, text: 'Home', path: '/' },
      { id: 1, text: 'About', path: '/about' },
      { id: 2, text: 'Experience', path: '/experience' },
      { id: 3, text: 'Contact', path: '/contact' },
    ];
  }, []);

  return (
    <motion.ul
      variants={variants}
      className="m-0 absolute top-40 right-0 lg:w-1/4 w-full sm:top-10 lg:top-1/4 rounded-l-md justify-end flex-col flex  overflow-hidden"
    >
      {Items.map((item) => (
        <NavMenuItem {...item} key={item.text} toggleIsOpen={toggleIsOpen} />
      ))}
    </motion.ul>
  );
};

export default Navigation;
