import * as React from 'react';
import { motion } from 'framer-motion';
import { NavMenuItem } from './NavMenuItem';
import { useMemo } from 'react';

const variants = {
  open: {
    transition: { staggerChildren: 0.07, delayChildren: 0.2 },
  },
  closed: {
    transition: { staggerChildren: 0.05, staggerDirection: -1 },
  },
};

export const Navigation = () => {
  const Items = useMemo(() => {
    return [
      {
        icon: '🏠',
        id: 0,
        text: 'Home',
        path: '/',
      } as const,
      {
        icon: '🏠',
        id: 1,
        text: 'About',
        path: '/about',
      } as const,
      {
        icon: '🏠',
        id: 2,
        text: 'Frameworks',
        path: '/frameworks',
      } as const,
      {
        icon: '🏠',
        id: 3,
        text: 'Experience',
        path: '/experience',
      } as const,

      {
        icon: '🏠',
        id: 4,
        text: 'Contact',
        path: '/contact',
      } as const,
    ];
  }, []);
  return (
    <motion.ul
      variants={variants}
      className="p-6 m-0 absolute top-24 right-0 w-3/4  justify-end flex-col flex "
    >
      {Items.map((item) => (
        <NavMenuItem {...item} key={item.text} />
      ))}
    </motion.ul>
  );
};
