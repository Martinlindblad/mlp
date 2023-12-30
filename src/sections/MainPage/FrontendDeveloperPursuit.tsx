import React, { useMemo } from 'react';
// import Stepper from 'src/src/components/Stepper';

import Image from 'next/image';
import AnimatedFadeInContainer from 'src/src/components/Layouts/AnimatedFadeInContainer';
import usePursuitQuery from 'src/src/hooks/usePursuitQuery';
import PageLoader from 'src/src/components/AnimatedComponents/ContentLoader';
import { Pursuit } from 'src/types/DBTypes';

const FrontendDeveloperPursuit = () => {
  const { data, isLoading } = usePursuitQuery();

  const pursuitData = useMemo(() => {
    if (!data) return {} as Pursuit;
    return data[0];
  }, [data]);

  const { description, leftImageSource, rightImageSource, title } = pursuitData;

  return (
    <>
      {isLoading ? (
        <PageLoader />
      ) : (
        <section className="container">
          <div className="w-full flex flex-col align-center justify-center pt-24  lg:py-24">
            {/* <Stepper step={2} stepperTitle={'My Journey'} /> */}
            <div className="gap-16 items-center py-8 mx-auto  max-w-screen-xl lg:grid lg:grid-cols-2 lg:py-16 lg:px-0">
              <AnimatedFadeInContainer className="w-full" type="FadeInLeft">
                <div className="font-light text-gray-500 sm:text-lg dark:text-gray-400">
                  <h2 className="mb-4 text-4xl tracking-tight font-extrabold text-gray-900 dark:text-white">
                    {title}
                  </h2>
                  <p className="mb-4">{description}</p>
                </div>
              </AnimatedFadeInContainer>
              <div className="grid grid-cols-2 gap-4 mt-8">
                <div className="w-full rounded-lg overflow-hidden">
                  <AnimatedFadeInContainer
                    className="w-full"
                    type="FadeInRight"
                  >
                    <Image
                      src={leftImageSource}
                      className="rounded-lg"
                      alt="Bussiness"
                      width={300}
                      height={500}
                      objectFit="cover"
                    />
                  </AnimatedFadeInContainer>
                </div>
                <div className="w-full rounded-lg overflow-hidden mt-4 lg:mt-10">
                  <AnimatedFadeInContainer className="w-full" type="FadeInLeft">
                    <Image
                      src={rightImageSource}
                      alt="Classy"
                      width={300}
                      height={500}
                      objectFit="cover"
                    />
                  </AnimatedFadeInContainer>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}
    </>
  );
};

export default FrontendDeveloperPursuit;
