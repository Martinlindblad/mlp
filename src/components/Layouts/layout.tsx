import { motion } from 'framer-motion';
import { Props } from 'next/script';

const Layout: React.FC<Props> = ({ children, className }) => {
  return (
    <motion.div
      className={className}
      initial={{ x: 300, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 300, opacity: 0 }}
      transition={{
        type: 'spring',
        stiffness: 260,
        damping: 25,
      }}
    >
      {children}
    </motion.div>
  );
};
export default Layout;
