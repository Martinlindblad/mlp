import React from 'react';
import AnimatedFadeInContainer from './Layouts/AnimatedFadeInContainer';

const WorkShowcase = (): JSX.Element => {
  return (
    <section className="text-gray-600 body-font overflow-hidden container lg:min-h-screen">
      <div className="container px-5 py-24 mx-auto">
        <div className="-my-8 divide-y-2 divide-gray-100">
          <AnimatedFadeInContainer type="FadeInBottom">
            <div className="py-8 flex flex-wrap md:flex-nowrap">
              <div className="md:w-64 md:mb-0 mb-6 flex-shrink-0 flex flex-col">
                <span className="font-semibold title-font text-gray-700 dark:text-gray-300">
                  Sphinxly
                </span>
                <span className="mt-1 text-gray-600 dark:text-gray-300 text-sm">
                  2019-2020 (20 weeks)
                </span>
              </div>
              <div className="md:flex-grow">
                <h2 className="text-2xl font-medium text-gray-900 dark:text-gray-100 title-font mb-2">
                  Front-end Developer (Intern)
                </h2>
                <p className="leading-relaxed text-gray-700 dark:text-gray-300">
                  During my internship at Sphinxly, I worked extensively with
                  their CMS (Easyweb). I was primarily involved with internal
                  projects which encompassed CMS, Database Management, API, and
                  Javascript (ES5-ES7, jQuery, angularJS). Additionally, I
                  played an instructional role, training students from another
                  YH program on how to utilize Easyweb for their projects.
                </p>
              </div>
            </div>
          </AnimatedFadeInContainer>

          <AnimatedFadeInContainer type="FadeInBottom">
            <div className="py-8 flex flex-wrap md:flex-nowrap">
              <div className="md:w-64 md:mb-0 mb-6 flex-shrink-0 flex flex-col">
                <span className="font-semibold title-font text-gray-700 dark:text-gray-300">
                  Coca-Cola CCEP, Jordbro
                </span>
                <span className="mt-1 text-gray-600 dark:text-gray-300 text-sm">
                  Mar 2017 – Dec 2020
                </span>
              </div>
              <div className="md:flex-grow">
                <h2 className="text-2xl font-medium text-gray-900 dark:text-gray-100 title-font mb-2">
                  Warehouse Operator
                </h2>
                <p className="leading-relaxed text-gray-700 dark:text-gray-300">
                  I operated a counterweight truck at the production lines and
                  managed goods dispatch to the loading zone. I also operated a
                  diesel truck within the premises when required. Over the
                  summer, I took on a mentoring role, guiding new temporary
                  employees. My responsibilities also included picking,
                  disposal, and unloading packaging from trucks.
                </p>
              </div>
            </div>
          </AnimatedFadeInContainer>

          <AnimatedFadeInContainer type="FadeInBottom">
            <div className="py-8 flex flex-wrap md:flex-nowrap">
              <div className="md:w-64 md:mb-0 mb-6 flex-shrink-0 flex flex-col">
                <span className="font-semibold title-font text-gray-700 dark:text-gray-300">
                  Elderly Care Home,
                  <br /> Solberga
                </span>
                <span className="text-sm text-gray-600 dark:text-gray-300">
                  2014-2015
                </span>
              </div>
              <div className="md:flex-grow">
                <h2 className="text-2xl font-medium text-gray-900 dark:text-gray-100 title-font mb-2">
                  Care Assistant
                </h2>
                <p className="leading-relaxed text-gray-700 dark:text-gray-300">
                  My role was primarily caring for elderly patients,
                  particularly those with dementia or serious illnesses. In
                  addition, I served as a mentor for new summer interns, helping
                  them acclimate to the environment and their responsibilities.
                </p>
              </div>
            </div>
          </AnimatedFadeInContainer>
        </div>
      </div>
    </section>
  );
};

export default WorkShowcase;
