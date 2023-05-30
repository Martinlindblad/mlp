import { Carousel } from 'flowbite';
import Image from 'next/image';
import React, { useEffect } from 'react';

import image from 'assets/porche.jpg';
import image2 from 'assets/beach.jpg';
import image3 from 'assets/cm.jpg';

type CarouselItem = {
  position: number;
  el: HTMLElement | null;
};

const ImageSlider = () => {
  useEffect(() => {
    const items: CarouselItem[] = [
      {
        position: 0,
        el: document.getElementById('carousel-item-1'),
      },
      {
        position: 1,
        el: document.getElementById('carousel-item-2'),
      },
      {
        position: 2,
        el: document.getElementById('carousel-item-3'),
      },
      {
        position: 3,
        el: document.getElementById('carousel-item-4'),
      },
    ].filter((item) => item.el !== null);

    const options = {
      defaultPosition: 1,
      interval: 10000,
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
          <div
            id="carousel-item-1"
            className="hidden duration-700 ease-in-out"
            data-carousel-item
          >
            <Image
              src={image}
              className="absolute block w-full -translate-x-1/2 -translate-y-1/2 top-1/2 left-1/2"
              alt="..."
            />
          </div>
          <div
            id="carousel-item-2"
            className="hidden duration-700 ease-in-out"
            data-carousel-item
          >
            <Image
              src={image2}
              className="absolute block w-full -translate-x-1/2 -translate-y-1/2 top-1/2 left-1/2"
              alt="..."
            />
          </div>
          <div
            id="carousel-item-3"
            className="hidden duration-700 ease-in-out"
            data-carousel-item
          >
            <Image
              src={image3}
              className="absolute block w-full -translate-x-1/2 -translate-y-1/2 top-1/2 left-1/2"
              alt="..."
            />
          </div>
          <div
            id="carousel-item-4"
            className="hidden duration-700 ease-in-out"
            data-carousel-item
          >
            <Image
              src={image}
              className="absolute block w-full -translate-x-1/2 -translate-y-1/2 top-1/2 left-1/2"
              alt="..."
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default ImageSlider;
