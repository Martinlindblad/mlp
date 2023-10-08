import React, { useEffect } from 'react';
import { motion, useAnimation } from 'framer-motion';

const ChatBubble = ({ text }) => {
  const controls = useAnimation();

  useEffect(() => {
    void controls.start({
      y: ['-5%', '5%', '-5%'],
      transition: {
        y: {
          repeat: Infinity,
          duration: 2,
          ease: 'easeInOut',
        },
      },
    });
  }, [controls]);

  return (
    <div className="relative group">
      <motion.div
        animate={controls}
        className="max-w-lg px-6 py-3 m-4 bg-white text-black text-xl rounded-full shadow-md"
      >
        {text}
      </motion.div>
      <div className="absolute left-1/2 h-2 w-1/6 bg-black mt-2 transform -translate-x-1/2 group-hover:scale-x-110 transition-transform"></div>
    </div>
  );
};

const ChatBubbles = () => {
  return (
    <div className="flex flex-row rounded-lg items-center space-x-4 absolute top-0">
      <ChatBubble text="Hello there!" />
      <div style={{ animationDelay: '0.5s' }}>
        <ChatBubble text="How's it going?" />
      </div>
      <div style={{ animationDelay: '1s' }}>
        <ChatBubble text="Just trying out some animations!" />
      </div>
    </div>
  );
};

export default ChatBubbles;
