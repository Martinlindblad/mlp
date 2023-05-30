import { Carousel, CarouselOptions } from 'flowbite';
import Image from 'next/image';
import React, { useLayoutEffect, useMemo } from 'react';

import image from 'assets/porche.jpg';
import image2 from 'assets/beach.jpg';
import image3 from 'assets/cm.jpg';

type CarouselItem = {
  position: number;
  el: HTMLElement;
};

const ImageSlider = () => {
  const imageSlides = useMemo(() => {
    return [
      {
        src: image,
        alt: 'porche',
      },
      {
        src: image2,
        alt: 'beach',
      },
      {
        src: image3,
        alt: 'cm',
      },
      {
        src: image3,
        alt: 'cm',
      },
    ];
  }, []);
  useLayoutEffect(() => {
    const items: CarouselItem[] = [
      {
        position: 0,
        el: document.getElementById('carousel-item-1') as HTMLElement,
      },
      {
        position: 1,
        el: document.getElementById('carousel-item-2') as HTMLElement,
      },
      {
        position: 2,
        el: document.getElementById('carousel-item-3') as HTMLElement,
      },
      {
        position: 3,
        el: document.getElementById('carousel-item-4') as HTMLElement,
      },
    ].filter((item) => item.el !== null);

    const options: CarouselOptions = {
      interval: 3000,
      defaultPosition: 1,
    };
    const carousel = new Carousel(items, options);
    carousel.cycle();
  }, []);

  return (
    <div
      id="controls-carousel"
      className="relative w-full"
      data-carousel="slide"
    >
      <div className="relative w-full">
        <div className="relative h-56 overflow-hidden rounded-lg sm:h-64 xl:h-80 2xl:h-96">
          {imageSlides.map((item, index) => {
            return (
              <div
                id={`carousel-item-${index + 1}`}
                className="hidden duration-700 ease-in-out"
                data-carousel-item
                key={`carousel-item-${index}`}
              >
                <Image
                  src={item.src}
                  alt={item.alt}
                  className="absolute block w-full -translate-x-1/2 -translate-y-1/2 top-1/2 left-1/2"
                  layout="fill"
                  objectFit="cover"
                  objectPosition="center"
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default ImageSlider;
