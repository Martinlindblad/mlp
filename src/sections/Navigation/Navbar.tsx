import { AnimatePresence, motion, useCycle } from 'framer-motion';
import { Navigation } from './Nav';
import { MenuToggle } from './Toggle';
import ThemeButton from 'src/src/components/ThemeButton';

export default function Navbar() {
  const sidebar = {
    open: (height = 1000) => ({
      clipPath: `circle(${height * 2 + 200}px at calc(100% - 4.25rem) 50px)`,
      transition: {
        type: 'spring',
        stiffness: 20,
        damping: 10,
        mass: 0.1,
        restDelta: 2,
      },
    }),
    closed: {
      clipPath: `circle(0px at calc(100% - 4.25rem) 50px)`,
      transition: {
        delay: 0.5,
        type: 'spring',
        stiffness: 400,
        damping: 40,
        mass: 0.1,
      },
    },
  };

  const [isOpen, toggleOpen] = useCycle(false, true);
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.nav
        key="nav"
        initial={false}
        animate={isOpen ? 'open' : 'closed'}
        className={`fixed top-0 right-0 bottom-0 w-full z-50 ${
          isOpen ? '' : 'pointer-events-none'
        }`}
      >
        <motion.div
          key="sidebar"
          className="absolute top-0 right-0 bottom-0 w-full rounded-sm dark:gradientContainerDarkMode gradientContainer animate-[gradient_16s_ease-in-out_infinite] opacity-90"
          variants={sidebar}
        />
        <div className={`${isOpen ? '' : 'pointer-events-none'}`}>
          <Navigation isOpen />
        </div>
      </motion.nav>

      <div className="outline-none cursor-pointer fixed top-5 left-10 h-14  rounded-full bg-transparent z-50">
        <div className="relative">
          <ThemeButton incomingClassName="" />
        </div>
      </div>
      <MenuToggle isOpen={isOpen} toggle={() => toggleOpen()} />
    </AnimatePresence>
  );
}
