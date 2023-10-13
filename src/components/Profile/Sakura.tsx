import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

const sakuraAnimation = {
  hidden: {
    boxShadow: '0 0 10px #fff, 0 0 20px  #ffb7c5',
    top: '0%',
    opacity: 1,
  },
  show: {
    boxShadow: '0 0 20px #fff, 0 0 30px #ffb7c5',
    top: '100%',
    x: '-400px',
    rotate: 180,
    transition: {
      duration: 12,
      ease: 'easeIn',
    },
  },
};

const Sakura = () => {
  const [sakura, setSakura] = useState<boolean>(false);

  const sakuraFall = () => {
    setSakura(Math.random() >= 0.5);
  };

  useEffect(() => {
    const interval = setInterval(sakuraFall, 38000);

    return () => {
      clearInterval(interval);
    };
  }, []);

  const numRand = Array.from({ length: 60 }, () =>
    Math.floor(Math.random() * 60).toString(),
  );

  return (
    <section
      key={String(sakura)}
      className="w-full absolute top-[-5%] bottom-0 z-[-1]"
    >
      {numRand.map((xPos, index) => (
        <motion.div
          style={{ right: `${xPos}%` }}
          key={`${xPos}%`}
          className={`absolute top-0 w-2 h-2.5 rounded-t-full bg-pink-300 opacity-0 z-[-1] ${
            index % 4 === 3 ? 'blur' : ''
          } ${index % 3 === 2 ? 'bg-red-400' : ''}`}
          initial="hidden"
          animate={sakura ? 'show' : 'hidden'}
          variants={sakuraAnimation}
          transition={{ delay: index * 0.45 }}
        />
      ))}
    </section>
  );
};

export default Sakura;
