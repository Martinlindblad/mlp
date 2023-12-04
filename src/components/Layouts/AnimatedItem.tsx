import { HTMLMotionProps, motion, Variants } from 'framer-motion';

type AnimatedStaggerItemProps = {
  itemVariant?: Variants;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  className?: string;
  children: React.ReactNode;
  rest?: HTMLMotionProps<'div'>;
};

const AnimatedStaggerItem: React.FC<AnimatedStaggerItemProps> = ({
  children,
  className,
  itemVariant,
  onMouseEnter,
  onMouseLeave,
  rest,
}) => {
  return (
    <motion.div
      className={className}
      variants={itemVariant}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      {...rest}
    >
      {children}
    </motion.div>
  );
};

export default AnimatedStaggerItem;
