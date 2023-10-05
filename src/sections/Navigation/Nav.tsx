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
      { id: 2, text: 'Frameworks', path: '/frameworks' },
      { id: 3, text: 'Experience', path: '/experience' },
      { id: 4, text: 'Contact', path: '/contact' },
    ];
  }, []);

  return (
    <div className="relative h-screen w-full overflow-y-auto">
      <motion.ul
        variants={variants}
        className="p-6 m-0 top-2/4 right-0 w-full lg:w-3/4 sm:top-0 md:top-1/4 lg:top-24 justify-end flex-col flex "
      >
        {Items.map((item) => (
          <NavMenuItem {...item} key={item.text} toggleIsOpen={toggleIsOpen} />
        ))}
      </motion.ul>
    </div>
  );
};

export default Navigation;
