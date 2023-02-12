import React, { useMemo } from 'react';
import { SocailMediaLink } from 'src/../types/DBTypes';
import useSocialMediaLinksQuery from 'src/hooks/useSocialMediaLinksQuery';

import AnimatedContainer from './Layouts/AnimatedContainer';
import SocialMediaLink from './SocialMediaLink';

const SocialMediaLinks = (): JSX.Element => {
  const { data: SocialMedia } = useSocialMediaLinksQuery();

  const SocialMediaData = useMemo(() => {
    if (!SocialMedia) return [];
    return SocialMedia?.filter((item: SocailMediaLink) => item != null);
  }, [SocialMedia]);

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
      key={'socialmediaContainer'}
      containerVariant={container}
      className="lg:h-52 absolute lg:bottom-20 bottom-4 lg:right-5 left-8 w-52 lg:w-auto lg:flex-col flex justify-between items-end"
    >
      {SocialMediaData.map((item, index) => {
        return (
          <SocialMediaLink
            socialmedia={item}
            key={`socialMediaLink-${item.name}`}
            index={index}
          />
        );
      })}
    </AnimatedContainer>
  );
};

export default SocialMediaLinks;
