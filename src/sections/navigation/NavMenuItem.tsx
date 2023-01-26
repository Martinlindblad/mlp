import * as React from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import ExperienceIcon from 'src/components/SVG/Experience';
import HomeIcon from 'src/components/SVG/Home';
import AboutIcon from 'src/components/SVG/About';
import FrameworksIcon from 'src/components/SVG/Frameworks';
import ContactIcon from 'src/components/SVG/Contact';

interface NavMenuItemProps {
  id: number;
  text: string;
  path: string;
}

const variants = {
  open: {
    y: 0,
    opacity: 1,
    transition: {
      y: { stiffness: 1000, velocity: -100 },
      default: { duration: 0.2 },
    },
  },
  closed: {
    y: 50,
    opacity: 0,
    transition: {
      y: { stiffness: 1000 },
      default: { duration: 0.2 },
    },
  },
};

const colors = ['#f582ae', '#b8c1ec', '#8b78e6', '#6ab04c', '#f7d794'];

export const NavMenuItem: React.FC<NavMenuItemProps> = ({ id, text, path }) => {
  const renderIcon = React.useCallback(() => {
    switch (text) {
      case 'Home':
        return <HomeIcon width="25px" height="25px" fill={colors[id]} />;
      case 'About':
        return <AboutIcon width="25px" height="25px" fill={colors[id]} />;
      case 'Frameworks':
        return <FrameworksIcon width="25px" height="25px" fill={colors[id]} />;
      case 'Experience':
        return <ExperienceIcon width="25px" height="25px" fill={colors[id]} />;
      case 'Contact':
        return <ContactIcon width="25px" height="25px" fill={colors[id]} />;

      default:
        return null;
    }
  }, [id, text]);

  const style = { border: `3px solid ${colors[id]}` };
  return (
    <motion.li
      className="items-end justify-end list-none mb-5 flex pr-14 cursor-pointer lg:w-3/6  lg:self-end"
      variants={variants}
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.95 }}
    >
      <div
        className="w-12 h-12 rounded-3xl flex items-center justify-center mr-6 "
        style={style}
      >
        {renderIcon()}
      </div>

      <Link
        className="p-3 flex-1  justify-center flex rounded-full"
        style={style}
        href={path}
      >
        <h2>{text}</h2>
      </Link>
    </motion.li>
  );
};
