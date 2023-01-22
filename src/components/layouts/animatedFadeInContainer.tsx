import { motion } from 'framer-motion';
import { Props } from 'next/script';

const AnimatedFadeInContainer: React.FC<Props> = ({
  children,
  className,
  type,
}) => {
  switch (type) {
    case 'FadeInLeft':
      return (
        <motion.div
          className={className}
          initial={{ x: -100, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: -100, opacity: 0 }}
          transition={{
            type: 'spring',
            stiffness: 200,
            damping: 25,
          }}
        >
          {children}
        </motion.div>
      );
    case 'FadeInRight':
      return (
        <motion.div
          className={className}
          initial={{ x: 100, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 100, opacity: 0 }}
          transition={{
            type: 'spring',
            stiffness: 200,
            damping: 25,
          }}
        >
          {children}
        </motion.div>
      );
    case 'FadeInTop':
      return (
        <motion.div
          className={className}
          initial={{ y: -100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -100, opacity: 0 }}
          transition={{
            type: 'spring',
            stiffness: 200,
            damping: 25,
          }}
        >
          {children}
        </motion.div>
      );
    case 'FadeInBottom':
      return (
        <motion.div
          className={className}
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{
            type: 'spring',
            stiffness: 200,
            damping: 25,
          }}
        >
          {children}
        </motion.div>
      );

    default:
      return (
        <motion.div
          className={className}
          initial={{ x: 100, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 100, opacity: 0 }}
          transition={{
            type: 'spring',
            stiffness: 200,
            damping: 25,
          }}
        >
          {children}
        </motion.div>
      );
      break;
  }
};
export default AnimatedFadeInContainer;
