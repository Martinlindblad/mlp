import * as React from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import AboutIcon from 'src/src/components/SVG/About';
import ContactIcon from 'src/src/components/SVG/Contact';
import ExperienceIcon from 'src/src/components/SVG/Experience';
import FrameworksIcon from 'src/src/components/SVG/Frameworks';
import HomeIcon from 'src/src/components/SVG/Home';

interface NavMenuItemProps {
  id: number;
  text: string;
  path: string;
  toggleIsOpen: React.MouseEventHandler<HTMLButtonElement> | undefined;
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

export const NavMenuItem: React.FC<NavMenuItemProps> = ({
  id,
  text,
  path,
  toggleIsOpen,
}) => {
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
      className="items-end justify-end list-none mb-5 flex pr-14 cursor-pointer lg:w-3/6  lg:self-end "
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

      <button
        className="p-3 flex-1  justify-center flex rounded-full"
        onClick={toggleIsOpen}
      >
        <Link
          style={style}
          href={path}
          className="p-3 flex-1  justify-center flex rounded-full"
        >
          <h2>{text}</h2>
        </Link>
      </button>
    </motion.li>
  );
};
