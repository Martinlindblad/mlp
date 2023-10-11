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
        className="py-4 m-4 w-full flex justify-center items-center bg-white text-black text-xl rounded-full shadow-md"
      >
        <p className="py-2 px-6 text-center whitespace-nowrap">{text}</p>
      </motion.div>
    </motion.div>
  );
};

const ChatBubbles = () => {
  return (
    <motion.div className="flex flex-row rounded-lg items-center space-x-4 absolute top-32 left-72 ">
      <div className="absolute top-12 ">
        <ChatBubble text="Hey there! 🌟" index={0} />
      </div>
      <div className="absolute left-48 top-44 ">
        <ChatBubble text="Isn't it a lovely day? ☀️" index={1} />
      </div>
      <div className="absolute -left-32 top-72 mt-6">
        <ChatBubble text="Animations make it even better! 🚀" index={2} />
      </div>
    </motion.div>
  );
};

export default ChatBubbles;
