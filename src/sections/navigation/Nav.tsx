import * as React from 'react';
import { motion } from 'framer-motion';
import { NavMenuItem } from './NavMenuItem';
import { useMemo } from 'react';
interface Item {
  id: number;
  text: string;
  path: string;
}
const variants = {
  open: {
    transition: { staggerChildren: 0.07, delayChildren: 0.2 },
  },
  closed: {
    transition: { staggerChildren: 0.05, staggerDirection: -1 },
  },
};

export const Navigation = () => {
  const Items: Item[] = useMemo(() => {
    return [
      {
        id: 0,
        text: 'Home',
        path: '/',
      },
      {
        id: 1,
        text: 'About',
        path: '/about',
      },
      {
        id: 2,
        text: 'Frameworks',
        path: '/frameworks',
      },
      {
        id: 3,
        text: 'Experience',
        path: '/experience',
      },

      {
        id: 4,
        text: 'Contact',
        path: '/contact',
      },
    ];
  }, []);
  return (
    <motion.ul
      variants={variants}
      className="p-6 m-0 absolute top-24 right-0 w-full lg:w-3/4  sm:scale-75 lg:scale-100 sm:top-10 lg:top-24 justify-end flex-col flex "
    >
      {Items.map((item) => (
        <NavMenuItem {...item} key={item.text} />
      ))}
    </motion.ul>
  );
};
