import React, { useCallback } from 'react';
import { Cycle, motion } from 'framer-motion';
import Link from 'next/link';
import AboutIcon from 'src/src/components/SVG/About';
import ContactIcon from 'src/src/components/SVG/Contact';
import ExperienceIcon from 'src/src/components/SVG/Experience';

import HomeIcon from 'src/src/components/SVG/Home';

interface NavMenuItemProps {
  id: number;
  text: string;
  path: string;
  toggleIsOpen: Cycle;
}

const variants = {
  open: {
    x: 0,
    opacity: 1,
    transition: {
      y: { stiffness: 1000, velocity: -100 },
      default: { duration: 0.2 },
    },
  },
  closed: {
    x: 300,
    opacity: 0,
    transition: {
      y: { stiffness: 1000 },
      default: { duration: 0.4 },
    },
  },
};

const colors = ['#f582ae', '#b8c1ec', '#8b78e6', '#6ab04c', '#f7d794'];

const NavMenuItem: React.FC<NavMenuItemProps> = ({
  id,
  text,
  path,
  toggleIsOpen,
}) => {
  const renderIcon = useCallback(() => {
    switch (text) {
      case 'Home':
        return <HomeIcon width="25px" height="25px" fill={colors[id]} />;
      case 'About':
        return <AboutIcon width="25px" height="25px" fill={colors[id]} />;

      case 'Experience':
        return <ExperienceIcon width="25px" height="25px" fill={colors[id]} />;
      case 'Contact':
        return <ContactIcon width="25px" height="25px" fill={colors[id]} />;
      default:
        return null;
    }
  }, [id, text]);

  return (
    <Link href={path} onClick={toggleIsOpen as any}>
      <motion.li
        className={` items-center justify-center w-full list-none flex
       cursor-pointer lg:self-end shadow-xl hover:shadow-xl transition-shadow duration-300  `}
        variants={variants}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
      >
        <div className="w-12 h-12 rounded-3xl flex items-center justify-center mr-6 shadow-md">
          {renderIcon()}
        </div>
        <div className="p-3 justify-center rounded-full">
          <h2 className="p-3 flex-1 lg:w-60 w-40 justify-center flex rounded-full text-white hover:text-gray-200 transition-colors duration-300">
            {text}
          </h2>
        </div>
      </motion.li>
    </Link>
  );
};

export default NavMenuItem;
