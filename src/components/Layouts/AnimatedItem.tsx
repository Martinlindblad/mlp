import { HTMLMotionProps, motion, Variants } from 'framer-motion';
import { Props } from 'next/script';

type ItemVariantProp = {
  itemVariant: Variants | undefined;
  containerProps?: HTMLMotionProps<'div'>;
};

const AnimatedStaggerItem: React.FC<Props & ItemVariantProp> = ({
  children,
  className,
  itemVariant,
  containerProps,
}) => {
  return (
    <motion.div
      className={className}
      variants={itemVariant}
      {...containerProps}
    >
      {children}
    </motion.div>
  );
};
export default AnimatedStaggerItem;
