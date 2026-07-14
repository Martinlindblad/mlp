import React, { useMemo } from 'react';
import CaseItem from './CaseCarouselItem';
import AnimatedFadeInContainer from './Layouts/AnimatedFadeInContainer';
import useProjectsAndCasesQuery from '../hooks/useProjectsAndCasesQuery';
import { Swiper, SwiperSlide } from 'swiper/react';
import 'swiper/css';
import 'swiper/css/effect-coverflow';
import { EffectCoverflow, Pagination } from 'swiper/modules';

type CarouselCase = {
  _id: string;
  title: string;
  description: string;
  imageSource: string;
  href?: string;
  from?: string;
  to?: string;
};

const fallbackCases: CarouselCase[] = [
  {
    _id: 'imaginecare',
    title: 'ImagineCare',
    description:
      'React Native healthcare interfaces with API integration and reliable mobile flows.',
    imageSource: '/images/cases/imaginecare.webp',
    from: '0,0,0',
    to: '0,0,0',
  },
  {
    _id: '657eed6741ee78bde91c1c3e',
    title: 'Mackmyra',
    description:
      'React Native marketplace work for personalized whisky cask ordering.',
    imageSource: '/images/cases/mackmyra.webp',
    from: '0,0,0',
    to: '0,0,0',
  },
  {
    _id: '657eef1d41ee78bde91c1c42',
    title: 'Livsstilsverktyget',
    description:
      'Mobile health research flows with recurring input and clear user feedback.',
    imageSource: '/images/cases/livsstilsverktyget.webp',
    from: '0,0,0',
    to: '0,0,0',
  },
];

export default function CaseCarousel() {
  const { data } = useProjectsAndCasesQuery();

  const items = useMemo(() => {
    const apiItems = data?.filter((item) => item != null) ?? [];

    return apiItems.length > 0 ? apiItems.slice(0, 6) : fallbackCases;
  }, [data]);

  return (
    <AnimatedFadeInContainer type="FadeInBottom" className="h-full ">
      <div className="flex flex-col items-center justify-center w-full lg:h-screen  ">
        <Swiper
          effect={'coverflow'}
          grabCursor={true}
          centeredSlides={true}
          slidesPerView={'auto'}
          coverflowEffect={{
            rotate: 50,
            stretch: 0,
            depth: 100,
            modifier: 1,
            slideShadows: true,
          }}
          pagination={true}
          modules={[EffectCoverflow, Pagination]}
          className="mySwiper w-full h-full  xl:h-4/6 xl:w-4/6  bg-cover bg-center "
        >
          {items.map((item) => (
            <SwiperSlide key={item._id}>
              <CaseItem {...item} id={item._id} />
            </SwiperSlide>
          ))}
        </Swiper>
      </div>
    </AnimatedFadeInContainer>
  );
}
