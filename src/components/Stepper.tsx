import { motion, useInView } from 'framer-motion';
import React, { useMemo, useRef } from 'react';
import AnimatedFadeInContainer from './Layouts/AnimatedFadeInContainer';
import AnimatedPreseceWrapper from './Layouts/AnimatePresenceWrapper';

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
      <AnimatedPreseceWrapper>
        <motion.div
          variants={StepperLineVariants}
          initial="hidden"
          animate={isInView ? 'visible' : 'hidden'}
          className="h-24 w-0.5 bg-gradient-to-b to-blue-500 from-transparent rounded-full"
          key={'stepper-line'}
        />
        <motion.div
          variants={StepperVariants}
          initial="hidden"
          animate={isInView ? 'visible' : 'hidden'}
          className="h-8 w-8 bg-gradient-to-t to-blue-500  from-purple-500 flex justify-center items-center rounded-full shadow-2xl shadow-blue-500"
          key={'stepper-rounded'}
        >
          <p className="text-xs">{step}</p>
        </motion.div>
      </AnimatedPreseceWrapper>
      <AnimatedFadeInContainer className="py-3">
        <h2 className="text-lg">{stepperTitle}</h2>
      </AnimatedFadeInContainer>
    </div>
  );
};

export default Stepper;
