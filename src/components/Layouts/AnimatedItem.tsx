import { HTMLMotionProps, motion, Variants } from 'framer-motion';

type AnimatedStaggerItemProps = {
  itemVariant?: Variants;
  whileHover?: HTMLMotionProps<'div'>['whileHover'];
  className?: string;
  children: React.ReactNode;
  rest?: HTMLMotionProps<'div'>;
};

const AnimatedStaggerItem: React.FC<AnimatedStaggerItemProps> = ({
  children,
  className,
  itemVariant,
  whileHover,
  rest,
}) => {
  return (
    <motion.div
      className={className}
      variants={itemVariant}
      whileHover={whileHover}
      {...rest}
    >
      {children}
    </motion.div>
  );
};

export default AnimatedStaggerItem;
