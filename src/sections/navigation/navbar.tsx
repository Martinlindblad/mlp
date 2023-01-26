/* eslint-disable jsx-a11y/anchor-is-valid */
import { motion, useCycle } from 'framer-motion';
import { Navigation } from './Nav';
import { MenuToggle } from './Toggle';

export default function Navbar() {
  const sidebar = {
    open: (height = 1000) => ({
      clipPath: `circle(${height * 2 + 200}px at 96.45vw 50px)`,
      transition: {
        type: 'spring',
        stiffness: 20,
        restDelta: 2,
      },
    }),
    closed: {
      clipPath: `circle(30px at 96.45vw 50px)`,
      transition: {
        delay: 0.5,
        type: 'spring',
        stiffness: 400,
        damping: 40,
      },
    },
  };
  const [isOpen, toggleOpen] = useCycle(false, true);
  return (
    <motion.nav
      initial={false}
      animate={isOpen ? 'open' : 'closed'}
      custom="100%"
      className={`fixed top-0 right-0 bottom-0 w-full z-50 `}
    >
      <motion.div
        className="absolute top-0 right-0 bottom-0 w-full rounded-sm gradientContainer animate-[gradient_16s_ease-in-out_infinite] opacity-90"
        variants={sidebar}
      />
      <Navigation />
      <MenuToggle toggle={() => toggleOpen()} />
    </motion.nav>
  );
}
