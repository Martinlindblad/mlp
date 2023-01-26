import * as React from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';

const variants = {
  open: {
    y: 0,
    opacity: 1,
    transition: {
      y: { stiffness: 1000, velocity: -100 },
    },
  },
  closed: {
    y: 50,
    opacity: 0,
    transition: {
      y: { stiffness: 1000 },
    },
  },
};

const colors = ['#fef6e4', '#f582ae', '#8bd3dd', '#b8c1ec', '#ff8906'];

export const NavMenuItem = ({
  id,
  text,
  icon,
  path,
}: {
  id: number;
  text: string;
  icon: string;
  path: string;
}) => {
  const style = { border: `3px solid ${colors[id]}` };
  return (
    <motion.li
      className="items-end justify-end list-none mb-5 flex pr-14 cursor-pointer lg:w-3/6 lg:self-end"
      variants={variants}
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.95 }}
    >
      <div
        className="w-10 h-10 rounded-3xl flex items-center justify-center mr-6 "
        style={style}
      >
        <span className="icon">{icon}</span>
      </div>

      <Link
        className="p-3 flex-1  justify-center flex rounded-full"
        style={style}
        href={path}
      >
        <span>{text}</span>
      </Link>
    </motion.li>
  );
};
