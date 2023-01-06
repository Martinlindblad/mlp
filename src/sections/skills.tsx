import React, { useMemo } from 'react';
import DevCard from 'src/components/devcard';

const Skills = (): JSX.Element => {
  const SkillData = useMemo(() => {
    return [
      {
        key: 'frameworks',
        title: 'Web Development Technologies and Frameworks',
        description: 'Here the main technologys and frameworks I use.',
      },
    ];
  }, []);

  return (
    <section className="min-h-max pb-10">
      {SkillData.map((item) => {
        return <DevCard key={item.key} data={item} />;
      })}
    </section>
  );
};

export default Skills;
