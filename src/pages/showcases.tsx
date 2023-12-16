/* eslint-disable @typescript-eslint/no-unused-vars */
import { motion, useReducedMotion } from 'framer-motion';
import { useMemo, useReducer } from 'react';
import useProjectsAndCasesQuery from '../hooks/useProjectsAndCasesQuery';
import PageLoader from '../components/AnimatedComponents/ContentLoader';
import Link from 'next/link';
import AnimatedFadeInContainer from '../components/Layouts/AnimatedFadeInContainer';
import AnimatedPreseceWrapper from '../components/Layouts/AnimatePresenceWrapper';
import useWindowDimensions from '../hooks/useWindowDimensions';

interface CaseItem {
  _id: {
    toString: () => string;
  };
  title: string;
  imageSource: string;
  from: string;
  to: string;
  description: string;
}

interface ShowCaseItemProps {
  item: CaseItem;
  handleInteraction: (id: string) => void;
  caseState: { [key: string]: boolean };
  enter: any;
  exit: any;
  isMobile: boolean;
}

function caseReducer(
  state: { [key: string]: boolean },
  action: { type: 'toggle'; id: string },
) {
  switch (action.type) {
    case 'toggle':
      return { ...state, [action.id]: !state[action.id] };
    default:
      throw new Error('Unexpected action');
  }
}

const ShowCaseItem = ({
  item,
  handleInteraction,
  caseState,
  enter,
  exit,
  isMobile,
}: ShowCaseItemProps) => {
  const stringifiedID = item._id.toString();
  const shouldReduceMotion = useReducedMotion();

  const handleClick = () => {
    if (!isMobile) return;
    handleInteraction(stringifiedID);
  };

  const titleAnimationProps = useMemo(
    () =>
      shouldReduceMotion
        ? {
            initial: 'hidden',
            animate: 'visible',
            exit: 'hidden',
          }
        : {
            initial: 'hidden',
            animate: caseState[stringifiedID] ? 'visible' : 'hidden',
            variants: exit,
          },
    [shouldReduceMotion, caseState, stringifiedID, exit],
  );

  const descriptionAnimationProps = useMemo(
    () =>
      shouldReduceMotion
        ? {
            initial: 'hidden',
            animate: 'visible',
            exit: 'hidden',
          }
        : {
            initial: 'hidden',
            animate: caseState[stringifiedID] ? 'visible' : 'hidden',
            variants: enter,
          },
    [shouldReduceMotion, caseState, stringifiedID, enter],
  );

  const extraProps = useMemo(() => {
    const handleOnMouseOver = () => {
      if (isMobile) return;
      handleInteraction(stringifiedID);
    };
    if (!isMobile) {
      return {
        onMouseEnter: handleOnMouseOver,
        onMouseLeave: handleOnMouseOver,
      };
    }
    return {};
  }, [isMobile, handleInteraction, stringifiedID]);

  return (
    <AnimatedFadeInContainer
      type={isMobile ? 'Cancel' : 'FadeInBottom'}
      className="lg:h-64 py-2 sm:p-4 overflow-hidden relative"
      key={`${item._id}-Showcase-item`}
      onClick={handleClick}
      styleProp={{
        background: `linear-gradient(rgba(${item.from}, 0.5), rgba(${item.to},0.5))`,
      }}
      {...extraProps}
    >
      {/* <img
        src={item.imageSource}
        alt={item.title}
        loading="lazy"
        className="w-full h-full object-cover object-center absolute top-0 left-0 z-0 opacity-50"
      /> */}
      <div
        // {...titleAnimationProps}
        className="px-4 mx-auto max-w-screen-xl text-center py-24 lg:py-28 relative z-10"
      >
        <h1 className="mb-4 font-extrabold tracking-tight leading-none text-white text-xl md:text-2xl lg:text-3xl text-center">
          <span className="inline-block mb-2 text-white">{item.title}</span>
        </h1>
      </div>
      <div
        // {...descriptionAnimationProps}
        className="flex flex-col items-center justify-center w-full h-full absolute top-0 left-0 z-10"
      >
        <div className="flex flex-col items-center">
          <h1 className="text-xl md:text-2xl lg:text-3xl text-center font-bold">
            {item.description}
          </h1>
          <Link
            href={`/cases/${item._id}`}
            className="flex-grow sm:flex-grow-0 inline-flex cursor-pointer items-center justify-center mt-10 ring-offset-2 ring-2 rounded-lg px-4 py-2 outline outline-2 outline-offset-2 hover:animate-pulse"
          >
            <span className="inline-block text-white">Go to case</span>
          </Link>
        </div>
      </div>
    </AnimatedFadeInContainer>
  );
};

const ShowCases = () => {
  const { data, isLoading } = useProjectsAndCasesQuery();
  const windowWidth = useWindowDimensions().width;
  const shouldReduceMotion = useReducedMotion();

  const isMobile = useMemo(() => {
    return windowWidth < 768;
  }, [windowWidth]);

  const cases = useMemo(() => {
    if (!data) return [];
    return data.filter((item) => item != null);
  }, [data]);

  const enter = useMemo(() => {
    return shouldReduceMotion
      ? {}
      : {
          hidden: { opacity: 1, y: 400, transition: { duration: 0.3 } },
          visible: { opacity: 1, y: 0, transition: { duration: 0.3 } },
        };
  }, [shouldReduceMotion]);

  const exit = useMemo(() => {
    return shouldReduceMotion
      ? {}
      : {
          hidden: { opacity: 1, y: 0, transition: { duration: 0.3 } },
          visible: { opacity: 1, y: -400, transition: { duration: 0.3 } },
        };
  }, [shouldReduceMotion]);

  const initialCaseState = useMemo<{ [key: string]: boolean }>(() => {
    return cases.reduce((state, item) => {
      state[item._id.toString()] = false;
      return state;
    }, {} as { [key: string]: boolean });
  }, [cases]);

  const [caseState, caseDispatch] = useReducer(caseReducer, initialCaseState);

  const handleInteraction = (id: string) => {
    caseDispatch({ type: 'toggle', id });
  };

  return (
    <AnimatedPreseceWrapper>
      {isLoading ? (
        <PageLoader />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 px-4 py-20 sm:py-16 lg:py-26">
          {cases.map((item) => (
            <ShowCaseItem
              key={item._id.toString()}
              item={item}
              handleInteraction={handleInteraction}
              caseState={caseState}
              exit={exit}
              enter={enter}
              isMobile={isMobile}
            />
          ))}
        </div>
      )}
    </AnimatedPreseceWrapper>
  );
};

export default ShowCases;
