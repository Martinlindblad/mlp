import { Carousel, CarouselOptions } from 'flowbite';
import Image from 'next/image';
import React, { useLayoutEffect, useMemo } from 'react';

type CarouselItem = {
  position: number;
  el: HTMLElement;
};

const ImageSlider = () => {
  const imageSlides = useMemo(() => {
    return [
      {
        src: '/images/porche.webp',
        alt: 'porche',
        bannerTitle: 'Problem-solving mindset',
      },
      {
        src: '/images/beach.webp',
        alt: 'beach',
        bannerTitle: 'Continuous learning journey',
      },
      {
        src: '/images/porche.webp',
        alt: 'cm',
        bannerTitle: 'Learn, practice, master.',
      },
      {
        src: '/images/beach.webp',
        alt: 'cm',
        bannerTitle: 'Eat, Sleep, Code, Repeat.',
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
      interval: 5000,
      defaultPosition: 0,
    };
    const carousel = new Carousel(items, options);
    return carousel.cycle();
  }, []);

  return (
    <div id="controls-carousel" className="w-full h-full" data-carousel="slide">
      <div className="relative w-full h-full">
        <div className="relative h-full overflow-hidden object-fill">
          {imageSlides.map((item, index) => {
            return (
              <div
                id={`carousel-item-${index + 1}`}
                className="hidden duration-700 ease-in-out "
                data-carousel-item
                key={`carousel-item-${index}`}
              >
                <Image
                  className=" w-full h-full object-cover "
                  src={item.src}
                  alt={item.alt}
                  fill={true}
                />

                <div className="items-center pl-2 flex justify-center absolute h-20 right-0 left-0 bg-black ">
                  <h2>
                    <span className="text-4xl font-bold text-white">
                      {item.bannerTitle}
                    </span>
                  </h2>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default ImageSlider;
