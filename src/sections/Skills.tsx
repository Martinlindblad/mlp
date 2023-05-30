import React, { useMemo } from 'react';
import DevCard from '../components/Devcard';
import AnimatedContainer from '../components/Layouts/AnimatedContainer';
import usePageCardsQuery from '../hooks/usePageCardsQuery';

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
    <AnimatedContainer
      key="skilldataContainer"
      containerVariant={container}
      className="grid grid-cols-3 gap-4 justify-items-center py-12"
    >
      {SkillData.map((item, index) => {
        return <DevCard key={item.key} data={item} index={index} />;
      })}
    </AnimatedContainer>
  );
};

export default Skills;
