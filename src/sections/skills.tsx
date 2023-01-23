import React, { useMemo } from 'react';
import DevCard from 'src/components/devcard';
import AnimatedContainer from 'src/components/Layouts/animatedContainer';
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
    <AnimatedContainer
      className="md:min-h-max pb-10 flex flex-col md:flex-row px-4 justify-between space-y-6 md:space-y-0 md:space-x-6"
      containerVariant={container}
    >
      {SkillData.map((item, index) => {
        return <DevCard key={item.key} data={item} index={index} />;
      })}
    </AnimatedContainer>
  );
};

export default Skills;
