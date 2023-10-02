import { HTMLMotionProps, motion, Variants } from 'framer-motion';

type AnimatedStaggerItemProps = {
  itemVariant?: Variants;
  whileHover?: HTMLMotionProps<'div'>['whileHover'];
  className?: string;
  children: React.ReactNode;
};

const AnimatedStaggerItem: React.FC<AnimatedStaggerItemProps> = ({
  children,
  className,
  itemVariant,
  whileHover,
}) => {
  return (
    <motion.div
      className={className}
      variants={itemVariant}
      whileHover={whileHover}
    >
      {children}
    </motion.div>
  );
};

export default AnimatedStaggerItem;
