import { HTMLMotionProps, motion, Variants } from 'framer-motion';

type AnimatedStaggerItemProps = {
  itemVariant?: Variants;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  className?: string;
  children: React.ReactNode;
  rest?: HTMLMotionProps<'div'>;
  whileHover?: HTMLMotionProps<'div'>['whileHover'];
};

const AnimatedStaggerItem: React.FC<AnimatedStaggerItemProps> = ({
  children,
  className,
  itemVariant,
  onMouseEnter,
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
      whileHover={whileHover}
      {...rest}
    >
      {children}
    </motion.div>
  );
};

export default AnimatedStaggerItem;
