import React, { useMemo } from 'react';
import DevCard from 'src/components/devcard';
import usePageCardsQuery from 'src/hooks/usePageCardsQuery';

const Skills = (): JSX.Element => {
  const { data: pageCards } = usePageCardsQuery();

  const SkillData = useMemo(() => {
    if (!pageCards) return [];
    return pageCards?.filter((item) => item.type === 'introdcution');
  }, [pageCards]);

  return (
    <section className="md:min-h-max pb-10 flex flex-col md:flex-row px-4 justify-between space-y-6 md:space-y-0 md:space-x-6">
      {SkillData.map((item) => {
        return <DevCard key={item.key} data={item} />;
      })}
    </section>
  );
};

export default Skills;
