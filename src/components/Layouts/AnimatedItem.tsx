import { motion, Variants } from 'framer-motion';
import { Props } from 'next/script';

type ItemVariantProp = {
  itemVariant: Variants | undefined;
};

const AnimatedStaggerItem: React.FC<Props & ItemVariantProp> = ({
  children,
  className,
  itemVariant,
}) => {
  return (
    <motion.div className={className} variants={itemVariant}>
      {children}
    </motion.div>
  );
};
export default AnimatedStaggerItem;
