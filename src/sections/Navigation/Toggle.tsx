import { Cycle, motion } from 'framer-motion';
import { useTheme } from 'next-themes';
import React from 'react';

interface MenuToggleProps {
  toggle: Cycle;
  isOpen: boolean;
}

const MenuToggle: React.FC<MenuToggleProps> = ({ toggle, isOpen }) => {
  const { theme } = useTheme();
  return (
    <motion.button
      onClick={() => toggle()}
      whileHover={{
        transition: { duration: 0.2 },
        // Add glow effect with box-shadow and blur
        boxShadow:
          theme === 'dark'
            ? '0 0 0 1px rgba(255, 255, 255, 0.7)'
            : '0 0 0 1px rgba(0, 0, 0, 0.7)',
        borderRadius: '100%',
      }}
      role="button"
      className="outline-none cursor-pointer fixed top-5 right-10 h-14 rounded-full bg-transparent z-50 p-4 dark:gradientContainerDarkMode gradientContainer animate-[gradient_16s_ease-in-out_infinite]"
    >
      <div className="relative">
        <svg
          className={`${
            isOpen ? 'scale-100' : 'scale-0'
          } w-6 h-6 ease-in-out duration-100 absolute`}
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M6 18L18 6M6 6l12 12"
            strokeLinecap="round"
            strokeLinejoin="round"
          ></path>
        </svg>
        <svg
          className={`${
            isOpen ? 'scale-0' : 'scale-100'
          } w-6 h-6 ease-in-out duration-500`}
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M3.75 5.25h16.5m-16.5 4.5h16.5m-16.5 4.5h16.5m-16.5 4.5h16.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          ></path>
        </svg>
      </div>
    </motion.button>
  );
};

export default MenuToggle;
