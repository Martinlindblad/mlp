import { motion, useInView, Variants } from 'framer-motion';
import { Props } from 'next/script';
import { useRef } from 'react';
import AnimatedPreseceWrapper from './AnimatePresenceWrapper';

type ContainerVariantProp = {
  containerVariant: Variants;
};

const AnimatedContainer: React.FC<Props & ContainerVariantProp> = ({
  children,
  className,
  containerVariant,
}) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const isInView = useInView(ref);

  return (
    <AnimatedPreseceWrapper>
      <motion.div
        ref={ref}
        className={className}
        variants={containerVariant}
        initial="hidden"
        animate={isInView ? 'visible' : 'hidden'}
      >
        {children}
      </motion.div>
    </AnimatedPreseceWrapper>
  );
};
export default AnimatedContainer;
