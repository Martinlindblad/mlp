import { motion } from 'framer-motion';
import React, { useMemo } from 'react';

const ContactMe = () => {
  const texts = ['Reach', 'Out', 'To Me'];

  const Item = ({ text, index }: { text: string; index: number }) => {
    const itemVariant = useMemo(
      () => ({
        hidden: {
          opacity: 0,
          scale: 0.75,
        },
        visible: {
          opacity: 1,
          scale: 1,
          transition: {
            delay: index * 0.4,
            duration: 0.4,
            ease: 'easeInOut',
          },
        },
        exit: {
          scale: 0.75,
          opacity: 0,
        },
      }),
      [index],
    );

    return (
      <motion.div
        variants={itemVariant}
        initial="hidden"
        animate="visible"
        exit="exit"
      >
        <h1
          className={
            index !== 1
              ? `hover:text-[#0ea5e9] font-black hover:scale-105 text-9xl transition-all duration-300 ease-in-out transform`
              : `font-black hover:scale-105 text-9xl transition-all duration-300 ease-in-out transform text-[#0ea5e9] hover:text-[#e94e77]`
          }
        >
          {text}
        </h1>
      </motion.div>
    );
  };

  return (
    <div className="h-full relative pt-6">
      {texts.map((text, index) => (
        <Item key={text} text={text} index={index} />
      ))}
    </div>
  );
};

export default ContactMe;
