import { motion, Variants } from 'framer-motion';
import { Props } from 'next/script';

type ContainerVariantProp = {
  containerVariant: Variants | undefined;
};

const AnimatedContainer: React.FC<Props & ContainerVariantProp> = ({
  children,
  className,
  containerVariant,
}) => {
  return (
    <motion.div
      className={className}
      variants={containerVariant}
      initial="hidden"
      animate="visible"
    >
      {children}
    </motion.div>
  );
};
export default AnimatedContainer;
