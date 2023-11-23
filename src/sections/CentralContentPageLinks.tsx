import React, { useMemo } from 'react';
import PageLinkCard from '../components/PageLinkCard';
import AnimatedContainer from '../components/Layouts/AnimatedContainer';
import usePageCardsQuery from '../hooks/usePageCardsQuery';
import ContentLoader from '../components/AnimatedComponents/ContentLoader';

const CentralContentPageLinks = (): JSX.Element => {
  const { data: pageCards, isLoading: isLoadingPageCards } =
    usePageCardsQuery();

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
      key="CentralContentPageLinksContainer"
      containerVariant={container}
      className="flex flex-row flex-wrap justify-between w-full py-20 "
    >
      {isLoadingPageCards ? (
        <ContentLoader />
      ) : (
        SkillData.map((item, index) => {
          return <PageLinkCard key={item.key} data={item} index={index} />;
        })
      )}
    </AnimatedContainer>
  );
};

export default CentralContentPageLinks;
