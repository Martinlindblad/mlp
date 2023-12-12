import { HTMLMotionProps, motion, Variants } from 'framer-motion';

type AnimatedStaggerItemProps = {
  itemVariant?: Variants;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onTouchStart?: () => void;
  onTouchEnd?: () => void;
  whileHover?: HTMLMotionProps<'div'>['whileHover'];
  className?: string;
  children: React.ReactNode;
  rest?: HTMLMotionProps<'div'>;
};

const AnimatedStaggerItem: React.FC<AnimatedStaggerItemProps> = ({
  children,
  className,
  itemVariant,
  onMouseEnter,
  onTouchStart,
  onTouchEnd,
  onMouseLeave,
  whileHover,
  rest,
}) => {
  return (
    <motion.div
      className={className}
      variants={itemVariant}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      whileHover={whileHover}
      {...rest}
    >
      {children}
    </motion.div>
  );
};

export default AnimatedStaggerItem;
