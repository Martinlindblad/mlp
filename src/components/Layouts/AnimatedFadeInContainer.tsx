import { HTMLMotionProps, motion, useInView } from 'framer-motion';
import { useMemo, useRef } from 'react';
import { FadeInAnimationType } from 'src/types/Animations';
import AnimatedPreseceWrapper from './AnimatePresenceWrapper';

type ContainerType = {
  type?: FadeInAnimationType;
  transition?: number;
  delay?: number;
  onClick?: () => void;
  onMouseEnter?: HTMLMotionProps<'div'>['onMouseEnter'];
  onMouseLeave?: HTMLMotionProps<'div'>['onMouseLeave'];
  whileHover?: HTMLMotionProps<'div'>['whileHover'];
  className?: string;
  children: React.ReactNode;
  styleProp?: React.CSSProperties;
};

const AnimatedFadeInContainer = ({
  children,
  className,
  type,
  transition = 0.5,
  delay = 0.6,
  onClick,
  onMouseEnter,
  onMouseLeave,
  whileHover,
  styleProp,
}: ContainerType) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const isInView = useInView(ref);

  const container = useMemo(() => {
    const transitionInitialValue = () => {
      switch (type) {
        case 'FadeInLeft':
          return { x: -70 };
        case 'FadeInRight':
          return { x: 70 };
        case 'FadeInTop':
          return { y: -70 };
        case 'FadeInBottom':
          return { y: 70 };
        default:
          return { x: 0, y: 0 };
      }
    };

    const InitialValue = transitionInitialValue();

    const finalPosition = {
      x: type === 'FadeInLeft' || type === 'FadeInRight' ? 0 : undefined,
      y: type === 'FadeInTop' || type === 'FadeInBottom' ? 0 : undefined,
    };

    return {
      hidden: {
        opacity: 0,
        scale: 0.95,
        ...InitialValue,
      },
      visible: {
        opacity: 1,
        scale: 1,
        ...finalPosition,
        transition: {
          delay: delay,
          duration: transition,
        },
      },
    };
  }, [type, delay, transition]);

  const renderAnimation = () => {
    switch (type) {
      case 'Cancel':
        return (
          <motion.div
            style={styleProp}
            layout
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            onClick={onClick}
            whileHover={whileHover}
            ref={ref}
            className={className}
            initial="hidden"
          >
            {children}
          </motion.div>
        );
      case 'FadeInLeft':
      case 'FadeInRight':
      case 'FadeInTop':
      case 'FadeInBottom':
      default:
        return (
          <motion.div
            style={styleProp}
            layout
            variants={container}
            animate={isInView ? 'visible' : 'hidden'}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            onClick={onClick}
            whileHover={whileHover}
            ref={ref}
            className={className}
            initial="hidden"
          >
            {children}
          </motion.div>
        );
    }
  };

  return <AnimatedPreseceWrapper>{renderAnimation()}</AnimatedPreseceWrapper>;
};

export default AnimatedFadeInContainer;
