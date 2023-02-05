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
      containerVariant={container}
      className="h-52 absolute bottom-10  right-4  flex-col flex justify-between items-end"
    >
      {SocialMediaData?.map((item, index) => (
        <SocialMediaLink
          socialmedia={item}
          key={`socialMediaLink-${item.name}`}
          index={index}
        />
      ))}
    </AnimatedContainer>
  );
};

export default SocialMediaLinks;
