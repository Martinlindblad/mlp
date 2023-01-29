import { motion, useCycle } from 'framer-motion';
import ThemeButton from 'src/components/themeButton';
import { Navigation } from './Nav';
import { MenuToggle } from './Toggle';

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
    <>
      <motion.nav
        initial={false}
        animate={isOpen ? 'open' : 'closed'}
        className={`fixed top-0 right-0 bottom-0 w-full  ${
          isOpen ? 'z-50' : '-z-10'
        }`}
      >
        <motion.div
          className="absolute top-0 right-0 bottom-0 w-full rounded-sm gradientContainer animate-[gradient_16s_ease-in-out_infinite] opacity-90"
          variants={sidebar}
        />
        <div className={`${isOpen ? '' : 'pointer-events-none'}`}>
          <Navigation isOpen />
        </div>
      </motion.nav>
      <ThemeButton incomingClassName="absolute scale-100 top-6 z-50 p-2 left-12  justify-center items-center bottom-0 w-full " />
      <MenuToggle isOpen={isOpen} toggle={() => toggleOpen()} />
    </>
  );
}
