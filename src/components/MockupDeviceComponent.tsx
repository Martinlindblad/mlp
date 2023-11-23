import React from 'react';

interface MockupDeviceComponentProps {
  imageSrc: string;
  deviceType: 'phone' | 'tablet' | 'desktop';
}

const MockupDeviceComponent: React.FC<MockupDeviceComponentProps> = ({
  imageSrc,
  deviceType,
}) => {
  if (deviceType === 'phone') {
    return (
      <div className="relative mx-auto border-gray-800 dark:border-gray-800 bg-gray-800 border-[10px] rounded-lg h-[420px] w-[210px] shadow-xl">
        <div className="w-[104px] h-[13px] bg-gray-800 top-0 rounded-b-lg left-1/2 -translate-x-1/2 absolute"></div>
        <div className="h-[22px] w-[2px] bg-gray-800 absolute -start-[12px] top-[50px] rounded-s-md"></div>
        <div className="h-[32px] w-[2px] bg-gray-800 absolute -start-[12px] top-[87px] rounded-s-md"></div>
        <div className="h-[32px] w-[2px] bg-gray-800 absolute -start-[12px] top-[125px] rounded-s-md"></div>
        <div className="h-[45px] w-[2px] bg-gray-800 absolute -end-[12px] top-[99px] rounded-e-md"></div>
        <div className="rounded-lg overflow-hidden w-[190px] h-[400px] bg-white dark:bg-gray-800">
          <div
            className="hidden dark:block  w-[190px] h-[400px]"
            style={{
              backgroundImage: `url(${imageSrc})`,
              backgroundSize: 'cover',
            }}
          ></div>
        </div>
      </div>
    );
  }

  if (deviceType === 'tablet') {
    return (
      <div className="relative mx-auto border-gray-800 dark:border-gray-800 bg-gray-800 border-[10px] rounded-xl h-[318px] max-w-[239px] md:h-[477px] md:max-w-[358px]">
        <div className="h-[22px] w-[2px] bg-gray-800 dark:bg-gray-800 absolute -start-[12px] top-[50px] rounded-s-lg"></div>
        <div className="h-[32px] w-[2px] bg-gray-800 dark:bg-gray-800 absolute -start-[12px] top-[87px] rounded-s-lg"></div>
        <div className="h-[32px] w-[2px] bg-gray-800 dark:bg-gray-800 absolute -start-[12px] top-[125px] rounded-s-lg"></div>
        <div className="h-[45px] w-[2px] bg-gray-800 dark:bg-gray-800 absolute -end-[12px] top-[99px] rounded-e-lg"></div>
        <div className="rounded-lg overflow-hidden h-[298px] md:h-[458px] bg-white dark:bg-gray-800 ">
          <div
            className="hidden dark:block w-[298px] h-[458px]"
            style={{
              backgroundImage: `url(${imageSrc})`,
              backgroundSize: 'cover',
            }}
          ></div>
        </div>
      </div>
    );
  }

  if (deviceType === 'desktop') {
    return (
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 my-8">
        <div className="relative border-gray-800 dark:border-gray-800 bg-gray-800 border-[6px] rounded-t-lg h-[120px] max-w-[211px] md:h-[206px] md:max-w-[358px] mx-auto">
          <div className="rounded-md overflow-hidden h-[109px] md:h-[195px] bg-white dark:bg-gray-800">
            <img
              src={imageSrc}
              className="dark:hidden h-[109px] md:h-[195px] w-full rounded-lg"
              alt="Device screen light"
            />
            <img
              src={imageSrc}
              className="hidden dark:block h-[109px] md:h-[195px] w-full rounded-md"
              alt="Device screen dark"
            />
          </div>
        </div>
        <div className="relative bg-gray-900 dark:bg-gray-700 rounded-b-lg rounded-t-sm h-[12px] max-w-[246px] md:h-[15px] md:max-w-[418px] mx-auto my-2">
          <div className="absolute left-1/2 top-0 -translate-x-1/2 rounded-b-lg w-[39px] h-[4px] md:w-[67px] md:h-[6px] bg-gray-800"></div>
        </div>
      </div>
    );
  }

  return null;
};

export default MockupDeviceComponent;
