import { useTheme } from 'next-themes';
import { useEffect, useMemo, useState } from 'react';
import { AboutType } from 'src/../types/DBTypes';
export default function About() {
  const [introduction, setIntroduction] = useState<AboutType>();
  const { systemTheme, theme } = useTheme();
  const currentTheme = useMemo(() => {
    return theme === 'system' ? systemTheme : theme;
  }, [systemTheme, theme]);

  useEffect(() => {
    void (async () => {
      const results = await fetch('/api/introduction').then((response) =>
        response.json(),
      );
      setIntroduction(results[0]);
    })();
  }, []);

  return (
    <main className="flex pt-10 w-full lg:container">
      <div className="min-w-full">
        <div className="flex justify-center min-w-full flex-col items-center">
          <h1 className="p-1 text-start text-4xl  font-black uppercase fw tracking-widest ">
            {introduction?.name}
          </h1>
          <h1 className="p-1 text-4xl  font-black uppercase fw tracking-widest">
            {introduction?.surname}
          </h1>
        </div>
        <div className=" w-full flex pt-10 pb-5 ">
          <div className="w-full h-72 relative ">
            <div className="object-fill w-full h-72 bg-cover bg-center absolute mix-blend-lighten dark:bg-gray-300 bg-gray-100  " />
            <div className="object-fill w-full h-72  bg-cover bg-center absolute mix-blend-multiply dark:bg-gray-100 bg-gray-300" />
            {currentTheme === 'dark' || undefined ? (
              <div className="object-fill w-full h-72 bg-[url('../../assets/singapore.jpg')] bg-cover bg-center absolute mix-blend-multiply" />
            ) : (
              <div className="object-fill w-full h-72 bg-[url('../../assets/beach.jpg')] bg-cover bg-center absolute mix-blend-multiply" />
            )}

            <div className=" relative w-full h-full flex items-center flex-col justify-center ">
              <div className="object-fill h-52 w-52 rounded-full bg-cover bg-center absolute mix-blend-multiple" />
              <div className=" bg-[url('../../assets/profilepicture.png')] rounded-full shadow-indigo-200 dark:shadow-sky-300  shadow-lg bg-cover h-52 w-52 object-fill " />
              <div className=" bg-[url('../../assets/profilepicture.png')] rounded-full  absolute mix-blend-multiply dark:bg-gray-100 bg-gray-400  scale-105 bg-cover h-52 w-52 object-fill" />
            </div>
          </div>
        </div>

        <h2 className=" text-3xl font-extrabold px-8 md:text-5xl lg:text-6xl text-center">
          <span className="text-transparent bg-clip-text bg-gradient-to-r to-sky-600 from-gold-400 ">
            {introduction?.title}
          </span>
        </h2>
        <p className="text-lg font-normal lg:text-xl px-8  text-center py-3">
          {introduction?.info}
        </p>
      </div>
    </main>
  );
}
