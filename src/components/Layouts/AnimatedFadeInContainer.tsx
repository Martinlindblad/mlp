import { motion, useInView } from 'framer-motion';
import { Props } from 'next/script';
import { useMemo, useRef } from 'react';

const AnimatedFadeInContainer: React.FC<Props> = ({
  children,
  className,
  type,
}) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const isInView = useInView(ref);

  const container = useMemo(() => {
    const transitionInitialValue = () => {
      switch (type) {
        case 'FadeInLeft':
          return { x: -200 };
        case 'FadeInRight':
          return { x: 300 };
        case 'FadeInTop':
          return { y: -300 };
        case 'FadeInBottom':
          return { y: 200 };
        default:
          return { x: 0, y: 0 };
      }
    };
    const InitialValue = transitionInitialValue();
    return {
      hidden: {
        opacity: 0,
        scale: 0,
        ...InitialValue,
      },
      visible: {
        opacity: 1,
        scale: 1,
        y: 0,
        x: 0,
        transition: {
          delay: 0.2,
          duration: 0.4,
        },
      },
    };
  }, [type]);

  switch (type) {
    case 'FadeInLeft':
      return (
        <motion.div
          ref={ref}
          layout
          className={className}
          initial="hidden"
          variants={container}
          animate={isInView ? 'visible' : 'hidden'}
        >
          {children}
        </motion.div>
      );
    case 'FadeInRight':
      return (
        <motion.div
          layout
          ref={ref}
          className={className}
          initial="hidden"
          variants={container}
          animate={isInView ? 'visible' : 'hidden'}
        >
          {children}
        </motion.div>
      );
    case 'FadeInTop':
      return (
        <motion.div
          layout
          variants={container}
          animate={isInView ? 'visible' : 'hidden'}
          ref={ref}
          className={className}
          initial="hidden"
        >
          {children}
        </motion.div>
      );
    case 'FadeInBottom':
      return (
        <motion.div
          layout
          variants={container}
          animate={isInView ? 'visible' : 'hidden'}
          ref={ref}
          className={className}
          initial="hidden"
        >
          {children}
        </motion.div>
      );

    default:
      return (
        <motion.div
          layout
          variants={container}
          animate={isInView ? 'visible' : 'hidden'}
          ref={ref}
          className={className}
          initial="hidden"
        >
          {children}
        </motion.div>
      );
  }
};
export default AnimatedFadeInContainer;
