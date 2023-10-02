import React, { useMemo } from 'react';

import AnimatedContainer from './Layouts/AnimatedContainer';
import SocialMediaLink from './SocialMediaLink';
import { SocailMediaLink } from 'src/types/DBTypes';
import useSocialMediaLinksQuery from '../hooks/useSocialMediaLinksQuery';

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
      className="flex items-end  justify-start"
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
