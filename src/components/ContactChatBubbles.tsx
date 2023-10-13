import React, { useEffect, useMemo } from 'react';
import { motion, useAnimation } from 'framer-motion';

const ChatBubble = ({ text, index }: { text: string; index: number }) => {
  const controls = useAnimation();

  useEffect(() => {
    void controls.start({
      y: ['-5%', '5%', '-5%'],
      transition: {
        y: {
          repeat: Infinity,
          duration: 2,
          delay: index * 0.2,
          ease: 'easeInOut',
        },
      },
    });
  }, [controls, index]);

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
    <motion.div className="relative group" variants={itemVariant}>
      <motion.div
        animate={controls}
        className="py-2 sm:py-4 m-2 sm:m-4 w-3/4 sm:w-full flex justify-center items-center bg-white text-black sm:text-xl rounded-full shadow-md"
      >
        <p className="py-1 sm:py-2 px-3 sm:px-6 text-center whitespace-nowrap">
          {text}
        </p>
      </motion.div>
    </motion.div>
  );
};

const ChatBubbles = () => {
  return (
    <motion.div className="flex flex-col sm:flex-row rounded-lg items-center space-y-4 sm:space-x-4 absolute top-1/4 sm:top-32 left-1/4 sm:left-72">
      <div className="self-start sm:absolute sm:top-12">
        <ChatBubble text="Hey there! 🌟" index={0} />
      </div>
      <div className="self-center sm:absolute sm:left-48 sm:top-44">
        <ChatBubble text="Isn't it a lovely day? ☀️" index={1} />
      </div>
      <div className="self-end sm:absolute sm:-left-32 sm:top-72 sm:mt-6">
        <ChatBubble text="Animations make it even better! 🚀" index={2} />
      </div>
    </motion.div>
  );
};

export default ChatBubbles;
