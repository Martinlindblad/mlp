import React, { useMemo, useRef, useState } from 'react';
import CaseItem from './CaseCarouselItem';
import AnimatedFadeInContainer from './Layouts/AnimatedFadeInContainer';
import useProjectsAndCasesQuery from '../hooks/useProjectsAndCasesQuery';
import { Swiper, SwiperRef, SwiperSlide } from 'swiper/react';
import 'swiper/css';
import 'swiper/css/effect-coverflow';
import ContentLoader from '../components/AnimatedComponents/ContentLoader';
import { EffectCoverflow, Pagination } from 'swiper/modules';

export default function CaseCarousel() {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [page, setPage] = useState(0);
  const { data, isLoading } = useProjectsAndCasesQuery();

  const items = useMemo(() => {
    if (!data) return [];
    return data?.filter((item) => item != null).slice(0, 6);
  }, [data]);

  const handleSlideChange = (swiper: {
    activeIndex: React.SetStateAction<number>;
  }) => {
    setPage(swiper.activeIndex);
  };
  const swiperRef = useRef<SwiperRef | null>(null);

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
          ref={swiperRef}
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
          onSlideChange={handleSlideChange}
        >
          {items.map((item, index) => (
            <SwiperSlide key={index}>
              <CaseItem {...item} id={item._id} />
            </SwiperSlide>
          ))}
        </Swiper>

        {/* <div className="pt-10 md:pt-20 xl:bottom-10 w-full z-50 flex items-center justify-center ">
          <div className="justify-between flex items-center ">
            <div className="flex flex-col items-center">
              <span className="text-sm text-gray-700 dark:text-gray-400">
                Showing{' '}
                <span className="font-semibold text-gray-900 dark:text-white">
                  {page + 1}
                </span>{' '}
                of{' '}
                <span className="font-semibold text-gray-900 dark:text-white">
                  {items.length}
                </span>{' '}
                Cases/Projects
              </span>
              <div className="inline-flex mt-2 xs:mt-0">
                <button
                  onClick={() => swiperRef.current?.swiper?.slidePrev()}
                  className={`
                ${page === 0 && 'opacity-50 cursor-not-allowed'}
                inline-flex items-center px-4 py-2 text-sm font-medium text-white
                bg-gray-800 border-0 border-l border-gray-700 rounded-l hover:bg-gray-900 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-white`}
                >
                  <svg
                    aria-hidden="true"
                    className="w-5 h-5 mr-2"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      fillRule="evenodd"
                      d="M7.707 14.707a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l2.293 2.293a1 1 0 010 1.414z"
                      clipRule="evenodd"
                    ></path>
                  </svg>
                  Prev
                </button>
                <button
                  onClick={() => swiperRef.current?.swiper?.slideNext()}
                  className={`
                ${page === items.length - 1 && 'opacity-50 cursor-not-allowed'}
                inline-flex items-center px-4 py-2 text-sm font-medium text-white
                bg-gray-800 border-0 border-l border-gray-700 rounded-r hover:bg-gray-900 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-white`}
                >
                  Next
                  <svg
                    aria-hidden="true"
                    className="w-5 h-5 ml-2"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      fillRule="evenodd"
                      d="M12.293 5.293a1 1 0 011.414 0l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-2.293-2.293a1 1 0 010-1.414z"
                      clipRule="evenodd"
                    ></path>
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div> */}
      </div>
    </AnimatedFadeInContainer>
  );
}
