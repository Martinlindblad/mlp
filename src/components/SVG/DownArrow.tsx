import React, { useRef, useEffect } from 'react';

const Arrow: React.FC = () => {
  const arrowRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const animation = arrowRef.current?.animate(
      [
        { transform: 'translateY(0)', boxShadow: '0 0 20px 10px yellow' },
        { transform: 'translateY(-20px)', boxShadow: '0 0 20px 10px yellow' },
      ],
      {
        duration: 500,
        easing: 'ease-in-out',
        iterations: Infinity,
        direction: 'alternate',
      },
    );

    return () => animation?.cancel();
  }, []);

  return (
    <div>
      <svg width={50} height={50} ref={arrowRef}>
        <defs>
          <filter id="glow">
            <feGaussianBlur stdDeviation={3} result="coloredBlur" />
            <feSpecularLighting
              in="coloredBlur"
              surfaceScale={5}
              specularConstant={0.75}
              specularExponent={20}
              lighting-color="#ff0"
              result="specOut"
            >
              <fePointLight x={-5000} y={-5000} z={5000} />
            </feSpecularLighting>
            <feComposite
              in="specOut"
              in2="SourceGraphic"
              operator="arithmetic"
              k1={0}
              k2={1}
              k3={1}
              k4={0}
            />
          </filter>
        </defs>
        <polygon
          points="0,0 50,25 0,50"
          style={{ fill: 'red', filter: 'url(#glow)' }}
        />
      </svg>
    </div>
  );
};

export default Arrow;
