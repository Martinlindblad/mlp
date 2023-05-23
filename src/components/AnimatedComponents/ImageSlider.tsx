import Image from 'next/image';
import image from '../../../assets/porche.jpg';
import React, { useMemo } from 'react';

const ImageSlider = (): JSX.Element => {
  const imageSliderItems = useMemo(() => {
    return [
      {
        image: image,
        alt: 'Carl Martins Logo',
        title: 'Welcome',
      },
      {
        image: image,
        alt: 'Mobile App Developer',
        title: 'Mobile App Developer',
      },
      {
        image: image,
        alt: 'Web Developer',
        title: 'Web Developer',
      },
      {
        image: image,
        alt: 'Web Developer',
        title: 'Web Developer',
      },
    ];
  }, []);

  return (
    <div className="relative overflow-hidden h-full w-full">
      <div className="flex animate-[slide_16s_ease-in-out_infinite]">
        {imageSliderItems.map((item, index) => {
          return (
            <Image
              key={`imageSliderItem-${index}`}
              className="w-full h-full"
              src={item.image}
              alt={item.alt}
            />
          );
        })}
      </div>
    </div>
  );
};
export default ImageSlider;
