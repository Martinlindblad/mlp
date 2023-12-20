import { motion, useAnimation } from 'framer-motion';
import React, { useEffect, useRef } from 'react';

interface LogoProps {
  containerStyle: any;
}

const Logo: React.FC<LogoProps> = ({ containerStyle }) => {
  const pathRef1 = useRef<SVGPathElement>(null);
  const pathRef2 = useRef<SVGPathElement>(null);

  const controls1 = useAnimation();
  const controls2 = useAnimation();

  useEffect(() => {
    const length1 = pathRef1.current?.getTotalLength() || 0;
    const length2 = pathRef2.current?.getTotalLength() || 0;

    controls1.set({
      strokeDasharray: length1,
      strokeDashoffset: length1,
      fill: 'transparent',
    });

    controls2.set({
      strokeDasharray: length2,
      strokeDashoffset: length2,
      fill: 'transparent',
    });

    controls1
      .start({
        strokeDashoffset: 0,
        transition: {
          duration: 2,
          ease: 'easeInOut',
        },
      })
      .then(() => {
        void controls1.start({
          fill: '#FFF',
        });
      })
      .catch((error) => {
        console.error('Animation error:', error);
      });

    controls2
      .start({
        strokeDashoffset: 0,
        transition: {
          duration: 2.5,
          ease: 'easeInOut',
          delay: 2.5,
        },
      })
      .then(() => {
        void controls2.start({
          fill: '#FFF',
        });
      })
      .catch((error) => {
        console.error('Animation error:', error);
      });
  }, [controls1, controls2]);

  return (
    <div className={containerStyle}>
      <div>
        <svg
          className="svg"
          id="svg"
          data-name="Layer 1"
          viewBox="0 0 237.01 221.31"
        >
          <defs>
            <linearGradient id="gradient1">
              {/* <stop offset="0%" stopColor="transparent" /> */}
              <stop offset="100%" stopColor="#FFF" />
            </linearGradient>
            <linearGradient id="gradient2">
              {/* <stop offset="0%" stopColor="transparent" /> */}
              <stop offset="100%" stopColor="#FFF" />
            </linearGradient>
          </defs>
          <title>MARTIN</title>
          <motion.path
            ref={pathRef1}
            initial={{ strokeDasharray: 0 }}
            animate={controls1}
            stroke="url(#gradient1)"
            strokeWidth="3"
            d="M117.21,185.1a10.87,10.87,0,0,0,11,11.34c8.14,0,13.17-7.18,16.08-13.89,8.19-18.88,18-35.58,33-49.92l-4-2.9A93.88,93.88,0,0,0,160.85,178c0,2.2,4.22,3.43,4.73.92,2-9.93,9.8-17.3,16.39-24.5q10.83-11.85,22.16-23.23l-4-2.9c-6,12.19-11.3,24.69-14.83,37.82-4,14.73-5.55,29.93-5.88,45.16-.17,7.35.78,15.84-2.53,22.69-1.55,3.19-8.24,9.82-9.81,2.74-1-4.59,2-9.4,5.35-12.19,7.28-6,18.65-6,27.58-5.86a110.57,110.57,0,0,1,29.94,4.8c3.12.94,3.57-3.17.75-4-16.06-4.84-35.26-7.61-51.76-3.21-6.51,1.74-12.65,5.51-15.45,11.89-2.13,4.85-1.93,11.61,2.83,14.85,4.44,3,10,.25,13-3.53,3.73-4.71,4.44-11.13,4.67-16.94.62-15.8.75-31.27,4-46.83,3.34-15.71,9.35-30.51,16.4-44.89,1-2.09-2.34-4.57-4-2.9q-12.65,12.75-24.71,26c-6.32,7-12.94,14-14.89,23.56l4.73.92a90,90,0,0,1,12.12-46.16c1.2-2.08-2.36-4.46-4-2.9a136.77,136.77,0,0,0-25.25,32.48c-3.28,5.92-5.77,12.09-8.47,18.28-1.38,3.16-2.93,6.44-5.49,8.83-3.46,3.22-13.07,5.73-12.59-2.34.16-2.53-4.55-4.2-4.71-1.46Z"
            transform="translate(-64.64 -71.07)"
          />
          <motion.path
            ref={pathRef2}
            initial={{ strokeDasharray: 0 }}
            animate={controls2}
            stroke="url(#gradient2)"
            strokeWidth="3"
            d="M243.22,95c-9.65-9.91-23.76-16.47-36.84-20.18-31.72-9-67.76-1.26-95.32,16.11-30,18.9-46.33,53.54-46.42,88.45A118.67,118.67,0,0,0,76.3,231.29c8.3,17.11,20.89,30.46,36.08,41.69a88.85,88.85,0,0,0,43.55,17.45c10.85,1.31,22,2.78,32.91,1.36,16.54-2.15,34.18-8.08,48.13-17.22,16-10.47,31-26.07,38.48-43.77,7.82-18.41,11.46-38.74,9.53-58.64-1.19-12.15-3.2-25.72-10.2-36.08s-19.52-12.75-29.44-4.86c-2.39,1.9-6.21,5.51-5.74,9,.54,4.05,5.62,3.47,8.48,2.76A56.3,56.3,0,0,0,259.86,138c8.11-4.14,16.16-8.42,24-13.05a138,138,0,0,0,12.25-7.89c1.55-1.16,3.64-2.49,4.74-4.14a3.75,3.75,0,0,0,.78-1.26c.24-1.33-2.16-2-2.4-.7-.21,1.15-3.63,3.55-4.9,4.49-9.78,7.27-20.86,12.93-31.63,18.53-4.57,2.38-9.19,5-14.14,6.55-1.24.39-4.59,1.63-5.87.66-2.12-1.6,1.29-5.41,2.46-6.63,7.92-8.2,19.81-8,26.73,1.28s9,22,10.32,33.2c2.13,18.51-.41,36.34-6.45,53.94-12.23,35.65-46.61,59.31-82.72,66-8.74,1.61-16.42,1.23-25.21.52-16.34-1.32-31.65-3.72-45.82-12.47-15.21-9.39-29-21.88-38.44-37.18a113.89,113.89,0,0,1-15.91-48.56c-3.14-32.78,7.79-66.94,32.64-89.23,13.59-12.19,31-20,48.54-24.76a111.12,111.12,0,0,1,44.1-3.18c16.82,2.35,33.86,9.21,46.7,20.53.64.56,1.28,1.13,1.88,1.74,1,1,2.84-.18,1.71-1.35Z"
            transform="translate(-64.64 -71.07)"
          />
        </svg>
      </div>
    </div>
  );
};

export default Logo;
