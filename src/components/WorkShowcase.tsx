import React, { useMemo } from 'react';
import AnimatedFadeInContainer from './Layouts/AnimatedFadeInContainer';
import useProfessionalTimeline from '../hooks/useProfessionalTimelineQuery';
import { ProfessionalTimeline } from 'src/types/DBTypes';
import PageLoader from './AnimatedComponents/ContentLoader';
const CareerEventItem = ({
  event,
}: {
  event: ProfessionalTimeline;
}): JSX.Element => {
  return (
    <AnimatedFadeInContainer type="FadeInBottom">
      <div className="py-8 flex flex-wrap md:flex-nowrap">
        <div className="md:w-64 md:mb-0 mb-6 flex-shrink-0 flex flex-col">
          <span className="font-semibold title-font text-gray-700 dark:text-gray-300 pr-2">
            {event.company || event.institution}
          </span>
          <span className="mt-1 text-gray-600 dark:text-gray-300 text-sm">
            {event.duration}
          </span>
        </div>
        <div className="md:flex-grow">
          <h2 className="text-2xl font-medium text-gray-900 dark:text-gray-100 title-font mb-2">
            {event.title}
          </h2>
          <p className="leading-relaxed text-gray-700 dark:text-gray-300">
            {event.description}
          </p>
        </div>
      </div>
    </AnimatedFadeInContainer>
  );
};

const WorkShowcase = (): JSX.Element => {
  const { data: CareerEvents, isLoading } = useProfessionalTimeline();

  const CareerEventData = useMemo(() => {
    if (!CareerEvents) return [];
    return CareerEvents.filter((item) => item != null);
  }, [CareerEvents]);

  if (isLoading) return <PageLoader />;

  console.log(CareerEvents);

  return (
    <section className="text-gray-600 body-font overflow-hidden container lg:min-h-screen">
      <div className="container px-5 py-24 lg:py-0 mx-auto">
        <div className=" divide-y-2 divide-gray-100">
          {CareerEventData.map((event) => (
            <CareerEventItem key={event._id.toString()} event={event} />
          ))}
        </div>
      </div>
    </section>
  );
};

export default WorkShowcase;
