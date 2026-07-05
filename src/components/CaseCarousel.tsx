import React, { useMemo } from 'react';
import CaseItem from './CaseCarouselItem';
import AnimatedFadeInContainer from './Layouts/AnimatedFadeInContainer';
import useProjectsAndCasesQuery from '../hooks/useProjectsAndCasesQuery';
import { Swiper, SwiperSlide } from 'swiper/react';
import 'swiper/css';
import 'swiper/css/effect-coverflow';
import ContentLoader from '../components/AnimatedComponents/ContentLoader';
import { EffectCoverflow, Pagination } from 'swiper/modules';

export default function CaseCarousel() {
  const { data, isLoading } = useProjectsAndCasesQuery();

  const items = useMemo(() => {
    if (!data) return [];
    return data?.filter((item) => item != null).slice(0, 6);
  }, [data]);

  return isLoading || !items ? (
    <ContentLoader />
  ) : (
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
            <SwiperSlide key={item._id.toString()}>
              <CaseItem {...item} id={item._id} />
            </SwiperSlide>
          ))}
        </Swiper>
      </div>
    </AnimatedFadeInContainer>
  );
}
