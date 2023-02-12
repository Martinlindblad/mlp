import { AnimatePresence } from 'framer-motion';
import React, { useMemo } from 'react';
import DevCard from 'src/components/Devcard';
import AnimatedContainer from 'src/components/Layouts/AnimatedContainer';
import usePageCardsQuery from 'src/hooks/usePageCardsQuery';

const Skills = (): JSX.Element => {
  const { data: pageCards } = usePageCardsQuery();

  const SkillData = useMemo(() => {
    if (!pageCards) return [];
    return pageCards?.filter((item) => item.type === 'introdcution');
  }, [pageCards]);

  const container = useMemo(
    () => ({
      hidden: {
        opacity: 0,
        scale: 0,
      },
      visible: {
        opacity: 1,
        scale: 1,
      },
    }),
    [],
  );

  return (
    <AnimatePresence>
      <AnimatedContainer
        key="skilldataContainer"
        containerVariant={container}
        className="py-8 grid sm:px-0 px-4  grid-cols-1 sm:grid-cols-3 gap-12 "
      >
        {SkillData.map((item, index) => {
          return <DevCard key={item.key} data={item} index={index} />;
        })}
      </AnimatedContainer>
    </AnimatePresence>
  );
};

export default Skills;
