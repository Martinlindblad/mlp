import { motion, useInView } from 'framer-motion';
import React, { useMemo, useRef } from 'react';
import AnimatedFadeInContainer from './Layouts/AnimatedFadeInContainer';

interface StepperProps {
  step: number;
  stepperTitle: string;
}

const Stepper: React.FC<StepperProps> = ({ step, stepperTitle }) => {
  const StepperVariants = useMemo(() => {
    return {
      hidden: {
        opacity: 0,
        scale: 0,
        y: -200,
      },
      visible: {
        opacity: 1,
        scale: 1,
        y: -2,
        x: 0,
        transition: {
          delay: 0.4,
          duration: 0.8,
        },
      },
    };
  }, []);
  const StepperLineVariants = useMemo(() => {
    return {
      hidden: {
        opacity: 0,
        scale: 0,
        y: -200,
      },
      visible: {
        opacity: 1,
        scale: 1,
        y: 0,
        x: 0,
        transition: {
          delay: 0.2,
          duration: 0.6,
        },
      },
    };
  }, []);

  const ref = useRef<HTMLDivElement | null>(null);
  const isInView = useInView(ref);

  return (
    <div ref={ref} className="w-full flex justify-center flex-col items-center">
      <motion.div
        variants={StepperLineVariants}
        initial="hidden"
        animate={isInView ? 'visible' : 'hidden'}
        className="h-24 w-0.5 bg-gradient-to-b to-slate-700 dark:to-slate-300 from-transparent rounded-full"
      />
      <motion.div
        variants={StepperVariants}
        initial="hidden"
        animate={isInView ? 'visible' : 'hidden'}
        className="h-12 w-12 bg-gradient-to-t to-slate-300 dark:to-slate-700 from-transparent flex justify-center items-center rounded-full shadow-2xl shadow-slate-900"
      >
        <p>{step}</p>
      </motion.div>
      <AnimatedFadeInContainer className="py-3">
        <h2 className="text-lg">{stepperTitle}</h2>
      </AnimatedFadeInContainer>
    </div>
  );
};

export default Stepper;
